import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { Shell } from '@/components/shell';
import { Badge, LoadError, Metric, Notice, PageHead, ago, when } from '@/components/ui';
import { requireAdmin } from '@/lib/auth';
import {
  getConsents,
  getListings,
  getProfiles,
  getVerifications,
  signedUrls,
  type ConsentRow,
  type ProfileRow,
  type VerificationRow,
} from '@/lib/queries';
import { hasServiceRole, sb } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const FILTERS = ['pending', 'approved', 'rejected', 'all'] as const;
type Filter = (typeof FILTERS)[number];

const FILTER_LABELS: Record<Filter, string> = {
  pending: 'Waiting',
  approved: 'Approved',
  rejected: 'Rejected',
  all: 'All',
};

const DOC_LABELS: Record<string, string> = {
  national_id: 'National ID',
  passport: 'Passport',
  driving_license: 'Driving licence',
  driving_licence: 'Driving licence',
  alien_card: 'Alien card',
};

/**
 * Why a request was turned down, in the words the applicant will read.
 *
 * The app shows reviewer_note as it is, so a reason here is a message to a
 * person, and it tells them what to do next. A blank or one-word note
 * ("blurry") left them guessing what to fix.
 */
const REJECT_REASONS = [
  {
    value: 'blurry',
    label: 'Photos blurry or cut off',
    note: 'Your photos were blurry or cut off. Take them again in good light, with the whole document in the frame.',
  },
  {
    value: 'selfie',
    label: 'Selfie does not match the ID',
    note: 'Your selfie did not match the photo on your ID. Take a clear selfie facing the camera, without a hat or sunglasses.',
  },
  {
    value: 'name',
    label: 'Name does not match the account',
    note: 'The name on your ID does not match the name on your E Space account. Change your profile name to match your ID, then submit again.',
  },
  {
    value: 'expired',
    label: 'Document expired',
    note: 'Your document has expired. Submit a valid national ID, passport, driving licence or alien card.',
  },
  {
    value: 'wrong',
    label: 'Not an accepted document',
    note: 'We could not accept this document. Use a national ID, passport, driving licence or alien card.',
  },
  {
    value: 'other',
    label: 'Other (write it below)',
    note: '',
  },
] as const;

/**
 * Identity review.
 *
 * Every ID is checked by a person here. Approving is what sets
 * profiles.verified, and nothing else in the system does: the badge gates
 * listing and payouts, so it is never granted by the applicant's own phone.
 *
 * One card per request rather than a table row, because the decision is made
 * by looking: the front, the back and the selfie side by side, with the name
 * to check against them right next to the buttons. The old table offered
 * three links that opened in new tabs, and the links did not even load.
 */
