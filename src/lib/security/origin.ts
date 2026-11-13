import type { NextRequest } from 'next/server';

/**
 * CSRF defense for state-changing route handlers: the request must come from our own
 * origin. Browsers always send Origin on cross-site POSTs; we also accept Sec-Fetch-Site
 * same-origin. Server Actions have their own built-in origin check.
 */
export function assertSameOrigin(request: NextRequest): boolean {
  const expected = (process.env.APP_BASE_URL ?? request.nextUrl.origin).replace(/\/+$/, '');
  const origin = request.headers.get('origin');
  if (origin) return origin === expected || origin === request.nextUrl.origin;
  const site = request.headers.get('sec-fetch-site');
  return site === 'same-origin';
}
