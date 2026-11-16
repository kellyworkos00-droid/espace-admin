import { revalidatePath } from 'next/cache';

import { DataTable } from '@/components/data-table';
import { Shell } from '@/components/shell';
import {
  Badge,
  Metric,
  Notice,
  PageHead,
  PersonCell,
  ago,
  kes,
  personIndex,
  personSearch,
  when,
  LoadError,
} from '@/components/ui';
import { requireAdmin } from '@/lib/auth';
import { hasServiceRole, sb } from '@/lib/supabase';
import { getBookings, getListings, getPayments, getProfiles } from '@/lib/queries';

export const dynamic = 'force-dynamic';

/**
 * Refunds.
 *
 * Clause 8 of the Terms says a refund request is reviewed by our team against
 * the listing and the messages between the two people. There was no screen, so
 * a request landed nowhere and was reviewed by nobody.
 *
 * Worse than nowhere, in fact. The app marks the payment refunded from the
 * renter's own device and calls nothing: eConfirm never hears about it, no
 * money moves, and the renter is told on screen that their refund "is now
 * being processed". The host loses the claim, the renter receives nothing, and
 * the escrow sits exactly where it was.
 *
 * So this screen is not a queue of refunds that happened. It is a list of
 * people who believe they are owed money and are not getting it, which is a
 * different and more urgent thing to be looking at.
 */