export default async function VerificationsPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    person?: string;
    done?: string;
    who?: string;
    error?: string;
  }>;
}) {
  await requireAdmin();

  const params = await searchParams;
  const status: Filter = FILTERS.includes(params.status as Filter) ? (params.status as Filter) : 'pending';
  const person = params.person?.trim() || null;

  const [requests, profiles, consents, listings] = await Promise.all([
    getVerifications('all'),
    getProfiles(),
    getConsents(),
    getListings(),
  ]);

  const byId = new Map(profiles.rows.map((row) => [row.id, row]));
  const missingTable = Boolean(requests.error && /verification_requests/i.test(requests.error));

  // Rows arrive oldest first. That order suits the waiting queue (the longest
  // wait is on top); anything already decided reads better newest first.
  const all = requests.rows;
  const pending = all.filter((row) => row.status === 'pending');
  let shown = person
    ? all.filter((row) => row.profile_id === person)
    : status === 'all'
      ? all
      : all.filter((row) => row.status === status);
  if (person || status !== 'pending') shown = [...shown].reverse();

  const links = await signedUrls(
    'verification-docs',
    shown.flatMap((row) => [row.front_url, row.back_url, row.selfie_url])
  );

  // The newest consent per person. Rows are newest first.
  const consentFor = new Map<string, ConsentRow>();
  for (const row of consents.rows) {
    if (!consentFor.has(row.profile_id)) consentFor.set(row.profile_id, row);
  }

  const listingCount = new Map<string, number>();
  for (const row of listings.rows) {
    if (row.owner_profile_id) {
      listingCount.set(row.owner_profile_id, (listingCount.get(row.owner_profile_id) ?? 0) + 1);
    }
  }

  // Accounts carrying the badge with no ID on file: granted by the old app,
  // which verified people the moment they finished the form.
  const withRequest = new Set(all.filter((row) => row.status === 'approved').map((row) => row.profile_id));
  const badgeWithoutId = profiles.rows.filter((row) => row.verified && !withRequest.has(row.id));

  const focus = person ? byId.get(person) : null;

  async function decide(formData: FormData) {
    'use server';

    const id = String(formData.get('id') ?? '');
    const profileId = String(formData.get('profileId') ?? '');
    const next = String(formData.get('next') ?? '');
    const back = String(formData.get('back') ?? 'pending');
    const name = String(formData.get('name') ?? '');
    const reason = REJECT_REASONS.find((item) => item.value === formData.get('reason'));
    const extra = String(formData.get('note') ?? '').trim();

    const home = `/verifications?status=${encodeURIComponent(back)}`;
    if (!id || (next !== 'approved' && next !== 'rejected')) redirect(home);

    const note = next === 'rejected' ? [reason?.note, extra].filter(Boolean).join(' ') : null;
    if (next === 'rejected' && !note) {
      redirect(`${home}&error=${encodeURIComponent('Pick a reason, or write one, so they know what to fix.')}#${id}`);
    }

    const updated = await sb<{ id: string }>('verification_requests', {
      query: `id=eq.${id}`,
      method: 'PATCH',
      returning: true,
      body: { status: next, reviewer_note: note, reviewed_at: new Date().toISOString() },
    });

    // An update the database refused, or one that matched nothing, used to
    // look exactly like success: the page reloaded and the card was still
    // there. Said out loud instead.
    if (updated.error || updated.rows.length === 0) {
      const why = updated.error
        ? `The database refused the change: ${updated.error}`
        : 'Nothing was changed. The console may be missing its service key.';
      redirect(`${home}&error=${encodeURIComponent(why)}#${id}`);
    }

    // The badge lives on the profile, and this is the only place that grants
    // it. Rejecting also revokes, so an account approved earlier cannot keep
    // the badge after a later review fails.
    if (profileId) {
      const badge = await sb('profiles', {
        query: `id=eq.${profileId}`,
        method: 'PATCH',
        returning: true,
        body: { verified: next === 'approved' },
      });
      if (badge.error || badge.rows.length === 0) {
        redirect(
          `${home}&error=${encodeURIComponent(
            `The request was marked ${next}, but the badge on the account did not change: ${badge.error ?? 'no matching profile'}`
          )}`
        );
      }
    }

    revalidatePath('/verifications');
    revalidatePath('/accounts');
    revalidatePath('/payouts');
    revalidatePath('/');
    redirect(`${home}&done=${next}&who=${encodeURIComponent(name)}`);
  }

  const backTo = person ? 'all' : status;

  return (
    <Shell badges={{ '/verifications': pending.length }}>
      <PageHead
        title="Verifications"
        description="Check each ID by eye, then approve or reject. Approving here is the only thing that grants the verified badge and unlocks payouts."
      />

      {params.error ? (
        <Notice tone="error" title="That did not go through">
          {params.error}
        </Notice>
      ) : null}
      {params.done === 'approved' ? (
        <Notice tone="info" title={`${params.who || 'They'} approved`}>
          The verified badge is live on their account, and their payouts are unlocked.
        </Notice>
      ) : null}
      {params.done === 'rejected' ? (
        <Notice tone="info" title={`${params.who || 'They'} rejected`}>
          They will see your reason in the app and can submit again.
        </Notice>
      ) : null}

      {!hasServiceRole ? (
        <Notice tone="warn" title="ID photos need the service key">
          The app&apos;s key cannot read ID photos, on purpose. Set <code>SUPABASE_SERVICE_ROLE_KEY</code>{' '}
          in <code>espace-admin/.env.local</code> and restart the console.
        </Notice>
      ) : null}

      {missingTable ? (
        <Notice tone="warn" title="Verification table not created yet">
          Run <code>SUPABASE_VERIFICATION.sql</code> against your Supabase project. Until then the
          app cannot submit documents and there is nothing to review.
        </Notice>
      ) : (
        <LoadError error={requests.error} what="verifications" keyed={hasServiceRole} />
      )}

      <div className="grid cols-3" style={{ marginBottom: 16 }}>
        <Metric
          label="Waiting for you"
          value={pending.length}
          tone={pending.length > 0 ? 'warn' : 'good'}
          hint="Oldest is shown first"
        />
        <Metric label="Oldest waiting" value={pending[0] ? ago(pending[0].submitted_at) : 'None'} />
        <Metric
          label="Verified accounts"
          value={profiles.rows.filter((row) => row.verified).length}
          hint={`of ${profiles.rows.length} accounts`}
        />
      </div>

      {focus || person ? (
        <Notice tone="info" title={`Every request from ${focus?.full_name ?? 'this account'}`}>
          <a href="/verifications">Back to the queue</a>
        </Notice>
      ) : (
        <div className="chips" style={{ marginBottom: 14 }}>
          {FILTERS.map((option) => (
            <a
              key={option}
              href={`/verifications?status=${option}`}
              className="chip"
              aria-current={option === status ? 'page' : undefined}>
              {FILTER_LABELS[option]}
              <span className="n">
                {option === 'all' ? all.length : all.filter((row) => row.status === option).length}
              </span>
            </a>
          ))}
        </div>
      )}

      {shown.length === 0 ? (
        <div className="card">
          <div className="empty">
            <strong>{status === 'pending' && !person ? 'Nothing waiting' : 'No requests here'}</strong>
            {missingTable
              ? 'Create the table to start receiving submissions.'
              : 'New ID submissions from the app land here, with the photos, ready to check.'}
          </div>
        </div>
      ) : (
        <div className="vlist">
          {shown.map((row) => (
            <RequestCard
              key={row.id}
              row={row}
              profile={byId.get(row.profile_id)}
              consent={consentFor.get(row.profile_id)}
              earlier={all.filter(
                (other) => other.profile_id === row.profile_id && other.submitted_at < row.submitted_at
              )}
              listings={listingCount.get(row.profile_id) ?? 0}
              links={links}
              decide={decide}
              back={backTo}
            />
          ))}
        </div>
      )}

      {badgeWithoutId.length > 0 && !person ? (
        <div style={{ marginTop: 18 }}>
          <Notice tone="warn" title={`${badgeWithoutId.length} accounts have the badge but no ID on file`}>
            The old app verified people the moment they finished the form:{' '}
            {badgeWithoutId.map((row) => row.full_name || row.email || row.id).join(', ')}. Ask them to
            verify again before you pay them out.
          </Notice>
        </div>
      ) : null}
    </Shell>
  );
}

