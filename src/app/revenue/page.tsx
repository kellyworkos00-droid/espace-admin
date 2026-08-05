import { Shell } from '@/components/shell';
import {
  Empty,
  Metric,
  Notice,
  PageHead,
  PersonCell,
  SectionTitle,
  Table,
  kes,
  personIndex,
} from '@/components/ui';
import { requireAdmin } from '@/lib/auth';
import { getBookings, getListings, getPayments, getProfiles } from '@/lib/queries';

export const dynamic = 'force-dynamic';

/**
 * Revenue.
 *
 * The honest headline of this screen is that there is none. E Space takes no
 * commission today: a renter pays the listed price, the whole of it sits in
 * escrow, and the whole of it reaches the host. The only "commissionRate" in
 * the codebase is 0.1 sitting in bookingExample in mock-data.ts, referenced by
 * nothing, and the host's withdrawable balance is released minus refunds minus
 * withdrawals already taken -- no deduction anywhere in it.
 *
 * So this screen models rather than reports, and says so in the first thing
 * you read. Everything under "what a rate would yield" is arithmetic on real
 * completed bookings, not money anyone has earned. A dashboard that showed a
 * modelled figure as revenue would be the same fault as ranking homes against
 * preferences nobody was ever asked for: a real-looking number standing in for
 * something that never happened.
 *
 * It is worth having anyway. Choosing a rate is guesswork without knowing what
 * each one would have taken from the volume that already exists, and who it
 * would have come from.
 */

