import { ReactNode } from 'react';

/** Money is always rendered through here, so no screen invents its own format. */
export function kes(value: number | null | undefined) {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) return 'KES 0';
  return `KES ${Math.round(amount).toLocaleString()}`;
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
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.round(days / 30);
  return months < 12 ? `${months} months ago` : `${Math.floor(months / 12)}y ago`;
}

export function shortId(value: string | null | undefined, length = 8) {
  if (!value) return '—';
  return value.length > length ? `${value.slice(0, length)}…` : value;
}

type Tone = 'green' | 'amber' | 'red' | 'blue' | 'grey';

/**
 * Status vocabulary, in one place.
 *
 * Colour has to mean the same thing on every screen: green is settled, amber
 * needs a human, red is a problem. An operator scanning a queue reads the
 * colour before the word.
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
  requested: 'amber',
  // listings
  live: 'green',
  paused: 'grey',
  booked: 'blue',
  orphaned: 'red',
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
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div className="card metric">
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
      {title ? <strong>{title}</strong> : null}
      {children}
    </div>
  );
}

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
