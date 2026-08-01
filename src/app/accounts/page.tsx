import { revalidatePath } from 'next/cache';

import { Shell } from '@/components/shell';
import { Badge, Empty, Metric, Notice, PageHead, Table, ago, kes, shortId } from '@/components/ui';
import { requireAdmin } from '@/lib/auth';
import { getBookings, getListings, getPayouts, getProfiles } from '@/lib/queries';
import { sb } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const HOST_TYPES = ['', 'landlord', 'agent', 'bnb_host'] as const;

/**
 * Accounts.
 *
 * The console's main job. Verification gates listing and payout in the app, so
 * granting or revoking it is the single most consequential control here, and it
 * is deliberately not automatic -- somebody reviews the documents and decides.
 *
 * Every row carries what the account has actually done: listings posted,
 * bookings made, money requested. "Is this real?" is answered by behaviour, not
 * by whether a name field is filled in.
 */
export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; q?: string }>;
}) {
  await requireAdmin();

  const params = await searchParams;
  const filter = params.filter ?? 'all';
  const search = (params.q ?? '').trim().toLowerCase();

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

  const earnedByHost = new Map<string, number>();
  for (const row of bookings.rows) {
    if (!row.host_profile_id) continue;
    earnedByHost.set(
      row.host_profile_id,
      (earnedByHost.get(row.host_profile_id) ?? 0) + Number(row.amount_kes ?? 0)
    );
  }

  const requestedByProfile = new Map<string, number>();
  for (const row of payouts.rows) {
    if (!row.profile_id) continue;
    requestedByProfile.set(
      row.profile_id,
      (requestedByProfile.get(row.profile_id) ?? 0) + Number(row.amount_kes ?? 0)
    );
  }

  async function setVerified(formData: FormData) {
    'use server';
    const id = String(formData.get('id') ?? '');
    const next = String(formData.get('next') ?? '') === 'true';
    if (!id) return;

    await sb('profiles', { query: `id=eq.${id}`, method: 'PATCH', body: { verified: next } });
    revalidatePath('/accounts');
    revalidatePath('/');
  }

  async function setRole(formData: FormData) {
    'use server';
    const id = String(formData.get('id') ?? '');
    const role = String(formData.get('role') ?? '');
    const hostType = String(formData.get('host_type') ?? '');
    if (!id) return;

    const patch: Record<string, unknown> = {};
    if (role) patch.role = role;
    patch.host_type = hostType || null;

    const result = await sb('profiles', { query: `id=eq.${id}`, method: 'PATCH', body: patch });

    // host_type arrived in a later migration; if the column is absent, still
    // apply the role rather than losing the whole change.
    if (result.error && 'host_type' in patch) {
      delete patch.host_type;
      if (Object.keys(patch).length > 0) {
        await sb('profiles', { query: `id=eq.${id}`, method: 'PATCH', body: patch });
      }
    }

    revalidatePath('/accounts');
  }

  /**
   * What an account actually is, not what it claims.
   *
   * `role` is a flag the app sets and a renter can end up carrying without ever
   * posting. Owning listings is the fact that matters, so a host is someone
   * with at least one; anyone marked lister but holding none is shown as
   * intending to host, which is who the verification queue exists to serve.
   */
  const accountType = (id: string, role: string | null) => {
    if ((listingsByOwner.get(id) ?? 0) > 0) return 'host' as const;
    if (role === 'lister') return 'host_pending' as const;
    return 'renter' as const;
  };

  const hosts = profiles.rows.filter((row) => (listingsByOwner.get(row.id) ?? 0) > 0);
  const wouldBeHosts = profiles.rows.filter(
    (row) => accountType(row.id, row.role) === 'host_pending'
  );

  const visible = profiles.rows.filter((row) => {
    const type = accountType(row.id, row.role);

    if (filter === 'unverified' && row.verified) return false;
    if (filter === 'hosts' && type === 'renter') return false;
    if (filter === 'renters' && type !== 'renter') return false;
    // Cannot post: wants to host but has not been verified, so the app blocks
    // them. This is the queue that costs the business listings.
    if (filter === 'blocked' && !(type === 'host_pending' && !row.verified)) return false;

    if (!search) return true;
    return `${row.full_name ?? ''} ${row.email ?? ''} ${row.id}`.toLowerCase().includes(search);
  });

  return (
    <Shell badges={{ '/accounts': profiles.rows.filter((row) => !row.verified).length }}>
      <PageHead
        title="Accounts"
        description="Who each account is, and whether they can post. Verification gates posting and payouts in the app, so it is the control that matters most."
      />

      {profiles.error ? (
        <Notice tone="error" title="Could not load accounts">
          {profiles.error}
        </Notice>
      ) : null}

      {/* Toggling verification here bypasses the documents entirely, so the
          reviewed route is pointed at first. */}
      <Notice tone="info" title="Prefer the review queue">
        Verifications carries the submitted documents and records who decided what. Toggling the
        badge below overrides that without looking at anything, so keep it for corrections.
      </Notice>

      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <Metric label="Accounts" value={profiles.rows.length} />
        <Metric label="Hosts" value={hosts.length} hint="Own at least one listing" />
        <Metric
          label="Verified"
          value={profiles.rows.filter((row) => row.verified).length}
          hint={`${profiles.rows.filter((row) => !row.verified).length} awaiting`}
        />
        <Metric
          label="Blocked from posting"
          value={wouldBeHosts.filter((row) => !row.verified).length}
          hint="Want to host, not yet verified"
        />
      </div>

      <form style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <input
          type="search"
          name="q"
          defaultValue={params.q ?? ''}
          placeholder="Search name, email or id…"
          style={{ maxWidth: 320 }}
        />
        <input type="hidden" name="filter" value={filter} />
        <button className="btn ghost" type="submit">
          Search
        </button>
      </form>

      <div className="btn-row" style={{ marginBottom: 14 }}>
        {['all', 'renters', 'hosts', 'unverified', 'blocked'].map((option) => (
          <a
            key={option}
            href={`/accounts?filter=${option}${search ? `&q=${encodeURIComponent(search)}` : ''}`}
            className={`btn ${option === filter ? 'primary' : 'ghost'}`}>
            {option}
          </a>
        ))}
      </div>

      <Table head={['Account', 'Type', 'Activity', 'Value', 'Verification', 'Controls']}>
        {visible.length === 0 ? (
          <Empty>No accounts match.</Empty>
        ) : (
          visible.map((row) => {
            const listingCount = listingsByOwner.get(row.id) ?? 0;
            const bookingCount = bookingsByGuest.get(row.id) ?? 0;

            return (
              <tr key={row.id}>
                <td>
                  <div style={{ fontWeight: 700 }}>{row.full_name ?? 'Unnamed'}</div>
                  <div className="mono">{row.email ?? shortId(row.id, 16)}</div>
                  <div className="mono">joined {ago(row.created_at)}</div>
                </td>
                <td>
                  {(() => {
                    const type = accountType(row.id, row.role);
                    if (type === 'host') return <Badge value="host" tone="green" />;
                    if (type === 'host_pending')
                      return <Badge value="wants to host" tone="amber" />;
                    return <Badge value="renter" tone="grey" />;
                  })()}
                  {row.host_type ? (
                    <div style={{ marginTop: 4 }}>
                      <Badge value={row.host_type} tone="blue" />
                    </div>
                  ) : null}
                  {accountType(row.id, row.role) !== 'renter' && !row.verified ? (
                    <div className="mono" style={{ color: 'var(--amber)', marginTop: 4 }}>
                      cannot post
                    </div>
                  ) : null}
                </td>
                <td className="dim">
                  {listingCount} listing(s)
                  <div className="mono">{bookingCount} booking(s) made</div>
                </td>
                <td className="num">
                  {kes(earnedByHost.get(row.id) ?? 0)}
                  <div className="mono" style={{ fontWeight: 500 }}>
                    {kes(requestedByProfile.get(row.id) ?? 0)} requested
                  </div>
                </td>
                <td>
                  <Badge
                    value={row.verified ? 'verified' : 'unverified'}
                    tone={row.verified ? 'green' : 'amber'}
                  />
                </td>
                <td>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                    <form action={setVerified}>
                      <input type="hidden" name="id" value={row.id} />
                      <input type="hidden" name="next" value={String(!row.verified)} />
                      <button
                        className={`btn ${row.verified ? 'danger' : 'primary'}`}
                        type="submit">
                        {row.verified ? 'Revoke verification' : 'Verify account'}
                      </button>
                    </form>

                    <form action={setRole} className="btn-row">
                      <input type="hidden" name="id" value={row.id} />
                      <select name="role" defaultValue={row.role ?? 'renter'}>
                        <option value="renter">renter</option>
                        <option value="lister">lister</option>
                      </select>
                      <select name="host_type" defaultValue={row.host_type ?? ''}>
                        {HOST_TYPES.map((type) => (
                          <option key={type || 'none'} value={type}>
                            {type || 'no host type'}
                          </option>
                        ))}
                      </select>
                      <button className="btn ghost" type="submit">
                        Save
                      </button>
                    </form>
                  </div>
                </td>
              </tr>
            );
          })
        )}
      </Table>
    </Shell>
  );
}