/** Rates worth comparing. Airbnb's guest-plus-host take lands near 14-16%; Booking.com charges hosts 15-18%. */
const RATES = [5, 7.5, 10, 15] as const;

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
  const rate = RATES.includes(parsed as (typeof RATES)[number]) ? parsed : 10;

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

  const released = payments.rows.filter((row) => row.status === 'released');
  const held = payments.rows.filter((row) => row.status === 'held' || row.status === 'pending');
  const refunded = payments.rows.filter((row) => row.status === 'refunded');

  const releasedKes = sum(released);
  const heldKes = sum(held);
  const refundedKes = sum(refunded);

  // Modelled on completed bookings only. A commission on money still sitting in
  // escrow has not been earned by anyone yet, and a commission on a refunded
  // booking would have had to be given back with it.
  const modelled = (releasedKes * rate) / 100;
  const modelledIncludingHeld = ((releasedKes + heldKes) * rate) / 100;

  const byMonth = new Map<string, number>();
  for (const row of released) {
    const key = monthKey(row.created_at);
    if (!key) continue;
    byMonth.set(key, (byMonth.get(key) ?? 0) + Number(row.amount_kes ?? 0));
  }
  const months = [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  const byHost = new Map<string, { released: number; bookings: number }>();
  for (const row of released) {
    const booking = row.booking_id ? bookingById.get(row.booking_id) : undefined;
    const listing = booking?.listing_id ? listingById.get(booking.listing_id) : undefined;
    const hostId = booking?.host_profile_id ?? listing?.owner_profile_id;
    if (!hostId) continue;

    const entry = byHost.get(hostId) ?? { released: 0, bookings: 0 };
    entry.released += Number(row.amount_kes ?? 0);
    entry.bookings += 1;
    byHost.set(hostId, entry);
  }
  const hosts = [...byHost.entries()].sort((a, b) => b[1].released - a[1].released).slice(0, 10);

  return (
    <Shell>
      <PageHead
        title="Revenue"
        description="What E Space earns from the marketplace, and what it would earn at a rate it has not set yet."
      />

      {payments.error ? (
        <Notice tone="error" title="Could not load payments">
          {payments.error}
        </Notice>
      ) : null}

      {/* First thing on the screen, because every figure below it is
          conditional on this being true. */}
      <Notice tone="info" title="E Space charges no commission today">
        A renter pays the listed price, the whole of it goes into escrow, and the whole of it
        reaches the host. Nothing in the app deducts a fee: the withdrawable balance is released
        minus refunds minus withdrawals already taken. Clause 7 of the Terms reserves the right to
        charge one — &ldquo;any service fee is shown before you confirm a booking&rdquo; — but no
        fee has ever been shown, because none exists.
      </Notice>

      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <Metric
          label="Commission earned"
          value={kes(0)}
          hint="No rate is set anywhere in the app"
        />
        <Metric
          label="Paid to hosts"
          value={kes(releasedKes)}
          tone="good"
          hint={`${released.length} completed booking(s), in full`}
        />
        <Metric
          label="Still in escrow"
          value={kes(heldKes)}
          tone="info"
          hint={`${held.length} payment(s) not yet released`}
        />
        <Metric
          label="Refunded"
          value={kes(refundedKes)}
          hint={`${refunded.length} returned to the payer`}
        />
      </div>

      <SectionTitle>If a commission were charged</SectionTitle>

      <div className="chips" style={{ marginBottom: 14 }}>
        {RATES.map((option) => (
          <a
            key={option}
            href={`/revenue?rate=${option}`}
            className="chip"
            aria-current={option === rate ? 'page' : undefined}>
            {option}%
          </a>
        ))}
      </div>

      <div className="grid cols-3" style={{ marginBottom: 20 }}>
        <Metric
          label={`At ${rate}% of completed bookings`}
          value={kes(modelled)}
          hint="Never charged, never collected"
        />
        <Metric
          label="Including escrow still held"
          value={kes(modelledIncludingHeld)}
          hint="If everything currently held completes"
        />
        <Metric
          label="Hosts would have received"
          value={kes(releasedKes - modelled)}
          hint={`${kes(modelled)} less than they actually did`}
        />
      </div>

      <div className="grid cols-2" style={{ marginBottom: 20 }}>
        <div>
          <SectionTitle count={months.length}>By month</SectionTitle>
          <Table head={['Month', 'Released', `At ${rate}%`]}>
            {months.length === 0 ? (
              <Empty>
                <strong>No completed bookings yet.</strong>
                A month appears here once its first escrow is released.
              </Empty>
            ) : (
              months.map(([month, value]) => (
                <tr key={month}>
                  <td className="mono">{month}</td>
                  <td className="num">{kes(value)}</td>
                  <td className="num">{kes((value * rate) / 100)}</td>
                </tr>
              ))
            )}
          </Table>
        </div>

        <div>
          <SectionTitle count={hosts.length}>Who it would come from</SectionTitle>
          <Table head={['Host', 'Released', `At ${rate}%`]}>
            {hosts.length === 0 ? (
              <Empty>
                <strong>No host earnings yet.</strong>
                Hosts appear once their first booking completes.
              </Empty>
            ) : (
              hosts.map(([hostId, entry]) => (
                <tr key={hostId}>
                  <td>
                    <PersonCell
                      id={hostId}
                      people={people}
                      sub={`${entry.bookings} booking(s)`}
                    />
                  </td>
                  <td className="num">{kes(entry.released)}</td>
                  <td className="num">{kes((entry.released * rate) / 100)}</td>
                </tr>
              ))
            )}
          </Table>
        </div>
      </div>

      {/* The constraint that decides how a commission can be charged at all.
          Worth stating here rather than discovering it halfway through
          building the feature. */}
      <Notice tone="warn" title="Charging one is not a settings change">
        eConfirm names a single seller per escrow and its release endpoint pays that seller in full —
        there is no split, and no payout endpoint to take a share with. So a commission needs one of
        two things: a second escrow per booking with E Space as the seller, or the platform fee
        charged to the renter as a separate M-Pesa prompt alongside the one that funds the escrow.
        Either way the fee has to appear on the checkout breakdown before payment, because clause 7
        promises exactly that.
      </Notice>
    </Shell>
  );
}
