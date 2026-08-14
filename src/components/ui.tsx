import { ReactNode } from 'react';

import { IconAlert, IconInfo } from './icons';

/**
 * Money is always rendered through here, so no screen invents its own format.
 *
 * The locale is named rather than left to the environment. `toLocaleString()`
 * with no argument follows whatever locale the process happens to be in, and
 * these pages are rendered on a server -- so the same figure could come back
 * grouped as 28,000 in one place and 28.000 in another, with nobody able to see
 * which from the screen. A number nobody can be sure how to read is worse in an
 * accounts console than in most places.
 */
export function kes(value: number | null | undefined) {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) return 'KES 0';
  return `KES ${Math.round(amount).toLocaleString('en-KE')}`;
}

export function when(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-KE', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function ago(value: string | null | undefined) {
  if (!value) return '—';
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return '—';
  const days = Math.floor((Date.now() - then) / 86_400_000);
  // A date ahead of now used to read "today", which is how a check-in three
  // weeks away looked like something that had already happened. Said plainly
  // instead: this helper is used on future dates as well as past ones.
  if (days < 0) {
    const ahead = Math.abs(days);
    if (ahead === 1) return 'tomorrow';
    return ahead < 30 ? `in ${ahead} days` : `in ${Math.round(ahead / 30)} months`;
  }
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.round(days / 30);
  return months < 12 ? `${months} months ago` : `${Math.floor(months / 12)}y ago`;
}

export function shortId(value: string | null | undefined, length = 8) {
  if (!value) return '—';
  return value.length > length ? `${value.slice(0, length)}…` : value;
}

/* ---------------------------------------------------------------- people --
 *
 * The console used to print `shortId(profile_id)` wherever a person belonged:
 * a truncated uuid, in a monospace font, in the column headed "Host". Nobody
 * can act on that. Answering "did Mary's payout go out?" meant copying a hash
 * out of one table and searching for it in another.
 *
 * Every page already loads the full profiles table for its own metrics, so the
 * name was in memory the whole time and simply never joined. That is what this
 * index does.
 */

export type Person = {
  id: string;
  name: string | null;
  email: string | null;
};

export type PersonIndex = Map<string, Person>;

