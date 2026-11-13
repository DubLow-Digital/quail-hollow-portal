/**
 * Content Security Policy builder.
 *
 * Pure function so it can be unit tested. The proxy generates a fresh nonce per
 * request; Next.js reads the nonce from the request CSP header and applies it to
 * framework scripts automatically.
 */

export interface CspOptions {
  nonce: string;
  isDev: boolean;
  /**
   * Host that serves Microsoft Graph upload session URLs (the SharePoint tenant host,
   * for example `contoso.sharepoint.com`). Browsers PUT file chunks straight to it.
   * When unset we allow any `*.sharepoint.com` host.
   */
  sharePointHost?: string | undefined;
}

const SHAREPOINT_HOST_PATTERN = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.sharepoint\.com$/i;

export function sharePointConnectSource(host: string | undefined): string {
  if (host && SHAREPOINT_HOST_PATTERN.test(host)) {
    return `https://${host.toLowerCase()}`;
  }
  return 'https://*.sharepoint.com';
}

export function buildContentSecurityPolicy({ nonce, isDev, sharePointHost }: CspOptions): string {
  if (!/^[A-Za-z0-9+/=_-]{16,}$/.test(nonce)) {
    throw new Error('CSP nonce must be a base64 string of at least 16 characters');
  }

  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': [
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      ...(isDev ? ["'unsafe-eval'"] : []),
    ],
    // Development tooling injects unhashed inline styles; production does not.
    'style-src': ["'self'", ...(isDev ? ["'unsafe-inline'"] : [`'nonce-${nonce}'`])],
    'img-src': ["'self'", 'blob:', 'data:'],
    'media-src': ["'self'", 'blob:'],
    'font-src': ["'self'"],
    'connect-src': ["'self'", sharePointConnectSource(sharePointHost), ...(isDev ? ['ws:'] : [])],
    'worker-src': ["'self'", 'blob:'],
    'manifest-src': ["'self'"],
    'object-src': ["'none'"],
    'base-uri': ["'none'"],
    'form-action': ["'self'"],
    'frame-src': ["'none'"],
    'frame-ancestors': ["'none'"],
  };

  const parts = Object.entries(directives).map(([name, values]) => `${name} ${values.join(' ')}`);
  if (!isDev) parts.push('upgrade-insecure-requests');
  return parts.join('; ');
}

/** 128-bit random nonce, base64 encoded. */
export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString('base64');
}
