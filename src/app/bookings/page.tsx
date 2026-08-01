import { Shell } from '@/components/shell';
import { Badge, Empty, Metric, Notice, PageHead, Table, ago, kes, shortId } from '@/components/ui';
import { requireAdmin } from '@/lib/auth';
import { getBookings, getListings, getProfiles } from '@/lib/queries';

export const dynamic = 'force-dynamic';

/**
 * Bookings.
 *
 * Read-only on purpose. A booking is an agreement between two people, and the
 * console has no business rewriting it -- what an operator actually needs is
 * money control (escrow, payouts) and supply control (listings). Those live on
 * their own screens.
 *
 * The one thing flagged here is a booking with no host, because that is the
 * shape of a payout that can never complete.
 */
export default async function BookingsPage() {
  await requireAdmin();

  const [bookings, listings, profiles] = await Promise.all([
    getBookings(),
    getListings(),
    getProfiles(),
  ]);

  const listingById = new Map(listings.rows.map((row) => [row.id, row]));
  const profileById = new Map(profiles.rows.map((row) => [row.id, row]));

  const missingHost = bookings.rows.filter((row) => !row.host_profile_id);
  const value = bookings.rows.reduce((total, row) => total + Number(row.amount_kes ?? 0), 0);

  return (
    <Shell>
      <PageHead
        title="Bookings"
        description="Every booking made through the app, who it belongs to, and whether its money can actually reach a host."
      />

      {bookings.error ? (
        <Notice tone="error" title="Could not load bookings">
          {bookings.error}
        </Notice>
      ) : null}

      <div className="grid cols-3" style={{ marginBottom: 16 }}>
        <Metric label="Bookings" value={bookings.rows.length} />
        <Metric label="Total value" value={kes(value)} />
        <Metric
          label="Missing a host"
          value={missingHost.length}
          hint={missingHost.length > 0 ? 'Payout impossible until fixed' : 'All attributed'}
        />
      </div>

      {missingHost.length > 0 ? (
        <Notice tone="error" title={`${missingHost.length} booking(s) have no host`}>
          These came from listings with no owner. Assign the owner on the Listings screen and the host
          is backfilled here automatically.
        </Notice>
      ) : null}

      <Table head={['Listing', 'Guest', 'Host', 'Dates', 'Amount', 'Status', 'Payment']}>
        {bookings.rows.length === 0 ? (
          <Empty>No bookings yet.</Empty>
        ) : (
          bookings.rows.map((row) => {
            const listing = row.listing_id ? listingById.get(row.listing_id) : undefined;
            const guest = row.guest_profile_id ? profileById.get(row.guest_profile_id) : undefined;
            const host = row.host_profile_id ? profileById.get(row.host_profile_id) : undefined;

            return (
              <tr key={row.id}>
                <td>
                  <div style={{ fontWeight: 700 }}>{listing?.title ?? '—'}</div>
                  <div className="mono">{ago(row.created_at)}</div>
                </td>
                <td className="dim">
                  {guest?.full_name ?? guest?.email ?? (
                    <span className="mono">{shortId(row.guest_profile_id) || 'none'}</span>
                  )}
                </td>
                <td className="dim">
                  {host?.full_name ?? host?.email ?? (
                    <span className="mono" style={{ color: 'var(--red)' }}>
                      no host
                    </span>
                  )}
                </td>
                <td className="dim">
                  {row.check_in_date ?? '—'}
                  <div className="mono">to {row.check_out_date ?? '—'}</div>
                </td>
                <td className="num">{kes(row.amount_kes)}</td>
                <td>
                  <Badge value={row.request_status ?? row.status} />
                </td>
                <td>
                  <Badge value={row.payment_status ?? 'none'} />
                </td>
              </tr>
            );
          })
        )}
      </Table>
    </Shell>
  );
}
