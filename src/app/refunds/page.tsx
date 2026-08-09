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
} from '@/components/ui';
import { requireAdmin } from '@/lib/auth';
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
  const owed = refunds.reduce((total, row) => total + Number(row.amount_kes ?? 0), 0);

  // A refund on a payment that never had an escrow behind it is a different
  // problem: there is nothing to send back even once sending is built.
  const withEscrow = refunds.filter((row) =>
    (row.econfirm_transaction_id ?? '').startsWith('txn_')
  );

  return (
    <Shell badges={{ '/refunds': refunds.length }}>
      <PageHead
        title="Refunds"
        description="Renters who asked for their money back. None of it has been sent — read the notice below before working this queue."
      />

      {payments.error ? (
        <Notice tone="error" title="Could not load payments">
          {payments.error}
        </Notice>
      ) : null}

      {/* The first thing on the screen, because every row below it is a person
          who has been told something untrue. */}
      <Notice tone="error" title="No refund on this screen has actually been paid">
        The app marks a payment refunded from the renter&rsquo;s own device and calls nothing.
        eConfirm never hears about it, so the money is still sitting in escrow exactly where it was
        — and the renter has been told on screen that their refund is being processed. Until the
        refund path is built, each of these has to be sent by hand, and the escrow released to the
        payer rather than the host.
      </Notice>

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
