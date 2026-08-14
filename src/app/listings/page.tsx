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
  shortId,
  LoadError,
} from '@/components/ui';
import { requireAdmin } from '@/lib/auth';
import { getListings, getProfiles } from '@/lib/queries';
import { hasServiceRole, sb } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

/**
 * Listings, and the orphan repair.
 *
 * A listing with no owner_profile_id is not a cosmetic problem: bookings made
 * against it record no host, so escrow taken for it can never be paid out to
 * anyone. Assigning an owner here is what unblocks those payouts, and it also
 * backfills host_profile_id on the bookings that were already made.
 */
export default async function ListingsPage() {
  await requireAdmin();

  const [listings, profiles] = await Promise.all([getListings(), getProfiles()]);
  const people = personIndex(profiles.rows);
  const orphans = listings.rows.filter((row) => !row.owner_profile_id);

  async function assignOwner(formData: FormData) {
    'use server';

    const listingId = String(formData.get('listingId') ?? '');
    const ownerId = String(formData.get('ownerId') ?? '');
    if (!listingId || !ownerId) return;

    await sb('listings', {
      query: `id=eq.${listingId}`,
      method: 'PATCH',
      body: { owner_profile_id: ownerId },
    });

    // Bookings already taken against this listing still say host = null, so the
    // owner is backfilled onto them too. Without this the listing looks fixed
    // while its escrow stays unpayable.
    await sb('bookings', {
      query: `listing_id=eq.${listingId}&host_profile_id=is.null`,
      method: 'PATCH',
      body: { host_profile_id: ownerId },
    });

    revalidatePath('/listings');
    revalidatePath('/');
    revalidatePath('/bookings');
  }

  async function togglePause(formData: FormData) {
    'use server';

    const listingId = String(formData.get('listingId') ?? '');
    const paused = String(formData.get('paused') ?? '') === 'true';
    if (!listingId) return;

    await sb('listings', {
      query: `id=eq.${listingId}`,
      method: 'PATCH',
      body: { is_paused: !paused },
    });

    revalidatePath('/listings');
  }

  async function setVerified(formData: FormData) {
    'use server';

    const listingId = String(formData.get('listingId') ?? '');
    const verified = String(formData.get('verified') ?? '') === 'true';
    if (!listingId) return;

    await sb('listings', {
      query: `id=eq.${listingId}`,
      method: 'PATCH',
      body: { verified: !verified },
    });

    revalidatePath('/listings');
  }

  return (
    <Shell>
      <PageHead
        title="Listings"
        description="Every space on the marketplace. Assign owners, pause anything that should not be bookable, and control the verified badge."
      />

      <LoadError error={listings.error} what="listings" keyed={hasServiceRole} />

      <div className="grid cols-3" style={{ marginBottom: 16 }}>
        <Metric label="Total listings" value={listings.rows.length} />
        <Metric
          label="Without an owner"
          value={orphans.length}
          hint={orphans.length > 0 ? 'Escrow on these cannot be paid out' : 'All listings attributed'}
        />
        <Metric
          label="Verified"
          value={listings.rows.filter((row) => row.verified).length}
          hint={`${listings.rows.filter((row) => row.is_paused).length} paused`}
        />
      </div>

      {orphans.length > 0 ? (
        <Notice tone="error" title={`${orphans.length} listing(s) have no owner`}>
          Bookings against these record no host, so their escrow has no destination. Pick the correct
          owner below — the fix is applied to the listing and to any bookings already made against it.
        </Notice>
      ) : null}

      <DataTable
        head={['Listing', 'Where', 'Price', 'Owner', 'State', 'Actions']}
        placeholder="Search by title, area, county or owner…"
        noun="listing"
        filters={[
          { value: 'orphaned', label: 'No owner' },
          { value: 'paused', label: 'Paused' },
          { value: 'live', label: 'Live' },
        ]}
        empty={
          <>
            <strong>No listings yet.</strong>
            Homes appear here as soon as a host publishes one.
          </>
        }>
        {listings.rows.map((row) => {
          const price = row.monthly_rent_kes ?? row.nightly_rate_kes ?? 0;
          const unit = row.monthly_rent_kes ? '/mo' : row.nightly_rate_kes ? '/night' : '';
          const state = !row.owner_profile_id
            ? 'orphaned'
            : row.is_paused
              ? 'paused'
              : row.is_booked
                ? 'booked'
                : 'live';

          const haystack = [
            row.title,
            row.neighborhood,
            row.county,
            personSearch(row.owner_profile_id, people),
            row.id,
          ]
            .filter(Boolean)
            .join(' ');

          return (
            <tr key={row.id} data-search={haystack} data-filter={state}>
                <td>
                  <div style={{ fontWeight: 700 }}>{row.title}</div>
                  <div className="mono">
                    {shortId(row.id, 20)} · {ago(row.created_at)}
                  </div>
                </td>
                <td className="dim">
                  {row.neighborhood ?? '—'}
                  <div className="mono">{row.county ?? ''}</div>
                </td>
                <td className="num">
                  {kes(price)}
                  <span style={{ fontWeight: 500, color: 'var(--muted)' }}>{unit}</span>
                </td>
                <td>
                  {row.owner_profile_id ? (
                    <PersonCell id={row.owner_profile_id} people={people} />
                  ) : (
                    <form action={assignOwner} className="btn-row">
                      <input type="hidden" name="listingId" value={row.id} />
                      <select name="ownerId" defaultValue="" style={{ minWidth: 150 }} required>
                        <option value="" disabled>
                          Assign owner…
                        </option>
                        {profiles.rows.map((profile) => (
                          <option key={profile.id} value={profile.id}>
                            {profile.full_name ?? profile.email ?? profile.id.slice(0, 8)}
                          </option>
                        ))}
                      </select>
                      <button className="btn primary small" type="submit">
                        Save
                      </button>
                    </form>
                  )}
                </td>
                <td>
                  <Badge value={state} />
                  {row.verified ? (
                    <div style={{ marginTop: 4 }}>
                      <Badge value="verified" tone="green" />
                    </div>
                  ) : null}
                </td>
                <td>
                  <div className="btn-row">
                    <form action={togglePause}>
                      <input type="hidden" name="listingId" value={row.id} />
                      <input type="hidden" name="paused" value={String(Boolean(row.is_paused))} />
                      <button className="btn ghost small" type="submit">
                        {row.is_paused ? 'Unpause' : 'Pause'}
                      </button>
                    </form>
                    <form action={setVerified}>
                      <input type="hidden" name="listingId" value={row.id} />
                      <input type="hidden" name="verified" value={String(Boolean(row.verified))} />
                      <button className="btn ghost small" type="submit">
                        {row.verified ? 'Unverify' : 'Verify'}
                      </button>
                    </form>
                  </div>
                </td>
              </tr>
            );
        })}
      </DataTable>
    </Shell>
  );
}
