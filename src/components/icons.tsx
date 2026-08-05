/**
 * Line icons, drawn inline.
 *
 * Inline because a console behind a login should not wait on an icon font or a
 * sprite request to become readable, and because `currentColor` lets every one
 * of them inherit whatever the theme has decided the text colour is -- which is
 * the whole reason the dark theme needed no icon work at all.
 *
 * Stroke, not fill, so they sit at the same visual weight as the label beside
 * them rather than shouting over it.
 */

type IconProps = { className?: string };

function Svg({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}>
      {children}
    </svg>
  );
}

export function IconOverview(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </Svg>
  );
}

export function IconHealth(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3 12h4l2.5-6 4 12 2.5-6h5" />
    </Svg>
  );
}

export function IconVerify(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 3l7.5 3v5.5c0 4.5-3 8.3-7.5 9.5-4.5-1.2-7.5-5-7.5-9.5V6z" />
      <path d="M9 12l2 2 4-4" />
    </Svg>
  );
}

export function IconAccounts(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" />
      <path d="M16 5.2a3.2 3.2 0 010 5.6M18 14.8c2 .7 3 2.6 3 5.2" />
    </Svg>
  );
}

export function IconListings(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3 10.5L12 4l9 6.5" />
      <path d="M5.5 9.5V20h13V9.5" />
      <path d="M10 20v-5.5h4V20" />
    </Svg>
  );
}

export function IconBookings(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3.5" y="5" width="17" height="16" rx="2.5" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </Svg>
  );
}

export function IconFinance(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="2.5" y="6" width="19" height="13" rx="2.5" />
      <path d="M2.5 10.5h19" />
      <path d="M6.5 15h3" />
    </Svg>
  );
}

export function IconPayouts(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 21V4" />
      <path d="M6 10l6-6 6 6" />
      <path d="M4 21h16" />
    </Svg>
  );
}

export function IconMessages(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M20.5 12c0 4.1-3.8 7.4-8.5 7.4-1 0-2-.15-2.9-.42L4 20.5l1.6-3.9A7 7 0 013.5 12C3.5 7.9 7.3 4.6 12 4.6s8.5 3.3 8.5 7.4z" />
    </Svg>
  );
}

export function IconReviews(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 3.8l2.6 5.3 5.9.85-4.25 4.15 1 5.9L12 17.2l-5.25 2.8 1-5.9L3.5 9.95l5.9-.85z" />
    </Svg>
  );
}

export function IconRevenue(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 19V9M10 19V5M16 19v-7M22 19H2" />
    </Svg>
  );
}

export function IconSearch(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M15.5 15.5L21 21" />
    </Svg>
  );
}

export function IconSun(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2v2.5M12 19.5V22M4.2 4.2l1.8 1.8M18 18l1.8 1.8M2 12h2.5M19.5 12H22M4.2 19.8L6 18M18 6l1.8-1.8" />
    </Svg>
  );
}

export function IconMoon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M20 14.5A8.2 8.2 0 019.5 4 8.5 8.5 0 1020 14.5z" />
    </Svg>
  );
}

export function IconAlert(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M10.3 3.9L2.5 17.4A2 2 0 004.2 20.4h15.6a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" />
      <path d="M12 9v4.5M12 17h.01" />
    </Svg>
  );
}

export function IconInfo(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </Svg>
  );
}
