import Link from 'next/link';

import { Shell } from '@/components/shell';
import { Metric, Notice, PageHead } from '@/components/ui';
import { requireAdmin } from '@/lib/auth';
import { runHealthChecks, type HealthCheck, type Severity } from '@/lib/health';
import { getOverview } from '@/lib/queries';

export const dynamic = 'force-dynamic';

const SEVERITY_LABEL: Record<Severity, string> = {
  critical: 'Money is at risk',
  high: 'Needs attention today',
  medium: 'Worth tidying',
};

const SEVERITY_TONE: Record<Severity, string> = {
  critical: 'red',
  high: 'amber',
  medium: 'grey',
};

function CheckCard({ check }: { check: HealthCheck }) {
  // Long lists are cut off rather than paged: the count is what decides how
  // urgent this is, and the examples only need to be enough to recognise it.
  const shown = check.items.slice(0, 12);
  const rest = check.items.length - shown.length;

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
        }}>
        <h3 style={{ margin: 0, fontSize: 15 }}>
          <span className={`badge ${SEVERITY_TONE[check.severity]}`} style={{ marginRight: 8 }}>
            {check.severity}
          </span>
          {check.title}
        </h3>
        <strong style={{ fontSize: 18 }}>{check.items.length}</strong>
      </div>

      <p style={{ margin: '10px 0 0', fontSize: 13, lineHeight: 1.55 }}>{check.detail}</p>

      <p style={{ margin: '8px 0 0', fontSize: 13, lineHeight: 1.55, opacity: 0.85 }}>
        <strong>What to do:</strong> {check.fix}
        {check.href ? (
          <>
            {' '}
            <Link href={check.href} style={{ textDecoration: 'underline', fontWeight: 700 }}>
              Open
            </Link>
          </>
        ) : null}
      </p>

      <ul style={{ margin: '12px 0 0', paddingLeft: 18, fontSize: 12.5, lineHeight: 1.7 }}>
        {shown.map((item) => (
          <li key={item.id}>
            {item.label}
            {item.meta ? <span className="dim"> — {item.meta}</span> : null}
          </li>
        ))}
        {rest > 0 ? <li className="dim">and {rest} more</li> : null}
      </ul>
    </div>
  );
}

export default async function HealthPage() {
  await requireAdmin();

  const { listings, bookings, payments, payouts, profiles, metrics, error } = await getOverview();

  const report = runHealthChecks({
    listings: listings.rows,
    bookings: bookings.rows,
    payments: payments.rows,
    payouts: payouts.rows,
    profiles: profiles.rows,
  });

  return (
    <Shell
      badges={{
        '/payouts': metrics.queuedPayoutCount,
        '/accounts': metrics.unverifiedCount,
        '/health': report.failing.length,
      }}>
      <PageHead
        title="Health"
        description="Faults that report nothing. Every one of these keeps the app working normally while quietly breaking who gets paid, or who gets the home."
      />

      {error ? (
        <Notice tone="error" title="Could not read the database">
          {error}
        </Notice>
      ) : null}

      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <Metric
          label="Failing checks"
          value={report.failing.length}
          hint={`of ${report.checks.length} run`}
        />
        <Metric label="Money at risk" value={report.counts.critical} hint="critical" />
        <Metric label="Needs attention" value={report.counts.high} hint="high" />
        <Metric label="Records affected" value={report.affected} hint="rows across all checks" />
      </div>

      {report.failing.length === 0 ? (
        <Notice tone="info" title="Everything reconciles">
          Every home has an owner, every booking has a host, every payment has a payee, and no two
          bookings claim the same nights.
        </Notice>
      ) : (
        (['critical', 'high', 'medium'] as Severity[]).map((severity) => {
          const group = report.failing.filter((check) => check.severity === severity);
          if (group.length === 0) return null;

          return (
            <section key={severity} style={{ marginBottom: 22 }}>
              <h2 style={{ fontSize: 14, margin: '0 0 10px', textTransform: 'uppercase', letterSpacing: 0.6 }}>
                {SEVERITY_LABEL[severity]}
              </h2>
              {group.map((check) => (
                <CheckCard key={check.id} check={check} />
              ))}
            </section>
          );
        })
      )}

      <section style={{ marginTop: 26 }}>
        <h2 style={{ fontSize: 14, margin: '0 0 10px', textTransform: 'uppercase', letterSpacing: 0.6 }}>
          Passing
        </h2>
        <div className="card">
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.9 }}>
            {report.checks
              .filter((check) => check.items.length === 0)
              .map((check) => (
                <li key={check.id}>{check.title}</li>
              ))}
          </ul>
        </div>
      </section>
    </Shell>
  );
}
