/**
 * Route classification shared by the proxy and tests. Pure functions only.
 */

export type RouteArea = 'public' | 'client' | 'admin';

export function classifyPath(pathname: string): RouteArea {
  // Admin sign-in pages and the OAuth endpoints must stay reachable without a session.
  if (pathname === '/admin/signin' || pathname.startsWith('/admin/signin/')) return 'public';
  if (pathname === '/admin' || pathname.startsWith('/admin/')) return 'admin';
  if (pathname.startsWith('/api/admin/')) return 'admin';

  if (pathname === '/') return 'client';
  if (pathname === '/request' || pathname.startsWith('/request/')) return 'client';
  if (pathname.startsWith('/api/uploads/')) return 'client';

  return 'public';
}

/**
 * Only allow same-site relative paths as post-login redirect targets, to prevent open
 * redirects. Returns null when the value is not safe.
 */
export function safeNextPath(value: string | null | undefined): string | null {
  if (!value || typeof value !== 'string') return null;
  if (value.length > 512) return null;
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return null;
  if (/[\u0000-\u001f\\]/.test(value)) return null;
  if (value.startsWith('/api/')) return null;
  return value;
}
