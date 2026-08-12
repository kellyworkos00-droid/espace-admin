import { revalidatePath } from 'next/cache';

import { DataTable } from '@/components/data-table';
import { Shell } from '@/components/shell';
import {
  Badge,
  Metric,
  Notice,
  PageHead,
  ServiceRoleRequired,
  PersonCell,
  ago,
  personIndex,
  personSearch,
  when,
} from '@/components/ui';
import { requireAdmin } from '@/lib/auth';
import { hasServiceRole } from '@/lib/supabase';
import { getListings, getProfiles, getReports } from '@/lib/queries';
import { sb } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

/** The reasons that mean money is leaving the platform, or the home is not real. */
const URGENT = new Set(['off_platform_payment', 'does_not_exist']);

const REASON_LABELS: Record<string, string> = {
  off_platform_payment: 'Asked to pay outside the app',
  does_not_exist: 'Home does not exist',
  not_as_described: 'Not as described',
  unsafe: 'Unsafe or uninhabitable',
  wrong_price: 'Price is wrong',
  duplicate: 'Duplicate listing',
  offensive: 'Offensive',
  other: 'Something else',
};

/**
 * Reports on listings.
 *
 * The app's report button used to open an alert and offer the support screen.
 * Nothing was recorded, so a home reported by eleven people looked exactly
 * like one reported by nobody, and clause 6 of the Terms -- which lets E Space
 * withhold release on "a credible report" -- described a judgement nobody was
 * equipped to make.
 *
 * Sorted by what the report means rather than when it arrived. Someone asked
 * to send M-Pesa to a personal number has already been defrauded or is about
 * to be; a complaint about photos can wait an afternoon. And a listing with
 * several reports is the one to look at first, however old they are: one
 * unhappy renter is an argument, four strangers are a pattern.
 */
