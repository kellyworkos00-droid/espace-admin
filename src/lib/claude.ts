import 'server-only';

import Anthropic from '@anthropic-ai/sdk';

/**
 * Listing photo scoring, server side only.
 *
 * Same rule as Infobip, for the same reason: this key spends real money, so it
 * lives in the server environment and nothing here is ever imported by the
 * mobile app. A key with an EXPO_PUBLIC_ prefix ships inside the APK and can be
 * pulled out of a downloaded build in about a minute.
 *
 * What this is for: the homepage currently has no way to tell a listing with
 * four clear photos of four different rooms from one with eight dark shots of
 * the same corner. `listing-completeness.ts` in the app already scores the
 * mechanical half -- are the fields filled in -- and this is the other half,
 * the part that needs eyes.
 */

const KEY = process.env.ANTHROPIC_API_KEY ?? '';

export function claudeConfigured() {
  return Boolean(KEY);
}

/**
 * Cap on photos sent in one call.
 *
 * Cost is linear in images and nobody needs the fortieth photo of a bedsitter
 * scored. Twelve covers every listing we have with room to spare; anything
 * beyond it is almost always the same room again.
 */
const MAX_PHOTOS = 12;

/**
 * The rubric.
 *
 * Cached as a system block, so after the first call of a batch it bills at
 * roughly a tenth. That means length here is nearly free, and detail is what
 * keeps two runs over the same listing agreeing with each other.
 */
const RUBRIC = `You are grading the photographs on a Kenyan rental listing so the best ones can be shown first, and so the host can be told exactly what to fix.

You will be given every photo on one listing, in order, followed by what the host claims it is. Photo 0 is the cover -- the only one most people ever see.

Judge each photo on:

SHARP -- can you make out edges and detail, or is it smeared by camera shake. Judge the room, not the window: a bright window behind a dim room is normal, not blur.

WELL_LIT -- can a renter actually see the space. Kenyan interiors are often shot without flash and come out very dark. Dim but readable is fine. If you cannot tell what is on the counter, it is not.

ROOM -- name what it shows: living, kitchen, bathroom, bedroom, balcony, exterior, compound, parking, view, floorplan, or unclear. "unclear" is a real answer and a useful one.

AUTHENTIC -- false if it is a screenshot of another app (WhatsApp status bars, message bubbles, another listing site's furniture), carries someone else's watermark or agency branding, is obviously a stock or catalogue interior, or is a photo of a document or a person rather than a property. This matters here: agents in Kenya forward each other listing photos constantly, so a screenshot is both a quality problem and a sign the listing may not be theirs to let.

Then judge the set as a whole:

ROOMS_COVERED / ROOMS_MISSING -- for a home, renters need to see at minimum the living space, the kitchen, and the bathroom. Bedrooms matter as the bedroom count rises. For commercial space, the open floor and the frontage matter more than any of that. Missing the bathroom is the single most common gap and the one people ask about first.

BEST_COVER_INDEX -- of the photos present, which one should lead. Pick the one that best shows the space someone is deciding about: bright, wide, and characteristic. Do not pick the compound gate or a close-up of a tap.

NEAR_DUPLICATES -- indices of photos that show substantially the same view as an earlier photo. The earlier one is not a duplicate; later ones are.

SET_SCORE -- 0 to 100. Coverage beats polish. Four honest photos of four different rooms should outscore eight sharp photos of one. Start around 50 for an adequate set, go up for coverage and clarity, down for gaps, darkness, blur, and repetition. Anything inauthentic caps the set at 25.

HOST_ADVICE -- at most four short lines addressed to the host, in plain English, each naming one concrete thing to do. "Add a photo of the bathroom" and "Shoot the kitchen in daylight, it is too dark to see the counter" are useful. "Improve photo quality" is not. If the set is genuinely good, say so and give fewer lines.

Be fair. Most of these are taken on a phone by someone letting out one flat, not by a photographer. Grade whether a renter can see what they are getting, not whether it is beautiful.`;

const SCHEMA = {
  type: 'object',
  properties: {
    per_photo: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          index: { type: 'integer' },
          sharp: { type: 'boolean' },
          well_lit: { type: 'boolean' },
          room: { type: 'string' },
          authentic: { type: 'boolean' },
          why_not: { type: 'string' },
        },
        required: ['index', 'sharp', 'well_lit', 'room', 'authentic', 'why_not'],
        additionalProperties: false,
      },
    },
    rooms_covered: { type: 'array', items: { type: 'string' } },
    rooms_missing: { type: 'array', items: { type: 'string' } },
    best_cover_index: { type: 'integer' },
    near_duplicates: { type: 'array', items: { type: 'integer' } },
    set_score: { type: 'integer' },
    host_advice: { type: 'array', items: { type: 'string' } },
  },
  required: [
    'per_photo',
    'rooms_covered',
    'rooms_missing',
    'best_cover_index',
    'near_duplicates',
    'set_score',
    'host_advice',
  ],
  additionalProperties: false,
} as const;

