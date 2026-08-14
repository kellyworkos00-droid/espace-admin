import { DataTable } from '@/components/data-table';
import { Shell } from '@/components/shell';
import {
  Badge,
  Empty,
  Metric,
  Notice,
  PageHead,
  PersonCell,
  SectionTitle,
  Table,
  ago,
  kes,
  personIndex,
  personSearch,
} from '@/components/ui';
import { requireAdmin } from '@/lib/auth';
import { getBookings, getListings, getPayments, getProfiles } from '@/lib/queries';

export const dynamic = 'force-dynamic';

/**
 * Commission.
 *
 * E Space's model is 10% of every booking. This screen is the ledger for it:
 * what each booking owes, what has actually been separated, and the gap
 * between the two.
 *
 * The gap is currently the whole of it, and that is the finding this screen
 * exists to surface. Checked against the live eConfirm API on every escrow the
 * app has ever created:
 *
 *   txn_LC2IXS9ZQBOX  escrow 100  Escrow Funded  paid out -
 *   txn_ZCVXTTZRBFJN  escrow 100  Completed      paid out 100.00
 *   txn_PUNSOTQMHNTQ  escrow 100  Completed      paid out 100.00
 *
 * Both completed escrows released the full amount to the host, and no
 * transaction record carries a fee, commission, net or split field anywhere in
 * it. Our own create payload sends amount, receiver_phone and seller_email and
 * nothing else -- there is no field in which to ask for a share.
 *
 * So commission collected is 0, and it is shown as 0. A screen that multiplied
 * bookings by 10% and called the answer revenue would report earnings that
 * never reached anybody, which is worse than reporting nothing: it is the one
 * number here that would be acted on financially.
 *
 * The moment eConfirm does separate a share, it shows up as a payout smaller
 * than the escrow that funded it, and `collected` below starts filling in on
 * its own.
 */

/** 10% is the model. The others are here to compare against, not to switch to casually. */
const RATES = [5, 7.5, 10, 15] as const;
const MODEL_RATE = 10;

