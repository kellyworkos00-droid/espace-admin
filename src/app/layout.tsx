import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'E Space Operations',
  description: 'Payouts, escrow, listings and users for E Space.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
