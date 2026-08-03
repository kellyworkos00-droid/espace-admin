import 'server-only';

import { sb } from './supabase';

export type PayoutRow = {
  id: string;
  profile_id: string | null;
  amount_kes: number;
  status: string;
  payout_method: string;
  reference_note: string | null;
  created_at: string;
  processed_at: string | null;
  destination_phone?: string | null;
  destination_name?: string | null;
  failure_reason?: string | null;
};

export type PaymentRow = {
  id: string;
  booking_id: string | null;
  profile_id: string | null;
  amount_kes: number;
  status: string;
  provider: string;
  payer_phone: string | null;
  provider_confirmation_code: string | null;
  econfirm_transaction_id: string | null;
  checkout_request_id: string | null;
  created_at: string;
};

export type BookingRow = {
  id: string;
  listing_id: string | null;
  guest_profile_id: string | null;
  host_profile_id: string | null;
  status: string;
  payment_status: string | null;
  request_status: string | null;
  amount_kes: number | null;
  check_in_date: string | null;
  check_out_date: string | null;
  /** What the app actually writes; the check_* pair exists but is left null. */
  move_in_date?: string | null;
  checkout_date?: string | null;
  created_at: string;
};

export type ListingRow = {
  id: string;
  owner_profile_id: string | null;
  title: string;
  neighborhood: string | null;
  county: string | null;
  monthly_rent_kes: number | null;
  nightly_rate_kes: number | null;
  verified: boolean | null;
  /** 'long_stay' | 'short_stay'. Decides whether a home leaves the feed when let. */
  stay_type?: string | null;
  is_paused?: boolean | null;
  is_booked?: boolean | null;
  created_at?: string | null;
};

export type ProfileRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  role: string | null;
  verified: boolean | null;
  host_type?: string | null;
  created_at?: string | null;
};

export type VerificationRow = {
  id: string;
  profile_id: string;
  legal_name: string;
  doc_type: string;
  doc_number: string | null;
  front_url: string | null;
  back_url: string | null;
  selfie_url: string | null;
  status: string;
  reviewer_note: string | null;
  submitted_at: string;
  reviewed_at: string | null;
};

/** Review queue, oldest first: the longest wait is dealt with first. */
export async function getVerifications(status?: string) {
  const filter = status && status !== 'all' ? `&status=eq.${status}` : '';
  return sb<VerificationRow>('verification_requests', {
    query: `select=*&order=submitted_at.asc&limit=200${filter}`,
  });
}

/**
 * A viewable link for a document in the private bucket.
 *
 * The bucket is private because these are identity papers, so the reviewer's
 * own key is what authorises the read. Passing the key in the URL keeps this to
 * a plain link, and the console is already behind a login.
 */
export function signedDocUrl(path: string) {
  const base = process.env.SUPABASE_URL ?? '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';
  return `${base}/storage/v1/object/authenticated/verification-docs/${path}?apikey=${key}`;
}

/**
 * The payout queue.
 *
 * Oldest first: a host who requested three days ago has waited longer than one
 * who requested this morning, and a queue sorted newest-first quietly punishes
 * patience.
 */
export async function getPayouts(status?: string) {
  const filter = status && status !== 'all' ? `&status=eq.${status}` : '';
  return sb<PayoutRow>('payout_requests', {
    query: `select=*&order=created_at.asc&limit=200${filter}`,
  });
}

export async function getPayments(status?: string) {
  const filter = status && status !== 'all' ? `&status=eq.${status}` : '';
  return sb<PaymentRow>('payments', {
    query: `select=*&order=created_at.desc&limit=200${filter}`,
  });
}

export async function getBookings() {
  return sb<BookingRow>('bookings', { query: 'select=*&order=created_at.desc&limit=200' });
}

export async function getListings() {
  return sb<ListingRow>('listings', { query: 'select=*&order=created_at.desc&limit=300' });
}

export async function getProfiles() {
  return sb<ProfileRow>('profiles', { query: 'select=*&order=id.asc&limit=300' });
}

/** Everything the overview needs, in one pass. */
export async function getOverview() {
  const [payouts, payments, bookings, listings, profiles] = await Promise.all([
    getPayouts(),
    getPayments(),
    getBookings(),
    getListings(),
    getProfiles(),
  ]);

  const sum = (rows: { amount_kes: number | null }[]) =>
    rows.reduce((total, row) => total + Number(row.amount_kes ?? 0), 0);

  const held = payments.rows.filter((row) => row.status === 'held' || row.status === 'pending');
  const released = payments.rows.filter((row) => row.status === 'released');
  const queuedPayouts = payouts.rows.filter(
    (row) => row.status === 'pending' || row.status === 'processing'
  );

  // A listing with no owner cannot pay anyone: bookings against it record no
  // host, so the escrow has no destination. Surfaced as a headline number
  // because it silently breaks payouts rather than throwing anything.
  const orphanListings = listings.rows.filter((row) => !row.owner_profile_id);
  const orphanBookings = bookings.rows.filter((row) => !row.host_profile_id);
  const unattributedPayments = payments.rows.filter((row) => !row.profile_id);

  return {
    payouts,
    payments,
    bookings,
    listings,
    profiles,
    metrics: {
      heldKes: sum(held),
      heldCount: held.length,
      releasedKes: sum(released),
      queuedPayoutKes: queuedPayouts.reduce((t, r) => t + Number(r.amount_kes ?? 0), 0),
      queuedPayoutCount: queuedPayouts.length,
      listingCount: listings.rows.length,
      bookingCount: bookings.rows.length,
      profileCount: profiles.rows.length,
      unverifiedCount: profiles.rows.filter((row) => !row.verified).length,
      orphanListings: orphanListings.length,
      orphanBookings: orphanBookings.length,
      unattributedPayments: unattributedPayments.length,
    },
    error: payouts.error ?? payments.error ?? bookings.error ?? listings.error ?? profiles.error,
  };
}
