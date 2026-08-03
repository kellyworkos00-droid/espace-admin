import 'server-only';

import type { BookingRow, ListingRow, PaymentRow, PayoutRow, ProfileRow } from './queries';

/**
 * Standing integrity checks over the platform's money and ownership records.
 *
 * These exist because every one of them is a fault that reports nothing. No
 * exception is thrown, no request fails, and every screen keeps rendering: a
 * listing with no owner takes payment perfectly well, right up until a host
 * asks where their money is. The only way to find them is to go looking, so
 * the console looks on every load rather than waiting for the complaint.
 *
 * Each check states the consequence in the operator's terms, not the schema's.
 * "3 rows have a null column" is not actionable at nine in the morning;
 * "3 homes took money that can never reach a host" is.
 */

export type Severity = 'critical' | 'high' | 'medium';

export type HealthItem = {
  /** Row identifier, for looking it up in its own screen. */
  id: string;
  label: string;
  meta?: string;
};

export type HealthCheck = {
  id: string;
  title: string;
  severity: Severity;
  /** What is wrong, and what it costs. */
  detail: string;
  /** The specific thing to do about it. */
  fix: string;
  /** Where it gets fixed. */
  href?: string;
  items: HealthItem[];
};

export type HealthReport = {
  checks: HealthCheck[];
  failing: HealthCheck[];
  counts: Record<Severity, number>;
  /** Total rows implicated across every failing check. */
  affected: number;
  worst: Severity | null;
};

export const SEVERITY_ORDER: Severity[] = ['critical', 'high', 'medium'];

/** Bookings that hold a claim on a home: paid, or awaiting arrival. */
const LIVE_BOOKING_STATUSES = new Set(['upcoming', 'confirmed', 'completed']);

/**
 * A home that should leave the feed once it is let.
 *
 * Read from stay_type, never inferred from whether a nightly rate is set. A
 * short stay is sold by the night and stays listed for everyone else's dates,
 * so guessing wrong here would tell an operator to withdraw a BnB that is
 * working exactly as intended.
 */
function leavesFeedWhenLet(row: ListingRow) {
  if (row.stay_type) return row.stay_type !== 'short_stay';
  return !row.nightly_rate_kes;
}
const PAID_PAYMENT_STATUSES = new Set(['held', 'released', 'paid']);

function isLiveBooking(row: BookingRow) {
  const cancelled = row.status === 'cancelled' || row.request_status === 'declined';
  if (cancelled) return false;
  return (
    LIVE_BOOKING_STATUSES.has(row.status ?? '') ||
    PAID_PAYMENT_STATUSES.has(row.payment_status ?? '')
  );
}

/**
 * The dates a booking actually occupies.
 *
 * The bookings table carries two pairs of date columns and the app writes the
 * move_in/checkout pair, leaving check_in/check_out null. Reading only the
 * check_* pair makes every clash invisible -- the overlap test passes on a
 * table where every row is empty, which is worse than not testing at all.
 */
function stayWindow(row: BookingRow): { start: string; end: string } | null {
  const start = row.check_in_date ?? row.move_in_date ?? null;
  const end = row.check_out_date ?? row.checkout_date ?? null;
  return start && end ? { start, end } : null;
}

/** Inclusive-start, exclusive-end overlap: a checkout and a check-in may share a day. */
function datesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string) {
  return aStart < bEnd && bStart < aEnd;
}

export type HealthInput = {
  listings: ListingRow[];
  bookings: BookingRow[];
  payments: PaymentRow[];
  payouts: PayoutRow[];
  profiles: ProfileRow[];
};