export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  await requireAdmin();

  const params = await searchParams;
  const status = params.status ?? 'open';

  const [reports, listings, profiles] = await Promise.all([
    getReports(),
    getListings(),
    getProfiles(),
  ]);

  const people = personIndex(profiles.rows);
  const listingById = new Map(listings.rows.map((row) => [row.id, row]));

  const rows =
    status === 'all' ? reports.rows : reports.rows.filter((row) => row.status === status);

  const open = reports.rows.filter((row) => row.status === 'open');
  const urgent = open.filter((row) => URGENT.has(row.reason));

  // A listing with more than one open report is the signal worth surfacing.
  const perListing = new Map<string, number>();
  for (const row of open) {
    if (!row.listing_id) continue;
    perListing.set(row.listing_id, (perListing.get(row.listing_id) ?? 0) + 1);
  }
  const repeated = [...perListing.entries()].filter(([, count]) => count > 1);

  async function setStatus(formData: FormData) {
    'use server';

    const id = String(formData.get('id') ?? '');
    const next = String(formData.get('next') ?? '');
    if (!id || !next) return;

    await sb('listing_reports', {
      query: `id=eq.${id}`,
      method: 'PATCH',
      body: {
        status: next,
        reviewed_at: next === 'open' ? null : new Date().toISOString(),
      },
    });

    revalidatePath('/reports');
    revalidatePath('/');
  }

  /**
   * Pausing takes the home out of the feed without deleting anything.
   *
   * Deliberately reversible and deliberately not a delete: a listing has
   * bookings and payments hanging off it, and the cascade would take those
   * with it.
   */
  async function pauseListing(formData: FormData) {
    'use server';

    const listingId = String(formData.get('listingId') ?? '');
    if (!listingId) return;

    await sb('listings', {
      query: `id=eq.${listingId}`,
      method: 'PATCH',
      body: { is_paused: true },
    });

    revalidatePath('/reports');
    revalidatePath('/listings');
  }

  return (
    <Shell badges={{ '/reports': open.length }}>
      <PageHead
        title="Reports"
        description="What renters have told us is wrong with a listing. Ordered by what the report means, not when it arrived."
      />

      {!hasServiceRole ? <ServiceRoleRequired reads="listing_reports" /> : null}

      {reports.error ? (
        <Notice tone="error" title="Could not load reports">
          {reports.error}
          <div style={{ fontWeight: 600, marginTop: 6 }}>
            If this names the table, <code>SUPABASE_LISTING_REPORTS.sql</code> has not been run yet.
          </div>
        </Notice>
      ) : null}

      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <Metric
          label="Open reports"
          value={open.length}
          tone={open.length > 0 ? 'warn' : 'good'}
          hint={`${reports.rows.length} filed in total`}
        />
        <Metric
          label="Fraud or fake"
          value={urgent.length}
          tone={urgent.length > 0 ? 'bad' : 'good'}
          hint="Paid outside the app, or does not exist"
        />
        <Metric
          label="Listings reported twice or more"
          value={repeated.length}
          tone={repeated.length > 0 ? 'bad' : undefined}
          hint="One renter is an argument, four are a pattern"
        />
        <Metric
          label="Dealt with"
          value={reports.rows.filter((row) => row.status !== 'open').length}
          hint="Actioned or dismissed"
        />
      </div>

      {urgent.length > 0 ? (
        <Notice tone="error" title={`${urgent.length} report(s) about fraud or a home that is not real`}>
          Someone asked to pay outside E Space has lost their escrow protection entirely, and a
          listing that does not exist is taking money for nothing. Read these before anything else —
          clause 6 lets us withhold release on a credible report, and this is what credible looks
          like.
        </Notice>
      ) : null}

      <div className="chips" style={{ marginBottom: 14 }}>
        {['open', 'reviewing', 'actioned', 'dismissed', 'all'].map((option) => (
          <a
            key={option}
            href={`/reports?status=${option}`}
            className="chip"
            aria-current={option === status ? 'page' : undefined}>
            {option}
          </a>
        ))}
      </div>

      <DataTable
        head={['Listing', 'What was reported', 'Who', 'Filed', 'Status', 'Action']}
        placeholder="Search by listing, reason or what they wrote…"
        noun="report"
        empty={
          <>
            <strong>Nothing with this status.</strong>
            Reports filed from the app land here.
          </>
        }>
        {rows.map((row) => {
          const listing = row.listing_id ? listingById.get(row.listing_id) : undefined;
          const count = row.listing_id ? perListing.get(row.listing_id) ?? 0 : 0;
          const isUrgent = URGENT.has(row.reason);

          const haystack = [
            listing?.title,
            listing?.neighborhood,
            REASON_LABELS[row.reason] ?? row.reason,
            row.detail,
            personSearch(row.reporter_profile_id, people),
          ]
            .filter(Boolean)
            .join(' ');

          return (
            <tr key={row.id} data-search={haystack}>
              <td>
                <div style={{ fontWeight: 700 }}>{listing?.title ?? 'Listing removed'}</div>
                <div className="mono">{listing?.neighborhood ?? row.listing_id ?? '—'}</div>
                {count > 1 ? (
                  <div style={{ marginTop: 4 }}>
                    <Badge value={`${count} open reports`} tone="red" />
                  </div>
                ) : null}
              </td>

              <td>
                <Badge
                  value={REASON_LABELS[row.reason] ?? row.reason}
                  tone={isUrgent ? 'red' : 'amber'}
                />
                {row.detail ? <div className="review-text" style={{ marginTop: 6 }}>{row.detail}</div> : null}
              </td>

              <td>
                {/* Anonymous reports are kept. A fake listing is often spotted
                    by someone who never made an account. */}
                {row.reporter_profile_id ? (
                  <PersonCell id={row.reporter_profile_id} people={people} />
                ) : (
                  <span className="mono">Not signed in</span>
                )}
              </td>

              <td className="dim nowrap">
                <div>{ago(row.created_at)}</div>
                <div className="mono">{when(row.created_at)}</div>
              </td>

              <td>
                <Badge
                  value={row.status}
                  tone={row.status === 'open' ? 'amber' : row.status === 'actioned' ? 'green' : 'grey'}
                />
              </td>

              <td>
                {row.status === 'open' || row.status === 'reviewing' ? (
                  <div className="btn-row">
                    {listing && !listing.is_paused ? (
                      <form action={pauseListing}>
                        <input type="hidden" name="listingId" value={row.listing_id ?? ''} />
                        <button className="btn danger small" type="submit">
                          Pause listing
                        </button>
                      </form>
                    ) : null}

                    <form action={setStatus}>
                      <input type="hidden" name="id" value={row.id} />
                      <input type="hidden" name="next" value="actioned" />
                      <button className="btn primary small" type="submit">
                        Actioned
                      </button>
                    </form>

                    <form action={setStatus}>
                      <input type="hidden" name="id" value={row.id} />
                      <input type="hidden" name="next" value="dismissed" />
                      <button className="btn ghost small" type="submit">
                        Dismiss
                      </button>
                    </form>
                  </div>
                ) : (
                  <span className="mono">{when(row.reviewed_at)}</span>
                )}
              </td>
            </tr>
          );
        })}
      </DataTable>
    </Shell>
  );
}
