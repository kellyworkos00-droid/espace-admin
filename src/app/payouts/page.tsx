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
import { getPayouts, getProfiles, getVerifications, type VerificationRow } from '@/lib/queries';
import { hasServiceRole, sb } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const FILTERS = ['pending', 'processing', 'paid', 'failed', 'all'] as const;

/**
 * The payout queue.
 *
 * Payouts are sent by hand, so this is the only screen in the console that is
 * a task list rather than a report. The flow mirrors what actually happens:
 * mark it processing when you start the M-Pesa transfer, mark it paid once the
 * money has left, or record why it failed.
 *
 * Marking paid does not move money. It records that a human did.
 *
 * The status filter stays in the URL and is answered by the database, because
 * it decides which rows are fetched at all. The search box on top of it is
 * client-side and narrows what came back -- which is the question an operator
 * actually arrives with ("where is Mary's payout?"), and one the old screen
 * could only answer by scrolling.
 */
export default async function PayoutsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  await requireAdmin();

  const params = await searchParams;
  const status = params.status ?? 'pending';

  const [payouts, profiles, verifications] = await Promise.all([
    getPayouts(status),
    getProfiles(),
    getVerifications('all'),
  ]);
  const people = personIndex(profiles.rows);

  // Payouts are meant to unlock only once an ID is approved, and the app does
  // not enforce that yet, so this screen has to: who is asking, and has
  // anybody actually seen their ID?
  const verified = new Set(profiles.rows.filter((row) => row.verified).map((row) => row.id));
  const latestRequest = new Map<string, VerificationRow>();
  for (const row of verifications.rows) latestRequest.set(row.profile_id, row); // oldest first, so the newest wins
  const approvedId = new Set(
    verifications.rows.filter((row) => row.status === 'approved').map((row) => row.profile_id)
  );
  const unchecked = payouts.rows.filter(
    (row) =>
      (row.status === 'pending' || row.status === 'processing') &&
      !(row.profile_id && verified.has(row.profile_id) && approvedId.has(row.profile_id))
  );

  const queuedTotal = payouts.rows
    .filter((row) => row.status === 'pending' || row.status === 'processing')
    .reduce((total, row) => total + Number(row.amount_kes ?? 0), 0);

  async function setStatus(formData: FormData) {
    'use server';

    const id = String(formData.get('id') ?? '');
    const next = String(formData.get('next') ?? '');
    const reason = String(formData.get('reason') ?? '').trim();
    if (!id || !next) return;

    const patch: Record<string, unknown> = { status: next };

    // processed_at marks when a human finished with it, so it is set for both
    // terminal states and cleared if something is put back in the queue.
    if (next === 'paid' || next === 'failed' || next === 'cancelled') {
      patch.processed_at = new Date().toISOString();
    } else {
      patch.processed_at = null;
    }
    if (next === 'failed' && reason) patch.failure_reason = reason;

    const result = await sb('payout_requests', {
      query: `id=eq.${id}`,
      method: 'PATCH',
      body: patch,
    });

    // failure_reason only exists after SUPABASE_PAYOUT_DESTINATION.sql has run;
    // without it, retry without that field rather than losing the status change.
    if (result.error && 'failure_reason' in patch) {
      delete patch.failure_reason;
      await sb('payout_requests', { query: `id=eq.${id}`, method: 'PATCH', body: patch });
    }

    revalidatePath('/payouts');
    revalidatePath('/');
  }

  return (
    <Shell badges={{ '/payouts': payouts.rows.filter((r) => r.status === 'pending').length }}>
      <PageHead
        title="Payouts"
        description="Hosts requesting their escrow-released earnings. Send the M-Pesa transfer, then record it here."
      />

      <LoadError error={payouts.error} what="payouts" keyed={hasServiceRole} />

      {unchecked.length > 0 ? (
        <Notice
          tone="warn"
          title={`${unchecked.length} open ${unchecked.length === 1 ? 'request is' : 'requests are'} from hosts whose ID you have not approved`}>
          Check the Identity column before you send money. Open their ID from there.
        </Notice>
      ) : null}

      <div className="grid cols-3" style={{ marginBottom: 16 }}>
        <Metric
          label="Queued value"
          value={kes(queuedTotal)}
          tone={queuedTotal > 0 ? 'warn' : 'good'}
          hint="Pending and processing"
        />
        <Metric
          label="Requests shown"
          value={payouts.rows.length}
          hint={status === 'all' ? 'All statuses' : `Filtered: ${status}`}
        />
        <Metric
          label="Oldest waiting"
          value={payouts.rows[0] ? ago(payouts.rows[0].created_at) : '—'}
          hint="Queue is worked oldest first"
        />
      </div>

      <div className="chips" style={{ marginBottom: 14 }}>
        {FILTERS.map((option) => (
          <a
            key={option}
            href={`/payouts?status=${option}`}
            className="chip"
            aria-current={option === status ? 'page' : undefined}>
            {option}
          </a>
        ))}
      </div>

      <DataTable
        head={['Host', 'Identity', 'Amount', 'Send to', 'Requested', 'Status', 'Action']}
        placeholder="Search by host name, email or M-Pesa number…"
        noun="request"
        empty={
          <>
            <strong>Nothing with this status.</strong>
            Every payout here has been dealt with.
          </>
        }>
        {payouts.rows.map((row) => {
          const open = row.status === 'pending' || row.status === 'processing';
          const haystack = [
            personSearch(row.profile_id, people),
            row.destination_phone,
            row.destination_name,
            row.reference_note,
            row.id,
          ]
            .filter(Boolean)
            .join(' ');

          return (
            <tr key={row.id} data-search={haystack}>
              <td>
                <PersonCell id={row.profile_id} people={people} />
              </td>

              <td>
                <Identity
                  profileId={row.profile_id}
                  verified={Boolean(row.profile_id && verified.has(row.profile_id))}
                  request={row.profile_id ? latestRequest.get(row.profile_id) : undefined}
                />
              </td>

              <td className="num">{kes(row.amount_kes)}</td>

              <td>
                <div style={{ fontWeight: 700 }}>{row.destination_phone ?? '—'}</div>
                <div className="mono">
                  {row.destination_name ?? row.reference_note ?? row.payout_method}
                </div>
              </td>

              <td className="dim nowrap">
                <div>{ago(row.created_at)}</div>
                <div className="mono">{when(row.created_at)}</div>
              </td>

              <td>
                <Badge value={row.status} />
                {row.failure_reason ? (
                  <div className="mono" style={{ marginTop: 4 }}>
                    {row.failure_reason}
                  </div>
                ) : null}
              </td>

              <td>
                {open ? (
                  <div className="btn-row">
                    {row.status === 'pending' ? (
                      <form action={setStatus}>
                        <input type="hidden" name="id" value={row.id} />
                        <input type="hidden" name="next" value="processing" />
                        <button className="btn ghost small" type="submit">
                          Start
                        </button>
                      </form>
                    ) : null}

                    <form action={setStatus}>
                      <input type="hidden" name="id" value={row.id} />
                      <input type="hidden" name="next" value="paid" />
                      <button className="btn primary small" type="submit">
                        Mark paid
                      </button>
                    </form>

                    <form action={setStatus}>
                      <input type="hidden" name="id" value={row.id} />
                      <input type="hidden" name="next" value="failed" />
                      <input type="hidden" name="reason" value="Transfer failed" />
                      <button className="btn danger small" type="submit">
                        Failed
                      </button>
                    </form>
                  </div>
                ) : (
                  <span className="mono">{when(row.processed_at)}</span>
                )}
              </td>
            </tr>
          );
        })}
      </DataTable>
    </Shell>
  );
}

/**
 * Has anybody seen this host's ID?
 *
 * "Verified" alone is not enough: the old app granted the badge to anyone who
 * finished the form, so a badge with no approved request behind it is shown
 * as unchecked rather than green.
 */
function Identity({
  profileId,
  verified,
  request,
}: {
  profileId: string | null;
  verified: boolean;
  request: VerificationRow | undefined;
}) {
  if (!profileId) return <span className="mono">No account</span>;
  const href = `/verifications?person=${profileId}`;

  if (verified && request?.status === 'approved') {
    return (
      <>
        <Badge value="ID approved" tone="green" />
        <div className="mono" style={{ marginTop: 4 }}>
          <a href={href}>See ID</a>
        </div>
      </>
    );
  }
  if (request?.status === 'pending') {
    return (
      <>
        <Badge value="ID waiting" tone="amber" />
        <div className="mono" style={{ marginTop: 4 }}>
          <a href={href}>Review it now</a>
        </div>
      </>
    );
  }
  return (
    <>
      <Badge value={verified ? 'badge, no ID' : 'not verified'} tone="red" />
      <div className="mono" style={{ marginTop: 4 }}>
        {request ? <a href={href}>Last ID {request.status}</a> : 'No ID sent'}
      </div>
    </>
  );
}