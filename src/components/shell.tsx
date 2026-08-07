'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ReactNode } from 'react';

import {
  IconAccounts,
  IconBookings,
  IconFinance,
  IconHealth,
  IconListings,
  IconMessages,
  IconOverview,
  IconPayouts,
  IconReports,
  IconRevenue,
  IconReviews,
  IconVerify,
} from './icons';
import { ThemeToggle } from './theme-toggle';

/**
 * Console shell.
 *
 * Grouped rather than listed flat, because the flat list had no shape:
 * verifications and payouts are work waiting on a person, listings and
 * accounts are things you go and look at, and messages and reviews are what
 * you read when deciding a dispute. A queue you must act on and a table you
 * merely consult deserve to be visibly different kinds of thing.
 *
 * Finance sat under Evidence, which it never was: it reports on money rather
 * than telling you what two people said to each other. It now sits with
 * Revenue, which is the screen that says how little of that money is ours.
 *
 * Needs attention comes first and stays first. The faults under Health are the
 * ones nothing else will ever tell you about -- the rest of the console looks
 * perfectly healthy while they are happening.
 *
 * Escrow release is not here and never will be: it belongs to the renter, in
 * the app. This console reports on money; it does not move it.
 */

const GROUPS = [
  {
    title: 'Needs attention',
    items: [
      { href: '/', label: 'Overview', Icon: IconOverview },
      { href: '/health', label: 'Health', Icon: IconHealth },
      { href: '/verifications', label: 'Verifications', Icon: IconVerify },
      { href: '/payouts', label: 'Payouts', Icon: IconPayouts },
      { href: '/reports', label: 'Reports', Icon: IconReports },
    ],
  },
  {
    title: 'Marketplace',
    items: [
      { href: '/accounts', label: 'Accounts', Icon: IconAccounts },
      { href: '/listings', label: 'Listings', Icon: IconListings },
      { href: '/bookings', label: 'Bookings', Icon: IconBookings },
    ],
  },
  {
    title: 'Money',
    items: [
      { href: '/finance', label: 'Finance', Icon: IconFinance },
      { href: '/revenue', label: 'Revenue', Icon: IconRevenue },
    ],
  },
  {
    title: 'Evidence',
    items: [
      { href: '/messages', label: 'Messages', Icon: IconMessages },
      { href: '/reviews', label: 'Reviews', Icon: IconReviews },
    ],
  },
] as const;

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
          <span className="brand-mark">e</span>
          <span className="brand-name">
            E Space
            <small>OPERATIONS</small>
          </span>
        </div>

        <nav className="nav">
          {GROUPS.map((group) => (
            <div className="nav-group" key={group.title}>
              <div className="nav-title">{group.title}</div>
              {group.items.map(({ href, label, Icon }) => {
                const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
                const count = badges?.[href] ?? 0;
                return (
                  <Link key={href} href={href} className={active ? 'active' : undefined}>
                    <Icon />
                    <span className="nav-label">{label}</span>
                    {/* Health counts faults, not chores. Red says the number
                        beside it is money at risk rather than a queue. */}
                    {count > 0 ? (
                      <span className={href === '/health' ? 'pill bad' : 'pill'}>{count}</span>
                    ) : null}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="sidebar-foot">
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

      <main className="main">{children}</main>
    </div>
  );
}
