import { revalidatePath } from 'next/cache';

import { Shell } from '@/components/shell';
import { Badge, Empty, Metric, Notice, PageHead, Table, ago, shortId, when } from '@/components/ui';
import { requireAdmin } from '@/lib/auth';
import { getProfiles, getVerifications, signedDocUrl } from '@/lib/queries';
import { sb } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const FILTERS = ['pending', 'approved', 'rejected', 'all'] as const;

/**
 * Identity review.
 *
 * The app used to grant the badge the moment someone finished the form, so
 * anyone could self-verify by tapping through. Verification gates listing and
 * payouts, so the decision belongs here, with the documents in front of a
 * person.
 *
 * Approving is what sets profiles.verified. Nothing else in the system does.
 */
export default async function VerificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  await requireAdmin();

  const params = await searchParams;
  const status = params.status ?? 'pending';

  const [requests, profiles] = await Promise.all([getVerifications(status), getProfiles()]);
  const byId = new Map(profiles.rows.map((row) => [row.id, row]));

  const missingTable = Boolean(requests.error && /verification_requests/i.test(requests.error));

  async function decide(formData: FormData) {
    'use server';

    const id = String(formData.get('id') ?? '');
    const profileId = String(formData.get('profileId') ?? '');
    const next = String(formData.get('next') ?? '');
    const note = String(formData.get('note') ?? '').trim();
    if (!id || !next) return;

    await sb('verification_requests', {
      query: `id=eq.${id}`,
      method: 'PATCH',
      body: {
        status: next,
        reviewer_note: note || null,
        reviewed_at: new Date().toISOString(),
      },
    });

    // The badge itself lives on the profile, and this is the only place that
    // grants it. Rejecting also revokes, so a previously approved account
    // cannot keep the badge after a later review fails.
    if (profileId) {
      await sb('profiles', {
        query: `id=eq.${profileId}`,
        method: 'PATCH',
        body: { verified: next === 'approved' },
      });
    }

    revalidatePath('/verifications');
    revalidatePath('/accounts');
    revalidatePath('/');
  }

  return (
    <Shell badges={{ '/verifications': requests.rows.filter((r) => r.status === 'pending').length }}>
      <PageHead
        title="Verifications"
        description="Identity submissions awaiting a decision. Approving here is the only thing that grants the verified badge."
      />

      {missingTable ? (
        <Notice tone="warn" title="Verification table not created yet">
          Run <code>SUPABASE_VERIFICATION.sql</code> against your Supabase project. Until then the
          app cannot submit documents and there is nothing to review.
        </Notice>
      ) : requests.error ? (
        <Notice tone="error" title="Could not load verifications">
          {requests.error}
        </Notice>
      ) : null}

      <div className="grid cols-3" style={{ marginBottom: 16 }}>
        <Metric
          label="Awaiting review"
          value={requests.rows.filter((row) => row.status === 'pending').length}
          hint="Oldest first"
        />
        <Metric label="Shown" value={requests.rows.length} hint={`Filter: ${status}`} />
        <Metric
          label="Oldest waiting"
          value={requests.rows[0] ? ago(requests.rows[0].submitted_at) : '—'}
        />
      </div>

      <div className="btn-row" style={{ marginBottom: 14 }}>
        {FILTERS.map((option) => (
          <a
            key={option}
            href={`/verifications?status=${option}`}
            className={`btn ${option === status ? 'primary' : 'ghost'}`}>
            {option}
          </a>
        ))}
      </div>

      <Table head={['Applicant', 'Claimed name', 'Document', 'Images', 'Submitted', 'Decision']}>
        {requests.rows.length === 0 ? (
          <Empty>
            {missingTable ? 'Create the table to start receiving submissions.' : 'Nothing to review.'}
          </Empty>
        ) : (
          requests.rows.map((row) => {
            const profile = byId.get(row.profile_id);
            const open = row.status === 'pending';

            return (
              <tr key={row.id}>
                <td>
                  <div style={{ fontWeight: 700 }}>{profile?.full_name ?? 'Unknown'}</div>
                  <div className="mono">{profile?.email ?? shortId(row.profile_id, 14)}</div>
                </td>
                <td>
                  <div style={{ fontWeight: 700 }}>{row.legal_name}</div>
                  {/* A claimed name that does not match the account is the most
                      common reason to reject, so the mismatch is called out. */}
                  {profile?.full_name &&
                  profile.full_name.trim().toLowerCase() !== row.legal_name.trim().toLowerCase() ? (
                    <div className="mono" style={{ color: 'var(--warn)' }}>
                      differs from account name
                    </div>
                  ) : null}
                </td>
                <td>
                  <Badge value={row.doc_type} tone="grey" />
                  {row.doc_number ? <div className="mono">{row.doc_number}</div> : null}
                </td>
                <td>
                  <div className="btn-row">
                    {(
                      [
                        ['Front', row.front_url],
                        ['Back', row.back_url],
                        ['Selfie', row.selfie_url],
                      ] as const
                    ).map(([label, path]) =>
                      path ? (
                        <a
                          key={label}
                          className="btn ghost"
                          href={signedDocUrl(path)}
                          target="_blank"
                          rel="noreferrer">
                          {label}
                        </a>
                      ) : (
                        <span key={label} className="mono">
                          no {label.toLowerCase()}
                        </span>
                      )
                    )}
                  </div>
                </td>
                <td className="dim">
                  <div>{ago(row.submitted_at)}</div>
                  <div className="mono">{when(row.submitted_at)}</div>
                </td>
                <td>
                  {open ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 7, minWidth: 210 }}>
                      <form action={decide} className="btn-row">
                        <input type="hidden" name="id" value={row.id} />
                        <input type="hidden" name="profileId" value={row.profile_id} />
                        <input type="hidden" name="next" value="approved" />
                        <button className="btn primary" type="submit">
                          Approve
                        </button>
                      </form>

                      <form action={decide} style={{ display: 'flex', gap: 6 }}>
                        <input type="hidden" name="id" value={row.id} />
                        <input type="hidden" name="profileId" value={row.profile_id} />
                        <input type="hidden" name="next" value="rejected" />
                        <input
                          name="note"
                          type="text"
                          placeholder="Reason shown to them…"
                          style={{ minWidth: 140 }}
                        />
                        <button className="btn danger" type="submit">
                          Reject
                        </button>
                      </form>
                    </div>
                  ) : (
                    <>
                      <Badge value={row.status} />
                      {row.reviewer_note ? (
                        <div className="mono" style={{ marginTop: 4 }}>
                          {row.reviewer_note}
                        </div>
                      ) : null}
                      <div className="mono">{when(row.reviewed_at)}</div>
                    </>
                  )}
                </td>
              </tr>
            );
          })
        )}
      </Table>
    </Shell>
  );
}