export default async function RefundsPage() {
  await requireAdmin();

  const [payments, bookings, listings, profiles] = await Promise.all([
    getPayments('all'),
    getBookings(),
    getListings(),
    getProfiles(),
  ]);

  const people = personIndex(profiles.rows);
  const bookingById = new Map(bookings.rows.map((row) => [row.id, row]));
  const listingById = new Map(listings.rows.map((row) => [row.id, row]));

  const refunds = payments.rows.filter((row) => row.status === 'refunded');

  /**
   * Refunds the app has queued and nobody has sent yet.
   *
   * The app now queues a refund (refund_status = 'pending') whenever one is
   * owed: a host declining a paid booking, a request the host never answered
   * within 24 hours, a cancellation before the host confirmed, a host
   * cancelling, or a renter's refund request. None of those reached this
   * console before, so the renter was told "refund requested" and no person
   * ever saw it.
   */
  const queued = bookings.rows
    .filter((row) => row.refund_status === 'pending')
    .sort((a, b) => (a.cancelled_at ?? a.created_at).localeCompare(b.cancelled_at ?? b.created_at));
  const queuedKes = queued.reduce((total, row) => total + Number(row.refund_amount_kes ?? row.amount_kes ?? 0), 0);

  async function markRefunded(formData: FormData) {
    'use server';
    const id = String(formData.get('id') ?? '');
    const reason = String(formData.get('reason') ?? '');
    if (!id) return;
    if (reason === 'short_stay_deposit') {
      // A deposit charged on a BnB by mistake. Recorded through the ledger
      // function, which writes the refund entry and marks it sent; it moves
      // no money itself -- a person sends it first.
      await sb('rpc/ledger_refund_deposit', { method: 'POST', body: { target: id, actor: 'admin' } });
      revalidatePath('/refunds');
      return;
    }
    // Records that a person sent it, like Mark paid on Payouts. It moves no
    // money, and it leaves payment_status alone: the escrow ledger has no
    // refund entry yet, so the payment row keeps saying where the money was.
    await sb('bookings', { query: `id=eq.${id}`, method: 'PATCH', body: { refund_status: 'issued' } });
    revalidatePath('/refunds');
  }

  const whyOwed = (row: (typeof queued)[number]) => {
    if (row.refund_reason === 'short_stay_deposit') return 'Deposit charged on a BnB (BnBs take no deposit)';
    if (row.host_declined_reason === 'No reply within 24 hours') return 'Host did not reply in 24h';
    if (row.request_status === 'declined') return 'Host declined';
    if (row.request_status === 'cancelled') return row.cancelled_by === 'host' ? 'Host cancelled' : 'Renter cancelled before confirmation';
    return 'Renter asked for a refund (review first)';
  };
  const owed = refunds.reduce((total, row) => total + Number(row.amount_kes ?? 0), 0);

  // A refund on a payment that never had an escrow behind it is a different
  // problem: there is nothing to send back even once sending is built.
  const withEscrow = refunds.filter((row) =>
    (row.econfirm_transaction_id ?? '').startsWith('txn_')
  );

  return (
    <Shell badges={{ '/refunds': refunds.length + queued.length }}>
      <PageHead
        title="Refunds"
        description="Renters who asked for their money back. None of it has been sent — read the notice below before working this queue."
      />

      <LoadError error={payments.error} what="payments" keyed={hasServiceRole} />

      <h2 className="section-title">
        Waiting to be sent <span className="count">{queued.length}</span>
      </h2>
      {queued.length > 0 ? (
        <Notice tone="warn" title={`${kes(queuedKes)} owed back to renters`}>
          Send each one from eConfirm to the M-Pesa that paid, then mark it refunded here. A renter&rsquo;s own
          refund request needs a decision first: read the listing and the messages before sending.
        </Notice>
      ) : null}
      <DataTable
        head={['Home', 'Renter', 'Amount', 'Why', 'Since', 'Action']}
        placeholder="Search by home or renter…"
        noun="refund"
        empty={
          <>
            <strong>Nothing waiting.</strong>
            Refunds the app queues show up here.
          </>
        }>
        {queued.map((row) => {
          const listing = row.listing_id ? listingById.get(row.listing_id) : undefined;
          return (
            <tr key={row.id} data-search={[listing?.title, personSearch(row.guest_profile_id, people)].filter(Boolean).join(' ')}>
              <td>
                <div style={{ fontWeight: 700 }}>{listing?.title ?? 'Listing removed'}</div>
                <div className="mono">{row.id.slice(0, 8)}</div>
              </td>
              <td>
                <PersonCell id={row.guest_profile_id} people={people} />
              </td>
              <td className="num">
                {kes(row.refund_amount_kes ?? row.amount_kes)}
                {row.refund_amount_kes != null && row.refund_amount_kes !== row.amount_kes ? (
                  <div className="mono">of {kes(row.amount_kes)} paid</div>
                ) : null}
              </td>
              <td>{whyOwed(row)}</td>
              <td className="dim nowrap">
                <div>{ago(row.cancelled_at ?? row.created_at)}</div>
                <div className="mono">{when(row.cancelled_at ?? row.created_at)}</div>
              </td>
              <td>
                <form action={markRefunded}>
                  <input type="hidden" name="id" value={row.id} />
                  <input type="hidden" name="reason" value={row.refund_reason ?? ''} />
                  <button className="btn primary small" type="submit">
                    Mark refunded
                  </button>
                </form>
              </td>
            </tr>
          );
        })}
      </DataTable>

      <h2 className="section-title">Marked refunded in the app</h2>

      {/* The first thing on the screen, because every row below it is a person
          who has been told something untrue -- but only when there is a row.
          With the queue empty there is nobody being misled, and a red block
          over an empty table is the kind of standing alarm people learn to
          scroll past, taking the real ones with it. */}
      {refunds.length > 0 ? (
      <Notice tone="error" title="No refund on this screen has actually been paid">
        The app marks a payment refunded from the renter&rsquo;s own device and calls nothing.
        eConfirm never hears about it, so the money is still sitting in escrow exactly where it was
        — and the renter has been told on screen that their refund is being processed. Until the
        refund path is built, each of these has to be sent by hand, and the escrow released to the
        payer rather than the host.
      </Notice>
      ) : null}

      <div className="grid cols-3" style={{ marginBottom: 16 }}>
        <Metric
          label="Refunds claimed"
          value={refunds.length}
          tone={refunds.length > 0 ? 'bad' : 'good'}
          hint="Marked refunded in the app"
        />
        <Metric
          label="Owed to renters"
          value={kes(owed)}
          tone={owed > 0 ? 'bad' : 'good'}
          hint="Not sent to anybody"
        />
        <Metric
          label="Recoverable from escrow"
          value={withEscrow.length}
          hint={`${refunds.length - withEscrow.length} have no escrow behind them`}
        />
      </div>

      <DataTable
        head={['Home', 'Renter', 'Amount', 'Escrow', 'Asked', 'State']}
        placeholder="Search by home, renter or M-Pesa code…"
        noun="refund"
        empty={
          <>
            <strong>Nobody has asked for a refund.</strong>
            Requests made in the app appear here.
          </>
        }>
        {refunds.map((row) => {
          const booking = row.booking_id ? bookingById.get(row.booking_id) : undefined;
          const listing = booking?.listing_id ? listingById.get(booking.listing_id) : undefined;
          const escrowId = (row.econfirm_transaction_id ?? '').trim();
          const recoverable = escrowId.startsWith('txn_');

          const haystack = [
            listing?.title,
            personSearch(booking?.guest_profile_id, people),
            row.payer_phone,
            row.provider_confirmation_code,
            escrowId,
          ]
            .filter(Boolean)
            .join(' ');

          return (
            <tr key={row.id} data-search={haystack}>
              <td>
                <div style={{ fontWeight: 700 }}>{listing?.title ?? 'Listing removed'}</div>
                <div className="mono">{listing?.neighborhood ?? row.booking_id ?? '—'}</div>
              </td>

              <td>
                <PersonCell
                  id={booking?.guest_profile_id}
                  people={people}
                  sub={row.payer_phone ?? undefined}
                />
              </td>

              <td className="num">{kes(row.amount_kes)}</td>

              <td>
                {/* The escrow id is what a manual refund actually needs, so it
                    is on the row rather than a click away. */}
                {recoverable ? (
                  <div className="mono">{escrowId}</div>
                ) : (
                  <Badge value="no escrow" tone="grey" />
                )}
              </td>

              <td className="dim nowrap">
                <div>{ago(row.created_at)}</div>
                <div className="mono">{when(row.created_at)}</div>
              </td>

              <td>
                <Badge value="claimed, not sent" tone="red" />
              </td>
            </tr>
          );
        })}
      </DataTable>

      <div style={{ marginTop: 20 }}>
        <Notice tone="warn" title="What sending one actually takes">
          eConfirm releases an escrow to the seller named on it, which is the host — there is no
          endpoint that returns money to the payer. A refund therefore means releasing to the host
          and having them send it back, or paying the renter directly and writing the escrow off.
          Neither is something this console should do silently, which is why there is no button
          here. Decide the route first, then it is worth building.
        </Notice>
      </div>
    </Shell>
  );
}
