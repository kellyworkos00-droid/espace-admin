import { revalidatePath } from 'next/cache';

import { Shell } from '@/components/shell';
import { Badge, Empty, Metric, Notice, PageHead, Table, kes, shortId } from '@/components/ui';
import { requireAdmin } from '@/lib/auth';
import { getBookings, getListings, getPayouts, getProfiles } from '@/lib/queries';
import { sb } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

/**
 * People.
 *
 * Each row is shown with what they actually have on the platform -- listings,
 * bookings, money requested -- because "is this account real?" is answered by
 * behaviour, not by a name field.
 *
 * Verification is toggleable here since it gates listing and payout in the app,
 * and someone has to be able to grant or revoke it after reviewing documents.
 */
export default async function UsersPage() {
  await requireAdmin();

  const [profiles, listings, bookings, payouts] = await Promise.all([
    getProfiles(),
    getListings(),
    getBookings(),
    getPayouts('all'),
  ]);

  const listingsByOwner = new Map<string, number>();
  for (const row of listings.rows) {
    if (!row.owner_profile_id) continue;
    listingsByOwner.set(row.owner_profile_id, (listingsByOwner.get(row.owner_profile_id) ?? 0) + 1);
  }

  const bookingsByGuest = new Map<string, number>();
  for (const row of bookings.rows) {
    if (!row.guest_profile_id) continue;
    bookingsByGuest.set(row.guest_profile_id, (bookingsByGuest.get(row.guest_profile_id) ?? 0) + 1);
  }

  const payoutsByProfile = new Map<string, number>();
  for (const row of payouts.rows) {
    if (!row.profile_id) continue;
    payoutsByProfile.set(
      row.profile_id,
      (payoutsByProfile.get(row.profile_id) ?? 0) + Number(row.amount_kes ?? 0)
    );
  }

  async function toggleVerified(formData: FormData) {
    'use server';

    const id = String(formData.get('id') ?? '');
    const verified = String(formData.get('verified') ?? '') === 'true';
    if (!id) return;

    await sb('profiles', {
      query: `id=eq.${id}`,
      method: 'PATCH',
      body: { verified: !verified },
    });

    revalidatePath('/users');
  }

  async function setRole(formData: FormData) {
    'use server';

    const id = String(formData.get('id') ?? '');
    const role = String(formData.get('role') ?? '');
    if (!id || !role) return;

    await sb('profiles', { query: `id=eq.${id}`, method: 'PATCH', body: { role } });
    revalidatePath('/users');
  }

  const hosts = profiles.rows.filter((row) => (listingsByOwner.get(row.id) ?? 0) > 0);

  return (
    <Shell>
      <PageHead
        title="Users"
        description="Everyone on the platform, with what they have actually done on it."
      />

      {profiles.error ? (
        <Notice tone="error" title="Could not load profiles">
          {profiles.error}
        </Notice>
      ) : null}

      <div className="grid cols-3" style={{ marginBottom: 16 }}>
        <Metric label="Users" value={profiles.rows.length} />
        <Metric label="Hosts" value={hosts.length} hint="Have at least one listing" />
        <Metric
          label="Verified"
          value={profiles.rows.filter((row) => row.verified).length}
          hint="Identity confirmed"
        />
      </div>

      <Table head={['User', 'Role', 'Listings', 'Bookings', 'Requested', 'Verified', 'Actions']}>
        {profiles.rows.length === 0 ? (
          <Empty>No profiles yet.</Empty>
        ) : (
          profiles.rows.map((row) => (
            <tr key={row.id}>
              <td>
                <div style={{ fontWeight: 700 }}>{row.full_name ?? 'Unnamed'}</div>
                <div className="mono">{row.email ?? shortId(row.id, 14)}</div>
              </td>
              <td>
                <Badge value={row.role ?? 'renter'} tone="grey" />
              </td>
              <td className="num">{listingsByOwner.get(row.id) ?? 0}</td>
              <td className="num">{bookingsByGuest.get(row.id) ?? 0}</td>
              <td className="num">{kes(payoutsByProfile.get(row.id) ?? 0)}</td>
              <td>
                <Badge
                  value={row.verified ? 'verified' : 'unverified'}
                  tone={row.verified ? 'green' : 'grey'}
                />
              </td>
              <td>
                <div className="btn-row">
                  <form action={toggleVerified}>
                    <input type="hidden" name="id" value={row.id} />
                    <input type="hidden" name="verified" value={String(Boolean(row.verified))} />
                    <button className="btn ghost" type="submit">
                      {row.verified ? 'Revoke' : 'Verify'}
                    </button>
                  </form>
                  <form action={setRole} className="btn-row">
                    <input type="hidden" name="id" value={row.id} />
                    <select name="role" defaultValue={row.role ?? 'renter'}>
                      <option value="renter">renter</option>
                      <option value="lister">lister</option>
                    </select>
                    <button className="btn ghost" type="submit">
                      Set
                    </button>
                  </form>
                </div>
              </td>
            </tr>
          ))
        )}
      </Table>
    </Shell>
  );
}