export type PhotoVerdict = {
  index: number;
  sharp: boolean;
  well_lit: boolean;
  room: string;
  authentic: boolean;
  why_not: string;
};

export type ListingPhotoReport = {
  per_photo: PhotoVerdict[];
  rooms_covered: string[];
  rooms_missing: string[];
  best_cover_index: number;
  near_duplicates: number[];
  set_score: number;
  host_advice: string[];
};

export type ScoreResult =
  | { ok: true; report: ListingPhotoReport; scored: number }
  | { ok: false; message: string };

export type ListingForScoring = {
  photoUrls: string[];
  houseType?: string | null;
  area?: string | null;
  priceKes?: number | null;
  bedrooms?: number | null;
  description?: string | null;
};

/**
 * Scores every photo on one listing in a single request.
 *
 * One call rather than one per photo, because most of what matters is only
 * visible across the set -- whether the bathroom is missing, which shot should
 * lead, which three are the same wall. Per-photo calls cannot see any of that,
 * and they pay for the rubric every time instead of once.
 */
export async function scoreListingPhotos(listing: ListingForScoring): Promise<ScoreResult> {
  if (!claudeConfigured()) {
    return { ok: false, message: 'Photo scoring is not configured on the server.' };
  }

  const urls = listing.photoUrls.filter(Boolean).slice(0, MAX_PHOTOS);

  // A listing with no photos scores zero by definition. Paying a model to
  // discover that an array is empty is money for nothing.
  if (urls.length === 0) {
    return { ok: false, message: 'That listing has no photos to score.' };
  }

  const claimed = [
    listing.houseType ? `Type: ${listing.houseType}` : null,
    listing.area ? `Area: ${listing.area}` : null,
    typeof listing.priceKes === 'number' ? `Price: KES ${listing.priceKes.toLocaleString('en-KE')}` : null,
    typeof listing.bedrooms === 'number' ? `Bedrooms: ${listing.bedrooms}` : null,
    listing.description ? `Description as written by the host:\n${listing.description}` : 'No description written.',
  ]
    .filter(Boolean)
    .join('\n');

  const client = new Anthropic({ apiKey: KEY });

  try {
    const response = await client.messages.create({
      model: 'claude-opus-5',
      // Thinking is on by default on this model and shares the budget with the
      // reply, so this is sized for both. A listing at the twelve-photo cap
      // produces a fair amount of JSON on its own.
      max_tokens: 8000,
      // Bounded classification against a fixed rubric -- it does not need the
      // top of the range, and this runs over every listing we have. Worth
      // sweeping against real listings before settling on it.
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
      system: [{ type: 'text', text: RUBRIC, cache_control: { type: 'ephemeral' } }],
      messages: [
        {
          role: 'user',
          content: [
            ...urls.map((url) => ({ type: 'image' as const, source: { type: 'url' as const, url } })),
            { type: 'text' as const, text: `${urls.length} photo(s), in order, index 0 first.\n\n${claimed}` },
          ],
        },
      ],
    });

    // Checked before touching content. On a refusal the array can be empty, and
    // reading content[0] would throw rather than fail with something sayable.
    if (response.stop_reason === 'refusal') {
      console.error('Claude declined to score a listing', response.stop_details);
      return { ok: false, message: 'That listing could not be scored automatically. Review it by hand.' };
    }

    const text = response.content.find((b) => b.type === 'text');
    if (!text || text.type !== 'text') {
      console.error('Claude returned no text block', response.stop_reason);
      return { ok: false, message: 'Scoring came back empty. Try again.' };
    }

    return { ok: true, report: JSON.parse(text.text) as ListingPhotoReport, scored: urls.length };
  } catch (error) {
    // The provider's own message can name the account or the key; keep it in
    // the server log and give the console something plain.
    console.error('Claude scoreListingPhotos threw', error);
    return { ok: false, message: 'We could not reach the scoring service. Try again shortly.' };
  }
}

/**
 * Whether a set needs a human to look at it before it goes live.
 *
 * Separate from the score on purpose. A dark photo should rank lower; a
 * watermarked photo lifted from another agency should not rank lower, it should
 * stop. Folding both into one number leaves a stolen listing sitting quietly at
 * position forty, still live.
 */
export function needsReview(report: ListingPhotoReport): { flagged: boolean; reasons: string[] } {
  const reasons = report.per_photo
    .filter((p) => !p.authentic)
    .map((p) => `Photo ${p.index + 1}: ${p.why_not || 'does not look like the host’s own photo'}`);

  return { flagged: reasons.length > 0, reasons };
}
