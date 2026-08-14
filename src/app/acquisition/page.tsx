import { Shell } from '@/components/shell';
import {
  Badge,
  Empty,
  Metric,
  Notice,
  PageHead,
  SectionTitle,
  Table,
  ago,
} from '@/components/ui';
import { requireAdmin } from '@/lib/auth';
import { hasServiceRole, sb } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

type ProfileRow = {
  id: string;
  full_name: string | null;
  role: string | null;
  host_type: string | null;
  acquisition_channel: string | null;
  acquisition_source: string | null;
  acquisition_code: string | null;
  acquisition_at: string | null;
  created_at: string | null;
};

type FunnelRow = {
  profile_id: string | null;
  anonymous_id: string | null;
  step: string;
  step_index: number | null;
  host_type: string | null;
  acquisition_channel: string | null;
  acquisition_code: string | null;
  created_at: string;
};

type CodeRow = {
  code: string;
  channel: string;
  label: string;
  targets: string | null;
  active: boolean;
  created_at: string;
};

type ListingRow = { id: string; owner_profile_id: string | null };

/**
 * The eight steps, in the order a host walks them.
 *
 * Named after the screens rather than after an idealised funnel, because the
 * only useful answer to "where are we losing hosts" is one that names a screen
 * somebody can go and fix.
 */
const STEP_LABELS: { step: string; label: string; note: string }[] = [
  { step: 'host_intent', label: 'Said they want to list', note: 'Role set to lister' },
  { step: 'listing_started', label: 'Opened the listing flow', note: 'Reached step 1' },
  { step: 'listing_photos_added', label: 'Got photos in', note: 'Step 7, actually attached' },
  { step: 'listing_published', label: 'Published a home', note: 'The only step that creates supply' },
  { step: 'verification_submitted', label: 'Submitted verification', note: 'Worth 40 ranking points' },
  { step: 'verification_approved', label: 'Verified', note: 'Approved in this console' },
  { step: 'payout_number_added', label: 'Can be paid', note: 'Without this, listings cannot take money' },
  { step: 'first_booking_received', label: 'First booking', note: 'Acquisition ends here' },
];

/** People, counted the way the funnel counts them: signed in or not. */
function personOf(row: FunnelRow): string {
  return row.profile_id ?? row.anonymous_id ?? 'unknown';
}

/**
 * Where hosts come from, and where they stop.
 *
 * Two questions on one page because they are only useful together. A channel
 * that produces signups is not a channel that produces supply, and the gap
 * between those two numbers is the entire subject: at this stage E Space does
 * not need more people in the app, it needs more homes in the feed.
 *
 * Everything here counts distinct people, never events. A host who opened the
 * listing flow four times is one host who could not finish it.
 */
