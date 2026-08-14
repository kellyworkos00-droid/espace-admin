import Link from 'next/link';

import { Shell } from '@/components/shell';
import {
  Badge,
  Empty,
  Metric,
  Notice,
  PageHead,
  PersonCell,
  SectionTitle,
  Table,
  ago,
  kes,
  personIndex,
  LoadError,
} from '@/components/ui';
import { requireAdmin } from '@/lib/auth';
import { runHealthChecks } from '@/lib/health';
import { getOverview, getReports } from '@/lib/queries';
import { hasServiceRole } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export default async function OverviewPage() {
  await requireAdmin();

  const [{ metrics, payouts, payments, bookings, listings, profiles, error }, reports] =
    await Promise.all([getOverview(), getReports()]);

  // Reports are the one queue that arrives from outside: nobody in operations
  // creates them, so nothing prompts anyone to look unless the overview says so.
  const openReports = reports.rows.filter((row) => row.status === 'open');
  const urgentReports = openReports.filter(
    (row) => row.reason === 'off_platform_payment' || row.reason === 'does_not_exist'
  );

  const health = runHealthChecks({
    listings: listings.rows,
    bookings: bookings.rows,
    payments: payments.rows,
    payouts: payouts.rows,
    profiles: profiles.rows,
  });

  const people = personIndex(profiles.rows);
  const queue = payouts.rows.filter((row) => row.status === 'pending' || row.status === 'processing');

  return (
    <Shell
      badges={{
        '/payouts': metrics.queuedPayoutCount,
        '/accounts': metrics.unverifiedCount,
        '/health': health.failing.length,
        '/reports': openReports.length,
      }}>
      <PageHead
        title="Overview"
        description="Account verification waiting on you, the financial position, and anything blocking the platform."
      />

      {/* The shell says why, once, above every page. Repeating it here was
          the third telling on a screen that already had two. */}
      <LoadError error={error} what="the database" keyed={hasServiceRole} />

      {urgentReports.length > 0 ? (
        <Notice
          tone="error"
          title={`${urgentReports.length} report(s) of fraud or a home that is not real`}>
          Someone asked to pay outside E Space has lost their escrow protection entirely.{' '}
          <Link href="/reports">Read them</Link>.
        </Notice>
      ) : null}

      {/* Stated before any headline figure, because these are the faults that
          let a healthy-looking number sit on top of money nobody can be paid. */}
      {health.failing.length > 0 ? (
        <Notice
          tone={health.worst === 'medium' ? 'warn' : 'error'}
          title={
            health.counts.critical > 0
              ? `${health.counts.critical} fault(s) putting money at risk`
              : `${health.failing.length} thing(s) need attention`
          }>
          {health.failing
            .slice(0, 3)
            .map((check) => `${check.title.toLowerCase()} (${check.items.length})`)
            .join(', ')}
          {health.failing.length > 3 ? `, and ${health.failing.length - 3} more` : ''}.{' '}
          <Link href="/health">Review them</Link>.
        </Notice>
      ) : null}

      <div className="grid cols-4" style={{ marginBottom: 14 }}>
        <Metric
          label="Awaiting verification"
          value={metrics.unverifiedCount}
          tone={metrics.unverifiedCount > 0 ? 'warn' : 'good'}
          hint={`${metrics.profileCount} account(s) total`}
        />
        <Metric
          label="Held in escrow"
          value={kes(metrics.heldKes)}
          tone="info"
          hint={`${metrics.heldCount} payment(s), released by renters in the app`}
        />
        <Metric
          label="Payouts queued"
          value={kes(metrics.queuedPayoutKes)}
          tone={metrics.queuedPayoutCount > 0 ? 'warn' : 'good'}
          hint={`${metrics.queuedPayoutCount} host(s) waiting`}
        />
        <Metric
          label="Live listings"
          value={metrics.listingCount}
          hint={`${metrics.bookingCount} booking(s) · ${kes(metrics.releasedKes)} released lifetime`}
        />
      </div>

      <div className="grid cols-2">
        <div>
          <SectionTitle count={queue.length}>Payouts waiting</SectionTitle>
          <Table head={['Host', 'Amount', 'To', 'Waiting', 'Status']}>
            {queue.length === 0 ? (
              <Empty>
                <strong>Nothing waiting.</strong>
                Every requested payout has been handled.
              </Empty>
            ) : (
              queue.slice(0, 8).map((row) => (
                <tr key={row.id}>
                  {/* Was a truncated uuid in a monospace font. Nobody can act
                      on a hash, and knowing who is owed is the entire point of
                      the panel. */}
                  <td>
                    <PersonCell id={row.profile_id} people={people} />
                  </td>
                  <td className="num">{kes(row.amount_kes)}</td>
                  <td className="dim">{row.destination_phone ?? row.reference_note ?? '—'}</td>
                  <td className="dim nowrap">{ago(row.created_at)}</td>
                  <td>
                    <Badge value={row.status} />
                  </td>
                </tr>
              ))
            )}
          </Table>
        </div>

        <div>
          <SectionTitle count={payments.rows.length}>Recent payments</SectionTitle>
          <Table head={['Amount', 'Status', 'Payer', 'When']}>
            {payments.rows.length === 0 ? (
              <Empty>
                <strong>No payments recorded yet.</strong>
                The first booking paid through the app appears here.
              </Empty>
            ) : (
              payments.rows.slice(0, 8).map((row) => (
                <tr key={row.id}>
                  <td className="num">{kes(row.amount_kes)}</td>
                  <td>
                    <Badge value={row.status} />
                  </td>
                  <td className="dim">{row.payer_phone ?? '—'}</td>
                  <td className="dim nowrap">{ago(row.created_at)}</td>
                </tr>
              ))
            )}
          </Table>
        </div>
      </div>
    </Shell>
  );
}
