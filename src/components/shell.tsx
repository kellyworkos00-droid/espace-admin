'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ReactNode } from 'react';

const NAV = [
  { href: '/', label: 'Overview' },
  { href: '/payouts', label: 'Payouts' },
  { href: '/payments', label: 'Escrow' },
  { href: '/bookings', label: 'Bookings' },
  { href: '/listings', label: 'Listings' },
  { href: '/users', label: 'Users' },
] as const;

/**
 * Console shell.
 *
 * Payouts sit second, directly under Overview, because they are the only queue
 * where money waits on a human. Everything below is oversight; that one is
 * work.
 */
export function Shell({
  children,
  badges,
}: {
  children: ReactNode;
  /** Counts of things needing attention, keyed by href. */
  badges?: Record<string, number>;
}) {
  const pathname = usePathname();

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          E <span>Space</span>
          <small>OPERATIONS</small>
        </div>

        <nav className="nav">
          {NAV.map((item) => {
            const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
            const count = badges?.[item.href] ?? 0;
            return (
              <Link key={item.href} href={item.href} className={active ? 'active' : undefined}>
                <span>{item.label}</span>
                {count > 0 ? <span className="pill">{count}</span> : null}
              </Link>
            );
          })}
        </nav>

        <form action="/api/logout" method="post">
          <button className="btn ghost" style={{ width: '100%' }} type="submit">
            Sign out
          </button>
        </form>
      </aside>

      <main className="main">{children}</main>
    </div>
  );
}
