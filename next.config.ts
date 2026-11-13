import type { NextConfig } from 'next';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// Use the real logo when it has been added to public/brand (see public/brand/README.md).
const brandLogo = existsSync(join(process.cwd(), 'public', 'brand', 'logo-horizontal.png'))
  ? '/brand/logo-horizontal.png'
  : '';

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
  env: { NEXT_PUBLIC_BRAND_LOGO: brandLogo },
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
