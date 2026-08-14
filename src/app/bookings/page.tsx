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
  LoadError,
} from '@/components/ui';
import { requireAdmin } from '@/lib/auth';
import { hasServiceRole } from '@/lib/supabase';
import { getBookings, getListings, getProfiles, type BookingRow } from '@/lib/queries';

export const dynamic = 'force-dynamic';

/**
 * The dates a booking actually holds.
 *
 * The app writes move_in_date/checkout_date; the check_in_date/check_out_date
 * pair exists on the table and is left null. This screen read only the null
 * pair, so every booking ever shown here displayed "— to —" -- a column of
 * dashes where the stay window belonged, on the one screen you would visit in
 * order to check a stay window.
 *
 * The same mistake made a health check pass while a double-booking was live,
 * which is how it came to light.
 */
function stayWindow(row: BookingRow) {
  return {
    start: row.check_in_date ?? row.move_in_date ?? null,
    end: row.check_out_date ?? row.checkout_date ?? null,
  };
}

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
  const people = personIndex(profiles.rows);

  const missingHost = bookings.rows.filter((row) => !row.host_profile_id);
  const value = bookings.rows.reduce((total, row) => total + Number(row.amount_kes ?? 0), 0);

  return (
    <Shell>
      <PageHead
        title="Bookings"
        description="Every booking made through the app, who it belongs to, and whether its money can actually reach a host."
      />

      <LoadError error={bookings.error} what="bookings" keyed={hasServiceRole} />

      <div className="grid cols-3" style={{ marginBottom: 16 }}>
        <Metric label="Bookings" value={bookings.rows.length} />
        <Metric label="Total value" value={kes(value)} />
        <Metric
          label="Missing a host"
          value={missingHost.length}
          tone={missingHost.length > 0 ? 'bad' : 'good'}
          hint={missingHost.length > 0 ? 'Payout impossible until fixed' : 'All attributed'}
        />
      </div>

      {missingHost.length > 0 ? (
        <Notice tone="error" title={`${missingHost.length} booking(s) have no host`}>
          These came from listings with no owner. Assign the owner on the Listings screen and the
          host is backfilled here automatically.
        </Notice>
      ) : null}

      <DataTable
        head={['Listing', 'Guest', 'Host', 'Dates', 'Amount', 'Status', 'Payment']}
        placeholder="Search by listing, guest or host…"
        noun="booking"
        filters={[
          { value: 'no-host', label: 'No host' },
          { value: 'paid', label: 'Paid' },
          { value: 'unpaid', label: 'Unpaid' },
        ]}
        empty={
          <>
            <strong>No bookings yet.</strong>
            They appear the moment someone books a home in the app.
          </>
        }>
        {bookings.rows.map((row) => {
          const listing = row.listing_id ? listingById.get(row.listing_id) : undefined;
          const { start, end } = stayWindow(row);
          const settled = row.payment_status === 'held' || row.payment_status === 'released';

          const haystack = [
            listing?.title,
            listing?.neighborhood,
            listing?.county,
            personSearch(row.guest_profile_id, people),
            personSearch(row.host_profile_id, people),
            row.id,
          ]
            .filter(Boolean)
            .join(' ');

          return (
            <tr
              key={row.id}
              data-search={haystack}
              data-filter={!row.host_profile_id ? 'no-host' : settled ? 'paid' : 'unpaid'}>
              <td>
                <div style={{ fontWeight: 700 }}>{listing?.title ?? 'Listing removed'}</div>
                <div className="mono">booked {ago(row.created_at)}</div>
              </td>

              <td>
                <PersonCell id={row.guest_profile_id} people={people} />
              </td>

              <td>
                <PersonCell id={row.host_profile_id} people={people} />
              </td>

              <td className="dim nowrap">
                {start ?? '—'}
                <div className="mono">to {end ?? '—'}</div>
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
        })}
      </DataTable>
    </Shell>
  );
}