function RequestCard({
  row,
  profile,
  consent,
  earlier,
  listings,
  links,
  decide,
  back,
}: {
  row: VerificationRow;
  profile: ProfileRow | undefined;
  consent: ConsentRow | undefined;
  earlier: VerificationRow[];
  listings: number;
  links: Map<string, string>;
  decide: (formData: FormData) => Promise<void>;
  back: string;
}) {
  const open = row.status === 'pending';
  const name = profile?.full_name?.trim() || 'Unknown account';
  const docLabel = DOC_LABELS[row.doc_type] ?? row.doc_type.replace(/_/g, ' ');
  const nameDiffers = Boolean(
    profile?.full_name &&
      profile.full_name.trim().toLowerCase() !== row.legal_name.trim().toLowerCase()
  );
  const lastRejection = [...earlier].reverse().find((other) => other.status === 'rejected');

  const docs: { label: string; path: string | null; note?: string }[] = [
    { label: 'Front of ID', path: row.front_url },
    {
      label: 'Back of ID',
      path: row.back_url,
      // A passport has one photo page, so the app sends the front twice.
      note: row.doc_type === 'passport' ? 'same as front' : undefined,
    },
    { label: 'Selfie', path: row.selfie_url },
  ];

  return (
    <article className="vcard" id={row.id}>
      <header className="vcard-head">
        <div className="person">
          <span className={profile?.full_name ? 'avatar' : 'avatar unknown'}>{initials(name)}</span>
          <div className="person-lines">
            <div className="person-name">{name}</div>
            <div className="person-sub">{profile?.email ?? row.profile_id}</div>
          </div>
        </div>
        <div className="vcard-status">
          <Badge value={open ? 'waiting' : row.status} tone={open ? 'amber' : undefined} />
          <span className="mono">
            {open ? `sent ${ago(row.submitted_at)}` : `decided ${ago(row.reviewed_at)}`}
          </span>
        </div>
      </header>

      <div className="vbody">
        <div className="vdocs">
          {docs.map((doc) => {
            const href = doc.path ? links.get(doc.path) : undefined;
            return (
              <figure className="vdoc" key={doc.label}>
                {href ? (
                  <a href={href} target="_blank" rel="noreferrer" title={`Open the ${doc.label.toLowerCase()} full size`}>
                    {/* A plain img: these are short-lived signed links to a
                        private bucket, which next/image would try to cache. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={href} alt={`${doc.label} for ${name}`} loading="lazy" referrerPolicy="no-referrer" />
                  </a>
                ) : (
                  <div className="vdoc-missing">
                    {!doc.path ? 'Not sent' : hasServiceRole ? 'Could not load. Reload the page.' : 'Needs the service key'}
                  </div>
                )}
                <figcaption>
                  <span>{doc.label}</span>
                  {doc.note ? <span className="dim">{doc.note}</span> : href ? <span className="dim">click to enlarge</span> : null}
                </figcaption>
              </figure>
            );
          })}
        </div>

        <div className="vside">
          <dl className="vfacts">
            <div>
              <dt>Name to check</dt>
              <dd>
                <strong>{row.legal_name}</strong>
                {nameDiffers ? (
                  <span className="vflag">Account name is different: {profile?.full_name}</span>
                ) : null}
              </dd>
            </div>
            <div>
              <dt>Document</dt>
              <dd>
                {docLabel}
                <span className="sub">{row.doc_number ? `No. ${row.doc_number}` : 'Number not typed in. Read it off the photo.'}</span>
              </dd>
            </div>
            <div>
              <dt>Phone</dt>
              <dd>
                {profile?.phone ?? 'None on the account'}
                {profile?.phone ? (
                  <span className={profile.phone_verified ? 'sub' : 'vflag'}>
                    {profile.phone_verified ? 'Confirmed by SMS code' : 'Not confirmed by SMS'}
                  </span>
                ) : null}
              </dd>
            </div>
            <div>
              <dt>Payout to</dt>
              <dd>
                {profile?.payout_phone ?? 'No payout number yet'}
                {profile?.payout_name ? <span className="sub">Name on M-Pesa: {profile.payout_name}</span> : null}
              </dd>
            </div>
            <div>
              <dt>Account</dt>
              <dd>
                {[profile?.role === 'lister' ? 'Spacer (host)' : profile?.role, profile?.host_type]
                  .filter(Boolean)
                  .join(' · ') || 'Unknown role'}
                <span className="sub">
                  Joined {ago(profile?.created_at)} · {listings} {listings === 1 ? 'listing' : 'listings'}
                </span>
              </dd>
            </div>
            <div>
              <dt>Consent</dt>
              <dd>
                {consent ? (
                  consent.withdrawn_at ? (
                    <span className="vflag">Withdrawn {when(consent.withdrawn_at)}. Do not approve.</span>
                  ) : (
                    <>
                      Given {when(consent.granted_at)}
                      <span className="sub">Policy {consent.policy_version}</span>
                    </>
                  )
                ) : (
                  <span className="vflag">No consent record</span>
                )}
              </dd>
            </div>
            <div>
              <dt>Attempt</dt>
              <dd>
                {earlier.length === 0 ? 'First try' : `Try ${earlier.length + 1}`}
                {lastRejection?.reviewer_note ? (
                  <span className="sub">Last rejected: {lastRejection.reviewer_note}</span>
                ) : null}
              </dd>
            </div>
          </dl>

          {open ? (
            <div className="vdecide">
              <ul className="vcheck">
                <li>The selfie is the same person as the photo on the ID</li>
                <li>
                  The name on the ID matches <strong>{row.legal_name}</strong>
                </li>
                <li>The ID is not expired, and nothing is covered or edited</li>
              </ul>

              <form action={decide}>
                <input type="hidden" name="id" value={row.id} />
                <input type="hidden" name="profileId" value={row.profile_id} />
                <input type="hidden" name="name" value={name} />
                <input type="hidden" name="back" value={back} />
                <input type="hidden" name="next" value="approved" />
                <button className="btn primary" type="submit">
                  Approve and give the badge
                </button>
              </form>

              <form action={decide}>
                <input type="hidden" name="id" value={row.id} />
                <input type="hidden" name="profileId" value={row.profile_id} />
                <input type="hidden" name="name" value={name} />
                <input type="hidden" name="back" value={back} />
                <input type="hidden" name="next" value="rejected" />
                <select name="reason" defaultValue="" aria-label="Reason for rejecting">
                  <option value="" disabled>
                    Reason for rejecting…
                  </option>
                  {REJECT_REASONS.map((reason) => (
                    <option key={reason.value} value={reason.value}>
                      {reason.label}
                    </option>
                  ))}
                </select>
                <input type="text" name="note" placeholder="Add a note (optional)" aria-label="Extra note" />
                <button className="btn danger" type="submit">
                  Reject
                </button>
              </form>
              <p className="vhint">They see the reason in the app, word for word.</p>
            </div>
          ) : (
            <div className="vdecide">
              <div>
                <Badge value={row.status} /> <span className="mono">{when(row.reviewed_at)}</span>
              </div>
              {row.reviewer_note ? <p className="vhint">“{row.reviewer_note}”</p> : null}

              {row.status === 'approved' ? (
                <details>
                  <summary className="vhint">Take the badge away</summary>
                  <form action={decide} style={{ marginTop: 8 }}>
                    <input type="hidden" name="id" value={row.id} />
                    <input type="hidden" name="profileId" value={row.profile_id} />
                    <input type="hidden" name="name" value={name} />
                    <input type="hidden" name="back" value={back} />
                    <input type="hidden" name="next" value="rejected" />
                    <input type="hidden" name="reason" value="other" />
                    <input type="text" name="note" placeholder="Why (they will see this)" aria-label="Why" required />
                    <button className="btn danger" type="submit">
                      Revoke
                    </button>
                  </form>
                </details>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
