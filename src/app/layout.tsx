import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import localFont from 'next/font/local';
import './globals.css';

// Self-hosted (CSP font-src 'self'). Cinzel echoes the logo's Trajan-style wordmark.
const cinzel = localFont({
  src: [
    { path: './fonts/cinzel-latin-500-normal.woff2', weight: '500', style: 'normal' },
    { path: './fonts/cinzel-latin-600-normal.woff2', weight: '600', style: 'normal' },
  ],
  variable: '--font-cinzel',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'Quail Hollow Accounting Services | Secure Client Portal',
    template: '%s | Quail Hollow Accounting',
  },
  description: 'Securely send documents to Quail Hollow Accounting Services.',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#5b4734',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Reading request headers opts every route into dynamic rendering, which the
  // per-request CSP nonce requires.
  await headers();
  return (
    <html lang="en" className={cinzel.variable}>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
