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
  /** What E Space earns on this booking, priced when the booking was made. */
  commission_kes?: number | null;
  /** The rate that produced it, kept so an old figure can still be explained. */
  commission_rate?: number | null;
  commission_status?: 'pending' | 'collected' | 'waived' | null;
  commission_collected_at?: string | null;
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

export type MessageRow = {
  id: string;
  thread_key: string | null;
  booking_id: string | null;
  listing_id?: string | null;
  sender_profile_id: string | null;
  recipient_profile_id: string | null;
  body: string | null;
  is_read: boolean | null;
  sent_at: string;
};

export type ReviewRow = {
  id: string;
  listing_id: string | null;
  reviewer_profile_id: string | null;
  booking_id: string | null;
  rating_overall: number | null;
  rating_cleanliness: number | null;
  rating_accuracy: number | null;
  rating_communication: number | null;
  rating_location: number | null;
  rating_value: number | null;
  comment: string | null;
  host_response: string | null;
  host_response_at: string | null;
  created_at: string | null;
};

export type ReportRow = {
  id: string;
  listing_id: string | null;
  reporter_profile_id: string | null;
  reason: string;
  detail: string | null;
  status: string;
  reviewer_note: string | null;
  created_at: string;
  reviewed_at: string | null;
};

/**
 * Reports on listings, newest first.
 *
 * The app's report button used to open an alert and offer the support screen;
 * nothing was written down, so a home reported by eleven people looked exactly
 * like one reported by nobody. Clause 6 of the Terms lets E Space withhold
 * release on "a credible report of fraud, an unsafe space, or a listing that
 * does not exist" -- a judgement that needs the reports in front of somebody.
 */
export async function getReports() {
  return sb<ReportRow>('listing_reports', {
    query: 'select=*&order=created_at.desc&limit=300',
  });
}

/**
 * Conversations, newest first.
 *
 * The Terms tell a renter that a refund request is reviewed "against the
 * listing and the messages between you". Until now the console could not read
 * a single message, so that promise had no way of being kept -- whoever
 * handled a dispute was deciding on one side's account of it.
 *
 * Ordered ascending within a thread by the screen that renders it; ascending
 * here too so a thread reads top to bottom the way it was written.
 */
export async function getMessages() {
  return sb<MessageRow>('messages', { query: 'select=*&order=sent_at.asc&limit=500' });
}

/**
 * Reviews, for moderation.
 *
 * The Terms say reviews that are bought, self-written or malicious "will be
 * removed". Nothing in the console could see a review, let alone remove one.
 * This at least makes them readable, alongside the booking each claims to come
 * from -- which is what a paid-for review usually fails to have.
 */
export async function getReviews() {
  return sb<ReviewRow>('listing_reviews', { query: 'select=*&order=created_at.desc&limit=300' });
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
