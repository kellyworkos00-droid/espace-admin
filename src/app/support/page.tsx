import { revalidatePath } from 'next/cache';

import { AutoRefresh } from '@/components/auto-refresh';
import { BlockedNotice } from '@/components/blocked-notice';
import { Shell } from '@/components/shell';
import { Badge, Empty, LoadError, Metric, PageHead, Table, ago, shortId, when } from '@/components/ui';
import { requireAdmin } from '@/lib/auth';
import { getProfiles, getSupportTickets, supportShotUrl } from '@/lib/queries';
import { sb } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const FILTERS = ['open', 'in_progress', 'resolved', 'all'] as const;

const FILTER_LABELS: Record<string, string> = {
  open: 'Open',
  in_progress: 'Being looked at',
  resolved: 'Resolved',
  all: 'All',
};

/**
 * Help and support.
 *
 * Until now these had nowhere to arrive. The app's support screen built a
 * WhatsApp message and opened wa.me, so a report existed only as a chat on one
 * phone: it could not be counted, assigned or closed, and nobody could answer
 * "how many people are stuck on payments this week". The screenshots were not
 * even attached -- the message listed their file names and asked the sender to
 * find them again.
 *
 * Oldest first while open, because somebody who wrote on Monday has waited
 * longer than somebody who wrote this morning.
 */
export default async function SupportPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  await requireAdmin();

  const { status } = await searchParams;
  const active = FILTERS.includes(status as (typeof FILTERS)[number]) ? status! : 'open';

  const [tickets, profiles] = await Promise.all([getSupportTickets(active), getProfiles()]);

  const nameFor = new Map(
    (profiles.rows ?? []).map((person) => [person.id, person.full_name || person.email || null])
  );

  async function setStatus(formData: FormData) {
    'use server';

    const id = String(formData.get('id') ?? '');
    const next = String(formData.get('next') ?? '');
    const note = String(formData.get('note') ?? '').trim();
    if (!id || !next) return;

    await sb('support_tickets', {
      query: `id=eq.${id}`,
      method: 'PATCH',
      body: {
        status: next,
        admin_note: note || null,
        // Stamped only when it is actually finished, so "how long did this
        // take" stays answerable.
        resolved_at: next === 'resolved' || next === 'closed' ? new Date().toISOString() : null,
      },
    });

    revalidatePath('/support');
  }

  const rows = tickets.rows ?? [];
  const waiting = rows.filter((ticket) => ticket.status === 'open').length;

  return (
    <Shell>
      <PageHead
        title="Help and support"
        description="Reports raised from the app. Oldest first, so the longest wait is at the top."
        action={<AutoRefresh seconds={15} />}
      />

      {tickets.error ? (
        <LoadError what="support tickets" error={tickets.error} />
      ) : (
        <>
          <div className="grid cols-3" style={{ marginBottom: 14 }}>
            <Metric label="Waiting" value={waiting} tone={waiting > 0 ? 'warn' : 'good'} />
            <Metric label="In this view" value={rows.length} />
            <Metric
              label="With screenshots"
              value={rows.filter((ticket) => (ticket.screenshot_paths ?? []).length > 0).length}
            />
          </div>

          <div className="btn-row" style={{ marginBottom: 14 }}>
            {FILTERS.map((option) => (
              <a
                key={option}
                href={`/support?status=${option}`}
                className={`btn ${option === active ? 'primary' : 'ghost'}`}>
                {FILTER_LABELS[option]}
              </a>
            ))}
          </div>

          <Table head={['Raised', 'Who', 'What went wrong', 'Shots', 'Status', 'Action']}>
            {rows.length === 0 ? (
              <Empty>
                Nothing waiting. That is the good outcome.
                <BlockedNotice what="support tickets" />
              </Empty>
            ) : (
              rows.map((ticket) => {
                const who =
                  (ticket.profile_id ? nameFor.get(ticket.profile_id) : null) ??
                  ticket.contact_email ??
                  ticket.contact_phone ??
                  'Not signed in';

                const shots = ticket.screenshot_paths ?? [];
                const done = ticket.status === 'resolved' || ticket.status === 'closed';

                return (
                  <tr key={ticket.id}>
                    <td>
                      <div>{ago(ticket.created_at)}</div>
                      <div className="dim">{when(ticket.created_at)}</div>
                      <div className="dim mono">{shortId(ticket.id)}</div>
                    </td>

                    <td>
                      <div>{who}</div>
                      <div className="dim">
                        {[ticket.platform, ticket.app_version && `v${ticket.app_version}`]
                          .filter(Boolean)
                          .join(' · ') || '—'}
                      </div>
                    </td>

                    <td>
                      <div className="chips">
                        {(ticket.issues ?? []).map((issue) => (
                          <span className="chip" key={issue}>
                            {issue}
                          </span>
                        ))}
                      </div>
                      {ticket.description ? <p>{ticket.description}</p> : null}
                      {ticket.admin_note ? <p className="dim">Note: {ticket.admin_note}</p> : null}
                    </td>

                    <td>
                      {shots.length === 0 ? (
                        <span className="dim">None</span>
                      ) : (
                        <div className="btn-row">
                          {shots.map((path, index) => (
                            <a
                              key={path}
                              className="btn ghost small"
                              href={supportShotUrl(path)}
                              target="_blank"
                              rel="noreferrer">
                              {index + 1}
                            </a>
                          ))}
                        </div>
                      )}
                    </td>

                    <td>
                      <Badge
                        value={ticket.status}
                        tone={ticket.status === 'open' ? 'amber' : done ? 'green' : 'blue'}
                      />
                    </td>

                    <td>
                      {done ? (
                        <span className="dim">{ago(ticket.resolved_at)}</span>
                      ) : (
                        <form action={setStatus}>
                          <input type="hidden" name="id" value={ticket.id} />
                          <input name="note" placeholder="Note (optional)" />
                          <div className="btn-row" style={{ marginTop: 8 }}>
                            {ticket.status === 'open' ? (
                              <button name="next" value="in_progress" className="btn ghost small">
                                Take it
                              </button>
                            ) : null}
                            <button name="next" value="resolved" className="btn primary small">
                              Resolved
                            </button>
                          </div>
                        </form>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </Table>
        </>
      )}
    </Shell>
  );
}
