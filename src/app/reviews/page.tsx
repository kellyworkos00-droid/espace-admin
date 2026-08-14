import { DataTable } from '@/components/data-table';
import { Shell } from '@/components/shell';
import {
  Badge,
  Metric,
  Notice,
  PageHead,
  PersonCell,
  Stars,
  ago,
  personIndex,
  personSearch,
  LoadError,
} from '@/components/ui';
import { requireAdmin } from '@/lib/auth';
import { hasServiceRole } from '@/lib/supabase';
import { getBookings, getListings, getProfiles, getReviews } from '@/lib/queries';

export const dynamic = 'force-dynamic';

/**
 * Reviews, and whether they were earned.
 *
 * Clause 9 of the Terms says a review may only be left by someone with a
 * genuine completed booking, and that reviews traded for payment or left on
 * your own listing will be removed. The console could not see a review at all,
 * so that clause described an enforcement that did not exist.
 *
 * The two checks here are the ones a fake review usually fails, and both are
 * facts rather than guesses:
 *
 *   Self-review -- the reviewer owns the listing. That is not a suspicion; the
 *   two ids are equal or they are not.
 *
 *   No booking -- the review cites no booking, or cites one that is not the
 *   reviewer's. Clause 9 requires a genuine completed booking, so a review
 *   without one has nothing standing behind it.
 *
 * Removal is not wired to a button. Deleting a stranger's review is a decision
 * with a person on the other end of it, and the reviewer's account, the host's
 * rating and the booking record all move when it happens. Reading first,
 * acting second, is the right order -- and doing it in Supabase leaves a trail
 * this console does not yet keep.
 */

export default async function ReviewsPage() {
  await requireAdmin();

  const [reviews, listings, profiles, bookings] = await Promise.all([
    getReviews(),
    getListings(),
    getProfiles(),
    getBookings(),
  ]);

  const people = personIndex(profiles.rows);
  const listingById = new Map(listings.rows.map((row) => [row.id, row]));
  const bookingById = new Map(bookings.rows.map((row) => [row.id, row]));

  const assessed = reviews.rows.map((review) => {
    const listing = review.listing_id ? listingById.get(review.listing_id) : undefined;
    const booking = review.booking_id ? bookingById.get(review.booking_id) : undefined;

    const selfReview = Boolean(
      listing?.owner_profile_id &&
        review.reviewer_profile_id &&
        listing.owner_profile_id === review.reviewer_profile_id
    );

    // Either no booking is cited, or the one cited belongs to somebody else.
    const unbacked =
      !booking || (booking.guest_profile_id ?? null) !== (review.reviewer_profile_id ?? null);

    return { review, listing, booking, selfReview, unbacked };
  });

  const selfReviews = assessed.filter((row) => row.selfReview);
  const unbacked = assessed.filter((row) => row.unbacked && !row.selfReview);

  const average =
    reviews.rows.length > 0
      ? reviews.rows.reduce((total, row) => total + Number(row.rating_overall ?? 0), 0) /
        reviews.rows.length
      : 0;

  return (
    <Shell>
      <PageHead
        title="Reviews"
        description="Every review, and whether there is a real booking behind it. Ratings decide what the app ranks first, so a bought review moves a home up the feed."
      />

      <LoadError
        error={reviews.error}
        what="reviews"
        keyed={hasServiceRole}
        hint={<>If this names the table, <code>SUPABASE_REVIEWS_SETUP.sql</code> has not been run yet.</>}
      />

      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <Metric label="Reviews" value={reviews.rows.length} />
        <Metric
          label="Average rating"
          value={reviews.rows.length > 0 ? average.toFixed(2) : '—'}
          hint={reviews.rows.length > 0 ? <Stars value={average} /> : 'Nothing to average yet'}
        />
        <Metric
          label="Self-reviews"
          value={selfReviews.length}
          tone={selfReviews.length > 0 ? 'bad' : undefined}
          hint="Host reviewing their own listing"
        />
        <Metric
          label="No booking behind them"
          value={unbacked.length}
          tone={unbacked.length > 0 ? 'warn' : undefined}
          hint="Clause 9 requires a completed booking"
        />
      </div>

      {selfReviews.length > 0 ? (
        <Notice tone="error" title={`${selfReviews.length} review(s) written by the listing's own owner`}>
          The reviewer and the owner are the same account. Clause 9 prohibits this outright, and each
          one is inflating that home&rsquo;s position in search right now.
        </Notice>
      ) : null}

      <DataTable
        head={['Listing', 'Reviewer', 'Rating', 'What they wrote', 'Backing', 'When']}
        placeholder="Search by listing, reviewer, or what the review says…"
        noun="review"
        filters={[
          { value: 'self', label: 'Self-review' },
          { value: 'unbacked', label: 'No booking' },
          { value: 'genuine', label: 'Backed by a booking' },
        ]}
        empty={
          <>
            <strong>No reviews yet.</strong>
            They appear here as renters start rating the homes they have stayed in.
          </>
        }>
        {assessed.map(({ review, listing, booking, selfReview, unbacked: noBooking }) => {
          const haystack = [
            listing?.title,
            listing?.neighborhood,
            listing?.county,
            personSearch(review.reviewer_profile_id, people),
            review.comment,
          ]
            .filter(Boolean)
            .join(' ');

          return (
            <tr
              key={review.id}
              data-search={haystack}
              data-filter={selfReview ? 'self' : noBooking ? 'unbacked' : 'genuine'}>
              <td>
                <div style={{ fontWeight: 700 }}>{listing?.title ?? 'Listing removed'}</div>
                <div className="mono">{listing?.neighborhood ?? review.listing_id ?? '—'}</div>
              </td>

              <td>
                <PersonCell id={review.reviewer_profile_id} people={people} />
              </td>

              <td className="nowrap">
                <Stars value={review.rating_overall} />
                <div className="mono">{review.rating_overall ?? '—'} of 5</div>
              </td>

              <td>
                <div className="review-text">
                  {review.comment?.trim() || <span className="mono">Rating only, no comment</span>}
                </div>
                {review.host_response ? (
                  <div className="mono" style={{ marginTop: 5 }}>
                    Host replied {ago(review.host_response_at)}
                  </div>
                ) : null}
              </td>

              <td>
                {selfReview ? (
                  <Badge value="own listing" tone="red" />
                ) : noBooking ? (
                  // An HTML entity in a JS string renders as its own source
                  // text, so this stays a plain apostrophe.
                  <Badge value={booking ? "another guest's booking" : 'no booking'} tone="amber" />
                ) : (
                  <Badge value="booking confirmed" tone="green" />
                )}
              </td>

              <td className="dim nowrap">{ago(review.created_at)}</td>
            </tr>
          );
        })}
      </DataTable>
    </Shell>
  );
}
