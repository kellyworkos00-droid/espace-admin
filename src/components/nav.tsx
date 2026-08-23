'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import {
  IconAccounts,
  IconAcquisition,
  IconBookings,
  IconFinance,
  IconHealth,
  IconListings,
  IconMarketing,
  IconMessages,
  IconOverview,
  IconPayouts,
  IconRefunds,
  IconReports,
  IconRevenue,
  IconReviews,
  IconSupport,
  IconVerify,
} from './icons';

/**
 * The sidebar links, split out from Shell so Shell can be a server component.
 *
 * Only the active state needs the client, and it needed the whole shell to be
 * one -- which meant the shell could not read the server environment, and so
 * could not tell the console as a whole that it was running without a key.
 * Fifteen pages each discovered that separately and each said so in red.
 *
 * Grouped rather than listed flat, because the flat list had no shape:
 * verifications and payouts are work waiting on a person, listings and accounts
 * are things you go and look at, and messages and reviews are what you read
 * when deciding a dispute. A queue you must act on and a table you merely
 * consult deserve to be visibly different kinds of thing.
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
      // Above refunds: somebody who cannot use the app is stuck right now,
      // whereas a refund is a queue that can survive an hour.
      { href: '/support', label: 'Support', Icon: IconSupport },
      { href: '/refunds', label: 'Refunds', Icon: IconRefunds },
    ],
  },
  {
    title: 'Marketplace',
    items: [
      { href: '/accounts', label: 'Accounts', Icon: IconAccounts },
      { href: '/listings', label: 'Listings', Icon: IconListings },
      { href: '/bookings', label: 'Bookings', Icon: IconBookings },
      // Sits with the marketplace rather than under Evidence: this is a report
      // on where supply comes from, not a record of what somebody said.
      { href: '/acquisition', label: 'Acquisition', Icon: IconAcquisition },
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
      { href: '/marketing', label: 'Marketing', Icon: IconMarketing },
    ],
  },
] as const;

export function Nav({ badges }: { badges?: Record<string, number> }) {
  const pathname = usePathname();

  return (
    <nav className="nav">
      {GROUPS.map((group) => (
        <div className="nav-group" key={group.title}>
          <div className="nav-title">{group.title}</div>
          {group.items.map(({ href, label, Icon }) => {
            const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
            const count = badges?.[href] ?? 0;
            return (
              <Link
                key={href}
                href={href}
                className={active ? 'active' : undefined}
                aria-current={active ? 'page' : undefined}>
                <Icon />
                <span className="nav-label">{label}</span>
                {/* Health counts faults, not chores. Red says the number beside
                    it is money at risk rather than a queue. */}
                {count > 0 ? (
                  <span className={href === '/health' ? 'pill bad' : 'pill'}>{count}</span>
                ) : null}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