function monthKey(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export default async function RevenuePage({
  searchParams,
}: {
  searchParams: Promise<{ rate?: string }>;
}) {
  await requireAdmin();

  const params = await searchParams;
  const parsed = Number(params.rate);
  const rate = RATES.includes(parsed as (typeof RATES)[number]) ? parsed : MODEL_RATE;

  const [payments, bookings, listings, profiles] = await Promise.all([
    getPayments('all'),
    getBookings(),
    getListings(),
    getProfiles(),
  ]);

  const people = personIndex(profiles.rows);
  const bookingById = new Map(bookings.rows.map((row) => [row.id, row]));
  const listingById = new Map(listings.rows.map((row) => [row.id, row]));

  const sum = (rows: { amount_kes: number | null }[]) =>
    rows.reduce((total, row) => total + Number(row.amount_kes ?? 0), 0);

  const earning = payments.rows.filter(
    (row) => row.status === 'released' || row.status === 'held' || row.status === 'pending'
  );
  const released = payments.rows.filter((row) => row.status === 'released');
  const held = payments.rows.filter((row) => row.status === 'held' || row.status === 'pending');
  const refunded = payments.rows.filter((row) => row.status === 'refunded');

  const releasedKes = sum(released);
  const heldKes = sum(held);
  const bookedKes = sum(earning);

  // Due on completed bookings. A refunded booking earns nothing -- the
  // commission would have had to go back with the refund -- and one still in
  // escrow has not completed, so it is counted separately.
  const dueOnReleased = (releasedKes * rate) / 100;
  const dueOnHeld = (heldKes * rate) / 100;

  /**
   * What the bookings themselves say, now that they carry it.
   *
   * This used to be a projection: bookings multiplied by a rate the reader
   * chose from a dropdown. Useful for asking "what if", useless as a ledger,
   * because nothing recorded what any particular booking actually earned.
   * Bookings now carry commission_kes and the rate that produced it, so these
   * are read rather than modelled -- and a rate change next year does not
   * silently rewrite last year.
   */
  const live = bookings.rows.filter((row) => row.status !== 'cancelled');
  const earnedKes = live.reduce((total, row) => total + Number(row.commission_kes ?? 0), 0);
  const collectedKes = live
    .filter((row) => row.commission_status === 'collected')
    .reduce((total, row) => total + Number(row.commission_kes ?? 0), 0);
  const outstandingKes = live
    .filter((row) => (row.commission_status ?? 'pending') === 'pending')
    .reduce((total, row) => total + Number(row.commission_kes ?? 0), 0);
  const unpriced = live.filter(
    (row) => row.commission_kes == null && Number(row.amount_kes ?? 0) > 0
  ).length;

  const collected = collectedKes;
  const shortfall = earnedKes - collectedKes;

  const byMonth = new Map<string, { released: number; count: number }>();
  for (const row of released) {
    const key = monthKey(row.created_at);
    if (!key) continue;
    const entry = byMonth.get(key) ?? { released: 0, count: 0 };
    entry.released += Number(row.amount_kes ?? 0);
    entry.count += 1;
    byMonth.set(key, entry);
  }
  const months = [...byMonth.entries()].sort((a, b) => b[0].localeCompare(a[0]));

  const hostOf = (paymentBookingId: string | null) => {
    const booking = paymentBookingId ? bookingById.get(paymentBookingId) : undefined;
    const listing = booking?.listing_id ? listingById.get(booking.listing_id) : undefined;
    return { booking, listing, hostId: booking?.host_profile_id ?? listing?.owner_profile_id ?? null };
  };

  const byHost = new Map<string, { released: number; count: number }>();
  for (const row of released) {
    const { hostId } = hostOf(row.booking_id);
    if (!hostId) continue;
    const entry = byHost.get(hostId) ?? { released: 0, count: 0 };
    entry.released += Number(row.amount_kes ?? 0);
    entry.count += 1;
    byHost.set(hostId, entry);
  }
  const hosts = [...byHost.entries()].sort((a, b) => b[1].released - a[1].released);

  return (
    <Shell>
      <PageHead
        title="Commission"
        description={`E Space takes ${MODEL_RATE}% of every booking. This is what that owes, what has been separated, and the difference.`}
      />

      {payments.error ? (
        <Notice tone="error" title="Could not load payments">
          {payments.error}
        </Notice>
      ) : null}

      {/* What this screen is and is not. */}
      <Notice tone="info" title="eConfirm separates the funds; this is our record of it">
        The split happens on eConfirm&rsquo;s side when an escrow is released, so nothing here moves
        money. What this screen does is keep our own account of it: every booking now records what it
        earns and the rate that produced it, marked <strong>collected</strong> the moment its escrow
        is released and <strong>outstanding</strong> until then. Worth reconciling against
        eConfirm&rsquo;s own statements — two records of the same money that have never been compared
        are two records nobody should trust.
      </Notice>

      {/* The recorded ledger, before any of the projections below it. */}
      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <Metric
          label="Commission earned"
          value={kes(earnedKes)}
          hint={`Recorded on ${live.length} booking${live.length === 1 ? '' : 's'}`}
        />
        <Metric
          label="Collected"
          value={kes(collectedKes)}
          tone={collectedKes > 0 ? 'good' : 'bad'}
          hint={collectedKes === 0 ? 'Nothing has been separated yet' : 'Marked collected'}
        />
        <Metric
          label="Outstanding"
          value={kes(outstandingKes)}
          tone={outstandingKes > 0 ? 'bad' : 'good'}
          hint="Earned, not received"
        />
        <Metric
          label="Unpriced bookings"
          value={unpriced}
          tone={unpriced > 0 ? 'warn' : 'good'}
          hint={unpriced > 0 ? 'Made before commission was recorded' : 'Every booking is priced'}
        />
      </div>

      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <Metric
          label={`Commission due at ${rate}%`}
          value={kes(dueOnReleased)}
          tone="warn"
          hint={`On ${released.length} completed booking(s)`}
        />
        <Metric
          label="Actually separated"
          value={kes(collected)}
          tone="bad"
          hint="No split recorded on any escrow"
        />
        <Metric
          label="Uncollected"
          value={kes(shortfall)}
          tone="bad"
          hint="Owed to E Space, paid to hosts instead"
        />
        <Metric
          label="Coming, if escrow completes"
          value={kes(dueOnHeld)}
          tone="info"
          hint={`${rate}% of ${kes(heldKes)} still held`}
        />
      </div>

      <div className="chips" style={{ marginBottom: 20 }}>
        {RATES.map((option) => (
          <a
            key={option}
            href={`/revenue?rate=${option}`}
            className="chip"
            aria-current={option === rate ? 'page' : undefined}>
            {option}%{option === MODEL_RATE ? ' · the model' : ''}
          </a>
        ))}
      </div>

      <div className="grid cols-2" style={{ marginBottom: 20 }}>
        <div>
          <SectionTitle count={months.length}>By month</SectionTitle>
          <Table head={['Month', 'Bookings', 'Completed value', `Due at ${rate}%`]}>
            {months.length === 0 ? (
              <Empty>
                <strong>No completed bookings yet.</strong>
                A month appears once its first escrow is released.
              </Empty>
            ) : (
              months.map(([month, entry]) => (
                <tr key={month}>
                  <td className="mono">{month}</td>
                  <td className="num">{entry.count}</td>
                  <td className="num">{kes(entry.released)}</td>
                  <td className="num">{kes((entry.released * rate) / 100)}</td>
                </tr>
              ))
            )}
          </Table>
        </div>

        <div>
          <SectionTitle count={hosts.length}>By host</SectionTitle>
          <Table head={['Host', 'Completed value', `Due at ${rate}%`]}>
            {hosts.length === 0 ? (
              <Empty>
                <strong>No host earnings yet.</strong>
                Hosts appear once their first booking completes.
              </Empty>
            ) : (
              hosts.map(([hostId, entry]) => (
                <tr key={hostId}>
                  <td>
                    <PersonCell id={hostId} people={people} sub={`${entry.count} booking(s)`} />
                  </td>
                  <td className="num">{kes(entry.released)}</td>
                  <td className="num">{kes((entry.released * rate) / 100)}</td>
                </tr>
              ))
            )}
          </Table>
        </div>
      </div>

      <SectionTitle count={earning.length}>Every booking</SectionTitle>

      <DataTable
        head={['Booking', 'Host', 'Paid', `Due at ${rate}%`, 'Separated', 'Escrow', 'When']}
        placeholder="Search by listing, host or M-Pesa code…"
        noun="booking"
        filters={[
          { value: 'released', label: 'Completed' },
          { value: 'held', label: 'In escrow' },
        ]}
        empty={
          <>
            <strong>No bookings have been paid for yet.</strong>
            Each one appears here with the commission it owes.
          </>
        }>
        {earning.map((row) => {
          const { booking, listing, hostId } = hostOf(row.booking_id);
          const amount = Number(row.amount_kes ?? 0);
          const due = (amount * rate) / 100;
          const complete = row.status === 'released';

          const haystack = [
            listing?.title,
            personSearch(hostId, people),
            row.provider_confirmation_code,
            row.econfirm_transaction_id,
            booking?.id,
          ]
            .filter(Boolean)
            .join(' ');

          return (
            <tr key={row.id} data-search={haystack} data-filter={complete ? 'released' : 'held'}>
              <td>
                <div style={{ fontWeight: 700 }}>{listing?.title ?? 'Listing removed'}</div>
                <div className="mono">{row.provider_confirmation_code ?? row.id}</div>
              </td>

              <td>
                <PersonCell id={hostId} people={people} />
              </td>

              <td className="num">{kes(amount)}</td>

              <td className="num" style={{ color: 'var(--warn)' }}>
                {kes(due)}
              </td>

              <td>
                {/* Stated per booking rather than only in the headline, because
                    this is the column that would change first if a split were
                    ever switched on. */}
                {complete ? (
                  <Badge value="none — host got it all" tone="red" />
                ) : (
                  <Badge value="not yet due" tone="grey" />
                )}
              </td>

              <td>
                <Badge value={row.status} />
              </td>

              <td className="dim nowrap">{ago(row.created_at)}</td>
            </tr>
          );
        })}
      </DataTable>

      <div style={{ marginTop: 20 }}>
        <Notice tone="warn" title="What it takes to actually collect it">
          eConfirm names one seller per escrow and its release pays that seller in full — there is no
          split parameter in the create call and no payout endpoint to take a share with. Ask
          eConfirm whether a platform commission can be set on the API account, so the release pays
          the host {100 - rate}% and settles the rest to E Space. If it cannot, the fee has to be a
          second charge on the renter alongside the escrow prompt. Either way it must appear on the
          checkout breakdown before payment, because clause 7 of the Terms promises the service fee
          is shown before a booking is confirmed — and right now the checkout shows no fee line at
          all. Total booked through the app so far: {kes(bookedKes)}
          {refunded.length > 0 ? `, with ${kes(sum(refunded))} refunded` : ''}.
        </Notice>
      </div>
    </Shell>
  );
}