export function runHealthChecks(input: HealthInput): HealthReport {
  const { listings, bookings, payments, payouts, profiles } = input;

  const listingById = new Map(listings.map((row) => [row.id, row]));
  const profileById = new Map(profiles.map((row) => [row.id, row]));
  const titleOf = (id: string | null) =>
    (id && listingById.get(id)?.title) || (id ? `Listing ${id.slice(0, 8)}` : 'Unknown listing');
  const nameOf = (id: string | null) =>
    (id && (profileById.get(id)?.full_name || profileById.get(id)?.email)) ||
    (id ? id.slice(0, 8) : 'unknown');

  const checks: HealthCheck[] = [];

  /* ---- ownership: money with no destination ---------------------------- */

  checks.push({
    id: 'listing-no-owner',
    title: 'Homes with no owner',
    severity: 'critical',
    detail:
      'These homes can be booked and paid for, but the escrow has nobody to release to. The payment succeeds and the money becomes unattributable.',
    fix: 'Assign the owner on the Listings screen. It backfills the host on bookings already taken against the home.',
    href: '/listings',
    items: listings
      .filter((row) => !row.owner_profile_id)
      .map((row) => ({ id: row.id, label: row.title, meta: row.neighborhood ?? undefined })),
  });

  checks.push({
    id: 'booking-no-host',
    title: 'Bookings recording no host',
    severity: 'critical',
    detail:
      'The host is never told these homes were booked, and the payout has no recipient. The renter believes the booking is confirmed.',
    fix: 'Fixed by assigning the owner of the home each booking belongs to.',
    href: '/listings',
    items: bookings
      .filter((row) => !row.host_profile_id)
      .map((row) => ({
        id: row.id,
        label: titleOf(row.listing_id),
        meta: row.amount_kes ? `KES ${Number(row.amount_kes).toLocaleString()}` : undefined,
      })),
  });

  checks.push({
    id: 'payment-no-payee',
    title: 'Payments with no payee',
    severity: 'critical',
    detail:
      'Money is held against nobody. It cannot be released to a host or counted towards what any host is owed.',
    fix: 'Repair the owning listing, then re-check. New payments inherit the host from the listing at the moment of booking.',
    href: '/finance',
    items: payments
      .filter((row) => !row.profile_id && PAID_PAYMENT_STATUSES.has(row.status))
      .map((row) => ({
        id: row.id,
        label: `KES ${Number(row.amount_kes ?? 0).toLocaleString()}`,
        meta: row.payer_phone ?? undefined,
      })),
  });

  /* ---- availability: homes sold twice, or withheld for nothing --------- */

  const paidListingIds = new Set(
    bookings
      .filter((row) => isLiveBooking(row) && PAID_PAYMENT_STATUSES.has(row.payment_status ?? ''))
      .map((row) => row.listing_id)
      .filter((id): id is string => Boolean(id))
  );

  checks.push({
    id: 'paid-still-listed',
    title: 'Paid homes still being offered',
    severity: 'critical',
    detail:
      'Someone has paid for these long lets, but they are still live in the feed. A second renter can pay for a home that is already taken.',
    fix: 'Mark the home booked on the Listings screen, or confirm the earlier booking was cancelled.',
    href: '/listings',
    items: [...paidListingIds]
      .map((id) => listingById.get(id))
      .filter((row): row is ListingRow => Boolean(row))
      .filter((row) => !row.is_booked && leavesFeedWhenLet(row))
      .map((row) => ({ id: row.id, label: row.title, meta: row.neighborhood ?? undefined })),
  });

  checks.push({
    id: 'booked-not-paid',
    title: 'Homes withheld with no booking behind them',
    severity: 'medium',
    detail:
      'Marked booked, but no payment is held against them. They earn nothing while nobody can see them.',
    fix: 'Return the home to the feed on the Listings screen if the booking fell through.',
    href: '/listings',
    items: listings
      .filter((row) => row.is_booked && !paidListingIds.has(row.id))
      .map((row) => ({ id: row.id, label: row.title, meta: row.neighborhood ?? undefined })),
  });

  /* ---- the same nights sold twice -------------------------------------- */

  const overlaps: HealthItem[] = [];
  const byListing = new Map<string, BookingRow[]>();
  const windowOf = new Map<string, { start: string; end: string }>();
  for (const row of bookings) {
    if (!row.listing_id || !isLiveBooking(row)) continue;
    const window = stayWindow(row);
    if (!window) continue;
    windowOf.set(row.id, window);
    const list = byListing.get(row.listing_id) ?? [];
    list.push(row);
    byListing.set(row.listing_id, list);
  }

  for (const [listingId, rows] of byListing) {
    const sorted = [...rows].sort((a, b) =>
      windowOf.get(a.id)!.start.localeCompare(windowOf.get(b.id)!.start)
    );
    for (let i = 0; i < sorted.length; i += 1) {
      for (let j = i + 1; j < sorted.length; j += 1) {
        const a = windowOf.get(sorted[i].id)!;
        const b = windowOf.get(sorted[j].id)!;
        // Sorted by start, so once one starts after the other ends nothing
        // further down can overlap either.
        if (b.start >= a.end) break;
        if (datesOverlap(a.start, a.end, b.start, b.end)) {
          overlaps.push({
            id: sorted[j].id,
            label: titleOf(listingId),
            meta: `${a.start}→${a.end} clashes with ${b.start}→${b.end}`,
          });
        }
      }
    }
  }

  checks.push({
    id: 'double-booked-dates',
    title: 'The same nights sold twice',
    severity: 'critical',
    detail:
      'Two live bookings cover overlapping dates on one home. Both guests expect to arrive, and one of them will be turned away at the door.',
    fix: 'Contact both guests and refund one before the earlier check-in date.',
    href: '/bookings',
    items: overlaps,
  });

  /* ---- payouts --------------------------------------------------------- */

  checks.push({
    id: 'payout-no-destination',
    title: 'Payout requests with nowhere to send money',
    severity: 'high',
    detail: 'A host is waiting on money and no destination number was recorded against the request.',
    fix: 'Ask the host for the M-Pesa number on the account, then reissue the request.',
    href: '/payouts',
    items: payouts
      .filter(
        (row) =>
          (row.status === 'pending' || row.status === 'processing') &&
          !row.destination_phone &&
          !row.reference_note
      )
      .map((row) => ({
        id: row.id,
        label: nameOf(row.profile_id),
        meta: `KES ${Number(row.amount_kes ?? 0).toLocaleString()}`,
      })),
  });

  // What a host has actually earned, against what they have asked for or been
  // sent. Paying out more than escrow released is money the platform never had.
  const releasedByHost = new Map<string, number>();
  for (const row of payments) {
    if (row.status !== 'released' || !row.profile_id) continue;
    releasedByHost.set(row.profile_id, (releasedByHost.get(row.profile_id) ?? 0) + Number(row.amount_kes ?? 0));
  }

  const claimedByHost = new Map<string, number>();
  for (const row of payouts) {
    if (row.status === 'cancelled' || row.status === 'failed' || !row.profile_id) continue;
    claimedByHost.set(row.profile_id, (claimedByHost.get(row.profile_id) ?? 0) + Number(row.amount_kes ?? 0));
  }

  checks.push({
    id: 'payout-over-earned',
    title: 'Payouts above what escrow released',
    severity: 'critical',
    detail:
      'These hosts have been paid, or are queued to be paid, more than renters have released to them. The difference comes out of the platform.',
    fix: 'Hold the request and reconcile against the released payments on the Finance screen before sending anything.',
    href: '/finance',
    items: [...claimedByHost.entries()]
      .filter(([profileId, claimed]) => claimed > (releasedByHost.get(profileId) ?? 0))
      .map(([profileId, claimed]) => ({
        id: profileId,
        label: nameOf(profileId),
        meta: `claimed KES ${claimed.toLocaleString()} vs released KES ${(releasedByHost.get(profileId) ?? 0).toLocaleString()}`,
      })),
  });

  /* ---- escrow handles -------------------------------------------------- */

  checks.push({
    id: 'held-no-transaction',
    title: 'Held money with no escrow reference',
    severity: 'high',
    detail:
      'These payments record no Econfirm transaction, so neither release nor refund can be carried out on them from anywhere.',
    fix: 'Trace the payment with Econfirm using the payer number and confirmation code, then record the transaction id.',
    href: '/finance',
    items: payments
      .filter(
        (row) => row.status === 'held' && !row.econfirm_transaction_id && !row.checkout_request_id
      )
      .map((row) => ({
        id: row.id,
        label: `KES ${Number(row.amount_kes ?? 0).toLocaleString()}`,
        meta: row.payer_phone ?? undefined,
      })),
  });

  const seenTransactions = new Map<string, number>();
  for (const row of payments) {
    if (!row.econfirm_transaction_id) continue;
    seenTransactions.set(
      row.econfirm_transaction_id,
      (seenTransactions.get(row.econfirm_transaction_id) ?? 0) + 1
    );
  }

  checks.push({
    id: 'duplicate-transaction',
    title: 'One escrow transaction against several payments',
    severity: 'high',
    detail:
      'The same Econfirm transaction backs more than one payment record. Releasing once would mark several bookings paid.',
    fix: 'Keep the payment that matches the amount and remove the duplicates on the Finance screen.',
    href: '/finance',
    items: [...seenTransactions.entries()]
      .filter(([, count]) => count > 1)
      .map(([transactionId, count]) => ({
        id: transactionId,
        label: transactionId,
        meta: `${count} payment records`,
      })),
  });

  /* ---- the posting gate ------------------------------------------------ */

  const ownersWithListings = new Set(
    listings.map((row) => row.owner_profile_id).filter((id): id is string => Boolean(id))
  );

  checks.push({
    id: 'unverified-host',
    title: 'Unverified accounts with live homes',
    severity: 'high',
    detail:
      'Verification is meant to gate posting. These accounts have homes listed without it, so either the gate was bypassed or they were verified and later revoked.',
    fix: 'Review the account and either verify it or pause its homes.',
    href: '/verifications',
    items: [...ownersWithListings]
      .map((id) => profileById.get(id))
      .filter((row): row is ProfileRow => Boolean(row) && !row!.verified)
      .map((row) => ({
        id: row.id,
        label: row.full_name || row.email || row.id.slice(0, 8),
        meta: `${listings.filter((l) => l.owner_profile_id === row.id).length} home(s)`,
      })),
  });

  const failing = checks
    .filter((check) => check.items.length > 0)
    .sort(
      (a, b) =>
        SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) ||
        b.items.length - a.items.length
    );

  const counts: Record<Severity, number> = { critical: 0, high: 0, medium: 0 };
  for (const check of failing) counts[check.severity] += 1;

  return {
    checks,
    failing,
    counts,
    affected: failing.reduce((total, check) => total + check.items.length, 0),
    worst: failing.length > 0 ? failing[0].severity : null,
  };
}
