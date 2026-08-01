'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ReactNode } from 'react';

const NAV = [
  { href: '/', label: 'Overview' },
  { href: '/accounts', label: 'Accounts' },
  { href: '/listings', label: 'Listings' },
  { href: '/bookings', label: 'Bookings' },
  { href: '/finance', label: 'Finance' },
  { href: '/payouts', label: 'Payouts' },
] as const;

/**
 * Console shell.
 *
 * Accounts sits second because verification is the console's main job: it
 * gates listing and payout in the app, and only a person can grant it.
 * Finance and Bookings are reporting -- escrow release belongs to the renter,
 * in the app, not to anyone here.
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