export default async function AcquisitionPage() {
  await requireAdmin();

  const [profiles, events, codes, listings] = await Promise.all([
    sb<ProfileRow>('profiles', {
      query:
        'select=id,full_name,role,host_type,acquisition_channel,acquisition_source,' +
        'acquisition_code,acquisition_at,created_at&order=created_at.desc',
    }),
    sb<FunnelRow>('host_funnel_events', {
      query:
        'select=profile_id,anonymous_id,step,step_index,host_type,acquisition_channel,' +
        'acquisition_code,created_at&order=created_at.desc&limit=5000',
    }),
    sb<CodeRow>('acquisition_codes', { query: 'select=*&order=created_at.desc' }),
    sb<ListingRow>('listings', { query: 'select=id,owner_profile_id' }),
  ]);

  const people = profiles.rows ?? [];
  const rows = events.rows ?? [];
  const codeRows = codes.rows ?? [];
  const listingRows = listings.rows ?? [];

  const attributed = people.filter((p) => p.acquisition_channel);
  const hosts = new Set(listingRows.map((l) => l.owner_profile_id).filter(Boolean) as string[]);

  /* ---------------------------------------------------------------- */
  /* The funnel                                                        */
  /* ---------------------------------------------------------------- */

  const peopleByStep = new Map<string, Set<string>>();
  for (const row of rows) {
    const set = peopleByStep.get(row.step) ?? new Set<string>();
    set.add(personOf(row));
    peopleByStep.set(row.step, set);
  }

  const funnel = STEP_LABELS.map(({ step, label, note }) => ({
    step,
    label,
    note,
    people: peopleByStep.get(step)?.size ?? 0,
  }));

  const widest = Math.max(1, ...funnel.map((s) => s.people));

  /* ---------------------------------------------------------------- */
  /* Inside the listing flow                                           */
  /* ---------------------------------------------------------------- */
  //
  // The eight steps on their own, because 'listing_started' to 'published' is
  // one bar hiding seven screens, and the whole point is to know which.

  const byStepIndex = new Map<number, Set<string>>();
  for (const row of rows) {
    if (row.step !== 'listing_step' || !row.step_index) continue;
    const set = byStepIndex.get(row.step_index) ?? new Set<string>();
    set.add(personOf(row));
    byStepIndex.set(row.step_index, set);
  }

  const steps = Array.from({ length: 8 }, (_, index) => ({
    index: index + 1,
    people: byStepIndex.get(index + 1)?.size ?? 0,
  }));

  const stepPeak = Math.max(1, ...steps.map((s) => s.people));

  /* ---------------------------------------------------------------- */
  /* Channels                                                          */
  /* ---------------------------------------------------------------- */

  const channels = new Map<string, { signups: number; published: number; homes: number }>();
  const publishedBy = new Set(
    rows.filter((r) => r.step === 'listing_published' && r.profile_id).map((r) => r.profile_id as string)
  );
  const homesByProfile = new Map<string, number>();
  for (const listing of listingRows) {
    if (!listing.owner_profile_id) continue;
    homesByProfile.set(listing.owner_profile_id, (homesByProfile.get(listing.owner_profile_id) ?? 0) + 1);
  }

  for (const person of people) {
    const channel = person.acquisition_channel ?? 'unrecorded';
    const entry = channels.get(channel) ?? { signups: 0, published: 0, homes: 0 };
    entry.signups += 1;
    if (publishedBy.has(person.id) || hosts.has(person.id)) entry.published += 1;
    entry.homes += homesByProfile.get(person.id) ?? 0;
    channels.set(channel, entry);
  }

  const channelRows = Array.from(channels.entries()).sort((a, b) => b[1].homes - a[1].homes);

  /* ---------------------------------------------------------------- */
  /* Codes                                                             */
  /* ---------------------------------------------------------------- */

  const codeStats = codeRows.map((code) => {
    const recruited = people.filter((p) => p.acquisition_code === code.code);
    const published = recruited.filter((p) => publishedBy.has(p.id) || hosts.has(p.id));
    const homes = recruited.reduce((sum, p) => sum + (homesByProfile.get(p.id) ?? 0), 0);
    return { ...code, signups: recruited.length, published: published.length, homes };
  });

  // Codes that were typed but never issued. Evidence of a real thing: a code
  // read out wrong on a call, or one somebody is circulating that we retired.
  const issued = new Set(codeRows.map((c) => c.code));
  const unmatched = new Map<string, number>();
  for (const person of people) {
    const code = person.acquisition_code;
    if (!code || issued.has(code)) continue;
    unmatched.set(code, (unmatched.get(code) ?? 0) + 1);
  }

  // codes.error too: acquisition_codes and host_funnel_events are created by
  // the same migration, but a table can be dropped on its own, and a page
  // that shows zero issued codes without saying why is worse than one that
  // admits it could not read them.
  const missing = events.error || profiles.error || codes.error;

  return (
    <Shell>
      <PageHead
        title="Acquisition"
        description="Where hosts come from, and which screen they stop on. Counts people, never events."
      />

      {missing ? (
        <Notice tone="warn" title="The migration has not been run yet">
          This page reads <code>host_funnel_events</code>, <code>acquisition_codes</code> and the
          attribution columns on <code>profiles</code>. Run{' '}
          <code>SUPABASE_HOST_ACQUISITION.sql</code> in the Supabase SQL editor, then reload. Until
          then every number here is zero because the tables are absent, not because nothing has
          happened.
        </Notice>
      ) : null}

      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <Metric
          label="Accounts"
          value={people.length}
          hint={`${attributed.length} with a recorded origin`}
        />
        <Metric
          label="Hosts with a home live"
          value={hosts.size}
          tone={hosts.size > 0 ? 'good' : undefined}
          hint="The only supply number that counts"
        />
        <Metric label="Homes" value={listingRows.length} />
        <Metric label="Live codes" value={codeRows.filter((c) => c.active).length} />
      </div>

      {people.length > 0 && attributed.length === 0 ? (
        <Notice tone="warn" title="Nobody has an origin recorded yet">
          Attribution is first-touch and written once, so it only appears on accounts created after
          the migration ran. Existing accounts stay blank on purpose — backfilling them means
          guessing, and a guessed channel is worse than an empty one because it gets believed.
        </Notice>
      ) : null}

      {/* ------------------------------------------------------------ */}

      <SectionTitle>The host funnel</SectionTitle>
      <div className="card" style={{ marginBottom: 22 }}>
        {funnel.every((s) => s.people === 0) ? (
          <Empty>
            <strong>No steps recorded yet.</strong>
            The app writes a row each time somebody reaches one of these. Nothing here means nobody
            has opened the listing flow since the migration ran.
          </Empty>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {funnel.map((stage, index) => {
              const previous = index > 0 ? funnel[index - 1].people : null;
              const dropped = previous !== null && previous > 0 ? previous - stage.people : null;
              return (
                <div key={stage.step} style={{ display: 'grid', gap: 4 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                    <span style={{ fontWeight: 600 }}>{stage.label}</span>
                    <span className="mono">{stage.people}</span>
                  </div>
                  <div
                    style={{
                      height: 10,
                      borderRadius: 999,
                      background: 'var(--line)',
                      overflow: 'hidden',
                    }}>
                    <div
                      style={{
                        width: `${(stage.people / widest) * 100}%`,
                        height: '100%',
                        background: stage.step === 'listing_published' ? 'var(--good)' : 'var(--brand)',
                      }}
                    />
                  </div>
                  <div className="dim" style={{ fontSize: 12 }}>
                    {stage.note}
                    {dropped !== null && dropped > 0 ? (
                      <span style={{ color: 'var(--bad)' }}>
                        {' '}
                        — {dropped} did not get this far
                      </span>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ------------------------------------------------------------ */}

      <SectionTitle>Inside the listing flow</SectionTitle>
      <div className="card" style={{ marginBottom: 22 }}>
        <p className="dim" style={{ marginTop: 0, fontSize: 13 }}>
          The eight steps of the composer. &ldquo;Started&rdquo; to &ldquo;published&rdquo; is one
          bar hiding seven screens; this is which of them people stop on.
        </p>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 140 }}>
          {steps.map((step) => (
            <div key={step.index} style={{ flex: 1, textAlign: 'center' }}>
              <div className="mono" style={{ fontSize: 12, marginBottom: 4 }}>
                {step.people}
              </div>
              <div
                style={{
                  height: `${Math.max(2, (step.people / stepPeak) * 100)}px`,
                  background: 'var(--brand)',
                  borderRadius: 4,
                }}
              />
              <div className="dim" style={{ fontSize: 11, marginTop: 6 }}>
                {step.index}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ------------------------------------------------------------ */}

      <SectionTitle>By channel</SectionTitle>
      <Table head={['Channel', 'Signups', 'Became hosts', 'Homes', 'Homes per signup']}>
        {channelRows.length === 0 ? (
          <tr>
            <td colSpan={5}>
              <Empty>
                <strong>Nothing attributed yet.</strong>
                Every account created from now on carries the channel it arrived through.
              </Empty>
            </td>
          </tr>
        ) : (
          channelRows.map(([channel, stat]) => (
            <tr key={channel}>
              <td>
                {channel === 'unrecorded' ? (
                  <span className="dim">Unrecorded</span>
                ) : (
                  <Badge value={channel} />
                )}
              </td>
              <td className="num">{stat.signups}</td>
              <td className="num">{stat.published}</td>
              <td className="num">{stat.homes}</td>
              <td className="num">
                {stat.signups > 0 ? (stat.homes / stat.signups).toFixed(2) : '—'}
              </td>
            </tr>
          ))
        )}
      </Table>

      {/* ------------------------------------------------------------ */}

      <SectionTitle count={codeStats.length}>Codes</SectionTitle>
      <p className="dim" style={{ fontSize: 13, marginTop: 0 }}>
        Issued from the SQL editor, not from here — an app or a console that could mint its own
        codes could attribute its own signups to whoever it liked.
      </p>
      <Table head={['Code', 'Who it is', 'Aimed at', 'Signups', 'Became hosts', 'Homes', 'Added']}>
        {codeStats.length === 0 ? (
          <tr>
            <td colSpan={7}>
              <Empty>
                <strong>No codes issued.</strong>
                Add one per agent, partner or campaign so their recruits can be told apart.
              </Empty>
            </td>
          </tr>
        ) : (
          codeStats.map((code) => (
            <tr key={code.code}>
              <td className="mono">
                {code.code}
                {!code.active ? <Badge value="retired" tone="grey" /> : null}
              </td>
              <td>{code.label}</td>
              <td>{code.targets ? <Badge value={code.targets} /> : <span className="dim">—</span>}</td>
              <td className="num">{code.signups}</td>
              <td className="num">{code.published}</td>
              <td className="num">
                {/* The number that decides whether a code is worth reissuing.
                    Signups with no homes is a code reaching the wrong people. */}
                {code.homes > 0 ? <strong>{code.homes}</strong> : <span className="dim">0</span>}
              </td>
              <td className="dim nowrap">{ago(code.created_at)}</td>
            </tr>
          ))
        )}
      </Table>

      {unmatched.size > 0 ? (
        <div style={{ marginTop: 20 }}>
          <Notice tone="warn" title="Codes people entered that we never issued">
            {Array.from(unmatched.entries())
              .map(([code, count]) => `${code} (${count})`)
              .join(', ')}
            . Usually a code read out wrong on a call, or one that was retired while somebody was
            still handing it out. Kept rather than discarded, because a code we did not issue is
            still evidence of somebody trying to use one.
          </Notice>
        </div>
      ) : null}
    </Shell>
  );
}
