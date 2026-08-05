import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'E Space Operations',
  description: 'Payouts, escrow, listings and users for E Space.',
};

/**
 * Applies the stored theme before the first paint.
 *
 * Has to run blocking in <head>: React sets the attribute only after
 * hydration, and the gap between those two moments is a full white flash on
 * every page load for anyone using dark mode.
 *
 * Wrapped in try/catch because localStorage throws outright when a browser is
 * set to block site data, and a theme preference is not worth a blank console.
 */
const APPLY_THEME = `
try {
  var t = localStorage.getItem('espace-console-theme');
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
} catch (e) {}
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: APPLY_THEME }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
