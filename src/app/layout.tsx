import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Quail Hollow Accounting | Secure Client Portal',
    template: '%s | Quail Hollow Accounting',
  },
  description: 'Securely send documents to Quail Hollow Accounting Services.',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#1f4d3a',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Reading request headers opts every route into dynamic rendering, which the
  // per-request CSP nonce requires.
  await headers();
  return (
    <html lang="en">
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
