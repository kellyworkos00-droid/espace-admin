import Link from 'next/link';

import { Shell } from '@/components/shell';
import { Badge, Empty, Metric, Notice, PageHead, Table, ago, kes, shortId } from '@/components/ui';
import { requireAdmin } from '@/lib/auth';
import { getOverview } from '@/lib/queries';
import { hasServiceRole } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export default async function OverviewPage() {
  await requireAdmin();

  const { metrics, payouts, payments, error } = await getOverview();
  const queue = payouts.rows.filter((row) => row.status === 'pending' || row.status === 'processing');

  return (
    <Shell badges={{ '/payouts': metrics.queuedPayoutCount }}>
      <PageHead
        title="Overview"
        description="Money in escrow, money waiting to go out, and anything that needs a person."
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

      {/* These three break payouts silently, so they are stated before any
          headline figure that looks healthy. */}
      {metrics.orphanListings > 0 || metrics.orphanBookings > 0 ? (
        <Notice tone="error" title="Payouts cannot complete">
          {metrics.orphanListings} listing(s) have no owner and {metrics.orphanBookings} booking(s)
          record no host. Escrow on those bookings has nobody to pay.{' '}
          <Link href="/listings" style={{ textDecoration: 'underline', fontWeight: 800 }}>
            Repair them
          </Link>
          .
        </Notice>
      ) : null}

      <div className="grid cols-4" style={{ marginBottom: 14 }}>
        <Metric
          label="Held in escrow"
          value={kes(metrics.heldKes)}
          hint={`${metrics.heldCount} payment(s) awaiting release`}
        />
        <Metric
          label="Payouts queued"
          value={kes(metrics.queuedPayoutKes)}
          hint={`${metrics.queuedPayoutCount} host(s) waiting`}
        />
        <Metric label="Released to hosts" value={kes(metrics.releasedKes)} hint="Lifetime" />
        <Metric
          label="Live listings"
          value={metrics.listingCount}
          hint={`${metrics.bookingCount} bookings · ${metrics.profileCount} users`}
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
