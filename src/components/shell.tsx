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
 * covered in errors is a console nobody reads errors on.
 *
 * That was replaced by a banner across the top of every page, which was
 * accurate and still wrong: a setup note repeated on every screen becomes part
 * of the furniture and gets read as decoration. What is left is the key state
 * in the sidebar -- one line, always in the same place, and green or not.
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
        {/* The mark carries the name, so the text beside it does not repeat it.
            aria-label because a masked span has no accessible content of its
            own -- to a screen reader it is an empty box otherwise. */}
        <div className="brand">
          <span className="brand-mark" role="img" aria-label="E Space" />
          <span className="brand-name">
            e space
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
        {children}
      </main>
    </div>
  );
}