export function personIndex(
  profiles: { id: string; full_name: string | null; email: string | null }[]
): PersonIndex {
  return new Map(
    profiles.map((row) => [row.id, { id: row.id, name: row.full_name, email: row.email }])
  );
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * A person, named.
 *
 * Falls back to the id rather than inventing a label, and says plainly when
 * there is no profile behind the reference -- an unattributed payment or an
 * ownerless listing is a real fault, and reading "Unknown account" is how an
 * operator finds out about it.
 */
export function PersonCell({
  id,
  people,
  sub,
}: {
  id: string | null | undefined;
  people: PersonIndex;
  /** Second line, where the row has something more useful than the email. */
  sub?: ReactNode;
}) {
  if (!id) {
    return (
      <div className="person">
        <span className="avatar unknown">—</span>
        <div className="person-lines">
          <div className="person-name unknown">No account</div>
          {sub ? <div className="person-sub">{sub}</div> : null}
        </div>
      </div>
    );
  }

  const person = people.get(id);
  const name = person?.name?.trim();
  const secondary = sub ?? person?.email ?? shortId(id, 12);

  return (
    <div className="person">
      <span className={name ? 'avatar' : 'avatar unknown'}>{name ? initials(name) : '?'}</span>
      <div className="person-lines">
        <div className={name ? 'person-name' : 'person-name unknown'}>
          {name ?? (person ? 'Unnamed account' : 'Unknown account')}
        </div>
        <div className="person-sub">{secondary}</div>
      </div>
    </div>
  );
}

/** The searchable text for a person, so a row can be found by name or email. */
export function personSearch(id: string | null | undefined, people: PersonIndex) {
  if (!id) return '';
  const person = people.get(id);
  return [id, person?.name, person?.email].filter(Boolean).join(' ');
}

/* --------------------------------------------------------------- status -- */

type Tone = 'green' | 'amber' | 'red' | 'blue' | 'grey';

/**
 * Status vocabulary, in one place.
 *
 * Colour has to mean the same thing on every screen: green is settled, blue is
 * in flight, amber needs a human, red is a problem. An operator scanning a
 * queue reads the colour before the word.
 */
const TONES: Record<string, Tone> = {
  // payments / escrow
  released: 'green',
  held: 'blue',
  pending: 'amber',
  refunded: 'grey',
  failed: 'red',
  // payouts
  paid: 'green',
  processing: 'blue',
  cancelled: 'grey',
  // bookings
  confirmed: 'green',
  upcoming: 'blue',
  completed: 'green',
  declined: 'red',
  rejected: 'red',
  requested: 'amber',
  // listings
  live: 'green',
  paused: 'grey',
  booked: 'blue',
  orphaned: 'red',
  // verifications
  approved: 'green',
  submitted: 'amber',
};

export function Badge({ value, tone }: { value: string | null | undefined; tone?: Tone }) {
  const label = (value ?? 'unknown').toString();
  const resolved = tone ?? TONES[label.toLowerCase()] ?? 'grey';
  return <span className={`badge ${resolved}`}>{label.replace(/_/g, ' ')}</span>;
}

export function Metric({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  /** Draws the stripe. Only pass one where the state genuinely means something. */
  tone?: 'good' | 'info' | 'warn' | 'bad';
}) {
  return (
    <div className={tone ? `card metric is-${tone}` : 'card metric'}>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {hint ? <div className="hint">{hint}</div> : null}
    </div>
  );
}

export function PageHead({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function SectionTitle({ children, count }: { children: ReactNode; count?: number }) {
  return (
    <h2 className="section-title">
      {children}
      {typeof count === 'number' ? <span className="count">{count}</span> : null}
    </h2>
  );
}

/**
 * Does this failure just mean "no key yet"?
 *
 * PostgREST reports a blocked read as 401/403, or as one of Postgres's own
 * permission codes. When the console is holding the publishable key, every
 * protected table answers that way at once -- so the message is true, useless,
 * and repeated on a dozen pages.
 */
function isPermissionShaped(error: string) {
  return /\b(401|403)\b|PGRST301|PGRST302|42501|permission denied|JWT/i.test(error);
}

/**
 * A page saying it could not read its own table.
 *
 * Silent when the shell has already given the reason. Red has to keep meaning
 * "something is wrong here", and it cannot if it is also the colour of a setup
 * step that has not been done yet -- a console covered in red is a console
 * where nobody reads the red.
 *
 * Everything else still shows in full. A table that is genuinely missing, or a
 * query that is genuinely malformed, is exactly what this is for.
 */
export function LoadError({
  error,
  what,
  hint,
  keyed = true,
}: {
  error: string | null | undefined;
  /** What could not be read, in the words on the page. */
  what: string;
  /** Anything worth adding when the cause is not the key. */
  hint?: ReactNode;
  /** Whether the console currently holds the service key. */
  keyed?: boolean;
}) {
  if (!error) return null;
  if (!keyed && isPermissionShaped(error)) return null;

  return (
    <Notice tone="error" title={`Could not load ${what}`}>
      {error}
      {hint ? <div style={{ fontWeight: 600, marginTop: 6 }}>{hint}</div> : null}
    </Notice>
  );
}

export function Notice({
  tone = 'info',
  title,
  children,
}: {
  tone?: 'warn' | 'error' | 'info';
  title?: string;
  children: ReactNode;
}) {
  return (
    <div className={`notice ${tone}`}>
      {tone === 'info' ? <IconInfo /> : <IconAlert />}
      <div className="notice-body">
        {title ? <strong>{title}</strong> : null}
        {children}
      </div>
    </div>
  );
}

/** Ratings, shown as the stars they were given as. */
export function Stars({ value }: { value: number | null | undefined }) {
  const filled = Math.max(0, Math.min(5, Math.round(Number(value ?? 0))));
  return (
    // Labelled once on the group rather than starred five times: a screen
    // reader should hear "4 out of 5", not five separate icons.
    <span className="stars" role="img" aria-label={`${filled} out of 5`}>
      {[1, 2, 3, 4, 5].map((position) => (
        <svg
          key={position}
          viewBox="0 0 24 24"
          aria-hidden="true"
          className={position <= filled ? undefined : 'off'}>
          <path
            fill="currentColor"
            d="M12 3.8l2.6 5.3 5.9.85-4.25 4.15 1 5.9L12 17.2l-5.25 2.8 1-5.9L3.5 9.95l5.9-.85z"
          />
        </svg>
      ))}
    </span>
  );
}

/**
 * A plain table, for the short fixed panels that would be worse with a search
 * box above them. Anything a person needs to find a row in uses DataTable.
 */
export function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="table-wrap">
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {head.map((column) => (
                <th key={column}>{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      </div>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <tr>
      <td colSpan={99}>
        <div className="empty">{children}</div>
      </td>
    </tr>
  );
}
