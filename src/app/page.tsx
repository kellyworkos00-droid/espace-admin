import Link from 'next/link';

import { Shell } from '@/components/shell';
import { Badge, Empty, Metric, Notice, PageHead, Table, ago, kes, shortId } from '@/components/ui';
import { requireAdmin } from '@/lib/auth';
import { runHealthChecks } from '@/lib/health';
import { getOverview } from '@/lib/queries';
import { hasServiceRole } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export default async function OverviewPage() {
  await requireAdmin();

  const { metrics, payouts, payments, bookings, listings, profiles, error } = await getOverview();

  const health = runHealthChecks({
    listings: listings.rows,
    bookings: bookings.rows,
    payments: payments.rows,
    payouts: payouts.rows,
    profiles: profiles.rows,
  });
  const queue = payouts.rows.filter((row) => row.status === 'pending' || row.status === 'processing');

  return (
    <Shell
      badges={{
        '/payouts': metrics.queuedPayoutCount,
        '/accounts': metrics.unverifiedCount,
        '/health': health.failing.length,
      }}>
      <PageHead
        title="Overview"
        description="Account verification waiting on you, the financial position, and anything blocking the platform."
      />

      {error ? (
        <Notice tone="error" title="Could not read the database">
          {error}
        </Notice>
      ) : null}

      {!hasServiceRole ? (
        <Notice tone="warn" title="Running on the public key">
          Actions that change data may be refused by row-level security. Add{' '}
          <code>SUPABASE_SERVICE_ROLE_KEY</code> to <code>.env.local</code> and restart.
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
          <Link href="/health" style={{ textDecoration: 'underline', fontWeight: 800 }}>
            Review them
          </Link>
          .
        </Notice>
      ) : null}

      <div className="grid cols-4" style={{ marginBottom: 14 }}>
        <Metric
          label="Awaiting verification"
          value={metrics.unverifiedCount}
          hint={`${metrics.profileCount} account(s) total`}
        />
        <Metric
          label="Held in escrow"
          value={kes(metrics.heldKes)}
          hint={`${metrics.heldCount} payment(s), released by renters in the app`}
        />
        <Metric
          label="Payouts queued"
          value={kes(metrics.queuedPayoutKes)}
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
          <h2 style={{ fontSize: 15, margin: '10px 0' }}>Payouts waiting</h2>
          <Table head={['Host', 'Amount', 'To', 'Waiting', 'Status']}>
            {queue.length === 0 ? (
              <Empty>Nothing waiting. Every requested payout has been handled.</Empty>
            ) : (
              queue.slice(0, 8).map((row) => (
                <tr key={row.id}>
                  <td className="mono">{shortId(row.profile_id)}</td>
                  <td className="num">{kes(row.amount_kes)}</td>
                  <td className="dim">{row.destination_phone ?? row.reference_note ?? '—'}</td>
                  <td className="dim">{ago(row.created_at)}</td>
                  <td>
                    <Badge value={row.status} />
                  </td>
                </tr>
              ))
            )}
          </Table>
        </div>

        <div>
          <h2 style={{ fontSize: 15, margin: '10px 0' }}>Recent payments</h2>
          <Table head={['Amount', 'Status', 'Payer', 'When']}>
            {payments.rows.length === 0 ? (
              <Empty>No payments recorded yet.</Empty>
            ) : (
              payments.rows.slice(0, 8).map((row) => (
                <tr key={row.id}>
                  <td className="num">{kes(row.amount_kes)}</td>
                  <td>
                    <Badge value={row.status} />
                  </td>
                  <td className="dim">{row.payer_phone ?? '—'}</td>
                  <td className="dim">{ago(row.created_at)}</td>
                </tr>
              ))
            )}
          </Table>
        </div>
      </div>
    </Shell>
  );
}
