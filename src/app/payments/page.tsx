import { revalidatePath } from 'next/cache';

import { Shell } from '@/components/shell';
import { Badge, Empty, Metric, Notice, PageHead, Table, ago, kes, shortId, when } from '@/components/ui';
import { requireAdmin } from '@/lib/auth';
import { getBookings, getListings, getPayments } from '@/lib/queries';
import { sb } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const FILTERS = ['held', 'pending', 'released', 'refunded', 'failed', 'all'] as const;

/**
 * Escrow oversight.
 *
 * Every payment the app has taken, and what state its money is in. Release and
 * refund are here because a dispute has to be resolvable by a person: normally
 * the renter releases from the app, but when they cannot -- unreachable, or the
 * host is at fault -- somebody has to make the call.
 *
 * These write the platform's record of the escrow. They are not the transfer
 * itself; the actual movement is done through the payout queue.
 */
export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  await requireAdmin();

  const params = await searchParams;
  const status = params.status ?? 'all';

  const [payments, bookings, listings] = await Promise.all([
    getPayments(status),
    getBookings(),
    getListings(),
  ]);

  const bookingById = new Map(bookings.rows.map((row) => [row.id, row]));
  const listingById = new Map(listings.rows.map((row) => [row.id, row]));

  const heldTotal = payments.rows
    .filter((row) => row.status === 'held' || row.status === 'pending')
    .reduce((total, row) => total + Number(row.amount_kes ?? 0), 0);

  async function setPaymentStatus(formData: FormData) {
    'use server';

    const id = String(formData.get('id') ?? '');
    const next = String(formData.get('next') ?? '');
    const bookingId = String(formData.get('bookingId') ?? '');
    if (!id || !next) return;

    await sb('payments', { query: `id=eq.${id}`, method: 'PATCH', body: { status: next } });

    // The booking carries its own payment_status that the app reads, so the two
    // are kept in step; leaving them to drift is how a guest sees "paid" while
    // the host sees nothing.
    if (bookingId) {
      await sb('bookings', {
        query: `id=eq.${bookingId}`,
        method: 'PATCH',
        body: { payment_status: next },
      });
    }

    revalidatePath('/payments');
    revalidatePath('/');
  }

  return (
    <Shell>
      <PageHead
        title="Escrow"
        description="Every payment taken by the app, and where its money currently sits."
      />

      {payments.error ? (
        <Notice tone="error" title="Could not load payments">
          {payments.error}
        </Notice>
      ) : null}

      <div className="grid cols-3" style={{ marginBottom: 16 }}>
        <Metric label="Currently held" value={kes(heldTotal)} hint="Not yet released to hosts" />
        <Metric label="Payments shown" value={payments.rows.length} hint={`Filter: ${status}`} />
        <Metric
          label="Unattributed"
          value={payments.rows.filter((row) => !row.profile_id).length}
          hint="No payer profile recorded"
        />
      </div>

      <div className="btn-row" style={{ marginBottom: 14 }}>
        {FILTERS.map((option) => (
          <a
            key={option}
            href={`/payments?status=${option}`}
            className={`btn ${option === status ? 'primary' : 'ghost'}`}>
            {option}
          </a>
        ))}
      </div>

      <Table head={['Amount', 'Listing', 'Payer', 'Reference', 'When', 'Status', 'Action']}>
        {payments.rows.length === 0 ? (
          <Empty>No payments with this status.</Empty>
        ) : (
          payments.rows.map((row) => {
            const booking = row.booking_id ? bookingById.get(row.booking_id) : undefined;
            const listing = booking?.listing_id ? listingById.get(booking.listing_id) : undefined;
            const open = row.status === 'held' || row.status === 'pending';

            return (
              <tr key={row.id}>
                <td className="num">{kes(row.amount_kes)}</td>
                <td>
                  <div style={{ fontWeight: 700 }}>{listing?.title ?? '—'}</div>
                  <div className="mono">{shortId(booking?.id, 14)}</div>
                </td>
                <td className="dim">
                  {row.payer_phone ?? '—'}
                  {!row.profile_id ? (
                    <div className="mono" style={{ color: 'var(--red)' }}>
                      no profile
                    </div>
                  ) : null}
                </td>
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
                <td>
                  {open ? (
                    <div className="btn-row">
                      <form action={setPaymentStatus}>
                        <input type="hidden" name="id" value={row.id} />
                        <input type="hidden" name="bookingId" value={row.booking_id ?? ''} />
                        <input type="hidden" name="next" value="released" />
                        <button className="btn primary" type="submit">
                          Release
                        </button>
                      </form>
                      <form action={setPaymentStatus}>
                        <input type="hidden" name="id" value={row.id} />
                        <input type="hidden" name="bookingId" value={row.booking_id ?? ''} />
                        <input type="hidden" name="next" value="refunded" />
                        <button className="btn danger" type="submit">
                          Refund
                        </button>
                      </form>
                    </div>
                  ) : (
                    <span className="mono">settled</span>
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
