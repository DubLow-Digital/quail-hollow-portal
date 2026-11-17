import type { NextConfig } from 'next';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// Sign-in page photo (the horse in the field), when added to public/brand.
const loginPhoto =
  ['login-photo.webp', 'login-photo.jpg']
    .map((f) => (existsSync(join(process.cwd(), 'public', 'brand', f)) ? `/brand/${f}` : ''))
    .find(Boolean) ?? '';

/**
 * Static security headers applied to every response. The Content-Security-Policy is
 * per-request (nonce based) and is set in `src/proxy.ts`.
 */
const securityHeaders = [
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  {
    key: 'Permissions-Policy',
    value:
      'camera=(self), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), browsing-topics=()',
  },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
  { key: 'X-Permitted-Cross-Domain-Policies', value: 'none' },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  env: { NEXT_PUBLIC_LOGIN_PHOTO: loginPhoto },
  reactStrictMode: true,
  serverExternalPackages: ['@azure/msal-node'],
  experimental: {
    serverActions: {
      // Server actions only carry small form payloads. File bytes never reach our server.
      bodySizeLimit: '256kb',
    },
  },
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      {
        source: '/api/:path*',
        headers: [{ key: 'Cache-Control', value: 'no-store, max-age=0' }],
      },
    ];
  },
};

export default nextConfig;
