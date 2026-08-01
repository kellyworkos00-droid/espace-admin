import { Shell } from '@/components/shell';
import { Badge, Empty, Metric, Notice, PageHead, Table, ago, kes, shortId, when } from '@/components/ui';
import { requireAdmin } from '@/lib/auth';
import { getBookings, getListings, getPayments, getPayouts, getProfiles } from '@/lib/queries';

export const dynamic = 'force-dynamic';

const FILTERS = ['all', 'held', 'pending', 'released', 'refunded', 'failed'] as const;

/**
 * Financial records and position.
 *
 * Read-only by design. Releasing escrow is the renter's decision, taken in the
 * app when they confirm move-in, and refunds run through the app's own request
 * flow. A console button that quietly moved money would sit outside that record
 * and outside the guarantee the product makes to both sides.
 *
 * What operations actually needs here is the truth about where money is: what
 * has come in, what is still held, what has reached hosts, and what is owed.
 */
export default async function FinancePage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  await requireAdmin();

  const params = await searchParams;
  const status = params.status ?? 'all';

  const [payments, bookings, listings, profiles, payouts] = await Promise.all([
    getPayments(status),
    getBookings(),
    getListings(),
    getProfiles(),
    getPayouts('all'),
  ]);

  const bookingById = new Map(bookings.rows.map((row) => [row.id, row]));
  const listingById = new Map(listings.rows.map((row) => [row.id, row]));
  const profileById = new Map(profiles.rows.map((row) => [row.id, row]));

  // Totals are taken from an unfiltered read so the position does not change
  // when someone narrows the table below it.
  const all = await getPayments('all');
  const sum = (rows: { amount_kes: number }[]) =>
    rows.reduce((total, row) => total + Number(row.amount_kes ?? 0), 0);

  const held = all.rows.filter((row) => row.status === 'held' || row.status === 'pending');
  const released = all.rows.filter((row) => row.status === 'released');
  const refunded = all.rows.filter((row) => row.status === 'refunded');
  const failed = all.rows.filter((row) => row.status === 'failed');

  const grossIn = sum(held) + sum(released);
  const owedToHosts = payouts.rows
    .filter((row) => row.status === 'pending' || row.status === 'processing')
    .reduce((total, row) => total + Number(row.amount_kes ?? 0), 0);
  const paidOut = payouts.rows
    .filter((row) => row.status === 'paid')
    .reduce((total, row) => total + Number(row.amount_kes ?? 0), 0);

  /** Earnings per host, so the biggest earners and any anomaly are visible. */
  const byHost = new Map<string, { released: number; held: number; bookings: number }>();
  for (const payment of all.rows) {
    const booking = payment.booking_id ? bookingById.get(payment.booking_id) : undefined;
    const hostId = booking?.host_profile_id;
    if (!hostId) continue;

    const entry = byHost.get(hostId) ?? { released: 0, held: 0, bookings: 0 };
    const amount = Number(payment.amount_kes ?? 0);
    if (payment.status === 'released') entry.released += amount;
    if (payment.status === 'held' || payment.status === 'pending') entry.held += amount;
    entry.bookings += 1;
    byHost.set(hostId, entry);
  }

  const hostRows = [...byHost.entries()].sort((a, b) => b[1].released - a[1].released).slice(0, 10);

  /** Money in by calendar month, most recent first. */
  const byMonth = new Map<string, number>();
  for (const payment of all.rows) {
    if (payment.status === 'failed' || payment.status === 'refunded') continue;
    const date = new Date(payment.created_at);
    if (Number.isNaN(date.getTime())) continue;
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    byMonth.set(key, (byMonth.get(key) ?? 0) + Number(payment.amount_kes ?? 0));
  }
  const months = [...byMonth.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 6);
  const peak = Math.max(1, ...months.map(([, value]) => value));

  return (
    <Shell>
      <PageHead
        title="Finance"
        description="Where the platform's money is: taken, held, released to hosts, refunded and paid out."
      />

      {payments.error ? (
        <Notice tone="error" title="Could not load payments">
          {payments.error}
        </Notice>
      ) : null}

      <Notice tone="info" title="Records only">
        Escrow is released by the renter in the app when they confirm move-in, and refunds run
        through the app&apos;s request flow. This screen reports on those decisions; it does not make
        them.
      </Notice>

      <div className="grid cols-4" style={{ marginBottom: 14 }}>
        <Metric
          label="Held in escrow"
          value={kes(sum(held))}
          hint={`${held.length} payment(s) not yet released`}
        />
        <Metric
          label="Released to hosts"
          value={kes(sum(released))}
          hint={`${released.length} payment(s), lifetime`}
        />
        <Metric label="Owed to hosts" value={kes(owedToHosts)} hint="Withdrawals requested, not yet sent" />
        <Metric label="Paid out" value={kes(paidOut)} hint="Withdrawals completed" />
      </div>

      <div className="grid cols-3" style={{ marginBottom: 20 }}>
        <Metric label="Gross taken" value={kes(grossIn)} hint="Held plus released" />
        <Metric label="Refunded" value={kes(sum(refunded))} hint={`${refunded.length} refund(s)`} />
        <Metric label="Failed" value={kes(sum(failed))} hint={`${failed.length} never completed`} />
      </div>

      <div className="grid cols-2" style={{ marginBottom: 20 }}>
        <div className="card">
          <div className="label" style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', color: 'var(--muted)' }}>
            Money in by month
          </div>
          <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 9 }}>
            {months.length === 0 ? (
              <div className="empty">No payments recorded yet.</div>
            ) : (
              months.map(([month, value]) => (
                <div key={month} style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                  <span className="mono" style={{ width: 62 }}>{month}</span>
                  <div style={{ flex: 1, height: 8, background: '#f0f4f2', borderRadius: 999 }}>
                    <div
                      style={{
                        width: `${(value / peak) * 100}%`,
                        height: '100%',
                        background: 'var(--green)',
                        borderRadius: 999,
                      }}
                    />
                  </div>
                  <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                    {kes(value)}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="card">
          <div className="label" style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', color: 'var(--muted)' }}>
            Top earning hosts
          </div>
          <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {hostRows.length === 0 ? (
              <div className="empty">No host earnings yet.</div>
            ) : (
              hostRows.map(([hostId, entry]) => {
                const profile = profileById.get(hostId);
                return (
                  <div key={hostId} style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 700 }}>{profile?.full_name ?? 'Unknown host'}</div>
                      <div className="mono">{entry.bookings} payment(s)</div>
                    </div>
                    <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <div style={{ fontWeight: 800 }}>{kes(entry.released)}</div>
                      <div className="mono">{kes(entry.held)} held</div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      <h2 style={{ fontSize: 15, margin: '0 0 10px' }}>Payment records</h2>

      <div className="btn-row" style={{ marginBottom: 14 }}>
        {FILTERS.map((option) => (
          <a
            key={option}
            href={`/finance?status=${option}`}
            className={`btn ${option === status ? 'primary' : 'ghost'}`}>
            {option}
          </a>
        ))}
      </div>

      <Table head={['Amount', 'Listing', 'Host', 'Payer', 'Reference', 'When', 'Status']}>
        {payments.rows.length === 0 ? (
          <Empty>No payments with this status.</Empty>
        ) : (
          payments.rows.map((row) => {
            const booking = row.booking_id ? bookingById.get(row.booking_id) : undefined;
            const listing = booking?.listing_id ? listingById.get(booking.listing_id) : undefined;
            const host = booking?.host_profile_id ? profileById.get(booking.host_profile_id) : undefined;

            return (
              <tr key={row.id}>
                <td className="num">{kes(row.amount_kes)}</td>
                <td>
                  <div style={{ fontWeight: 700 }}>{listing?.title ?? '—'}</div>
                  <div className="mono">{shortId(booking?.id, 14)}</div>
                </td>
                <td className="dim">
                  {host?.full_name ?? (
                    <span className="mono" style={{ color: 'var(--red)' }}>
                      no host
                    </span>
                  )}
                </td>
                <td className="dim">{row.payer_phone ?? '—'}</td>
                <td className="mono">
                  {row.provider_confirmation_code ?? row.checkout_request_id ?? '—'}
                  {row.econfirm_transaction_id ? <div>{row.econfirm_transaction_id}</div> : null}
                </td>
                <td className="dim">
                  <div>{ago(row.created_at)}</div>
                  <div className="mono">{when(row.created_at)}</div>
                </td>
                <td>
                  <Badge value={row.status} />
                </td>
              </tr>
            );
          })
        )}
      </Table>
    </Shell>
  );
}
