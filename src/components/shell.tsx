import { ReactNode } from 'react';

import { Nav } from './nav';
import { ThemeToggle } from './theme-toggle';
import { hasServiceRole } from '@/lib/supabase';

/**
 * Console shell.
 *
 * A server component, which is the point: it can read the environment, so the
 * one fact that governs whether any page can see anything is established here
 * and stated once.
 *
 * Before this, every page discovered on its own that it could not read its
 * tables and said so in red. Fifteen red boxes, all of them the same missing
 * key, and none of them saying so -- which is worse than one, because a console
 * covered in errors is a console nobody reads errors on. Red has to keep
 * meaning "something is wrong here", and it cannot if it is also the colour of
 * an unfinished setup step.
 */
export function Shell({
  children,
  badges,
}: {
  children: ReactNode;
  /** Counts of things needing attention, keyed by href. */
  badges?: Record<string, number>;
}) {
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">e</span>
          <span className="brand-name">
            E Space
            <small>OPERATIONS</small>
          </span>
        </div>

        <Nav badges={badges} />

        <div className="sidebar-foot">
          {/* Which key the console is holding, always visible rather than
              discovered per page. Green is not decoration here: it is the
              difference between an empty table meaning "nothing happened" and
              meaning "you cannot see it". */}
          <div className={hasServiceRole ? 'keystate is-ok' : 'keystate is-limited'}>
            <span className="keystate-dot" />
            {hasServiceRole ? 'Full read access' : 'Limited: public key'}
          </div>

          <ThemeToggle />
          <form action="/api/logout" method="post">
            <button
              className="btn ghost"
              style={{ width: '100%', justifyContent: 'center' }}
              type="submit">
              Sign out
            </button>
          </form>
        </div>
      </aside>

      <main className="main">
        {!hasServiceRole ? <SetupBanner /> : null}
        {children}
      </main>
    </div>
  );
}

/**
 * Said once, at the top of every page, in the tone of an unfinished setup step
 * rather than a failure.
 *
 * Because that is what it is. Nothing is broken: a key has not been pasted in
 * yet, and until it is, Postgres answers a blocked SELECT with an empty array
 * rather than an error -- so pages show a clean, plausible "nothing here" that
 * is indistinguishable from the truth and wrong.
 */
function SetupBanner() {
  return (
    <div className="setup">
      <div className="setup-mark">1</div>
      <div className="setup-body">
        <strong>One key left to paste, and then this console can see everything.</strong>
        <p>
          It is authenticating with the publishable key — the same one inside the app — so
          row-level security hides most tables from it. Empty tables and load errors below are
          that, not missing data.
        </p>
        <p className="setup-how">
          Supabase → Project Settings → API keys → copy the <strong>secret</strong> key, then set{' '}
          <code>SUPABASE_SERVICE_ROLE_KEY</code> in <code>espace-admin/.env.local</code> and
          restart. It is server-side only and never reaches a browser.
        </p>
      </div>
    </div>
  );
}
