import { describe, expect, it } from 'vitest';
import {
  buildContentSecurityPolicy,
  generateNonce,
  sharePointConnectSource,
} from '@/lib/security/csp';
import { keyedHash, signValue, verifyValue } from '@/lib/security/signed-cookie';
import { classifyPath, safeNextPath } from '@/lib/auth/routes';

const SECRET = 'test-secret-that-is-long-enough-for-hmac-0123456789';

describe('content security policy', () => {
  it('builds a strict production policy', () => {
    const nonce = generateNonce();
    const csp = buildContentSecurityPolicy({
      nonce,
      isDev: false,
      sharePointHost: 'example.sharepoint.com',
    });
    expect(csp).toContain(`script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`);
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).not.toContain('unsafe-inline');
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("connect-src 'self' https://example.sharepoint.com");
    expect(csp).toContain('upgrade-insecure-requests');
  });

  it('only relaxes for development', () => {
    const csp = buildContentSecurityPolicy({ nonce: generateNonce(), isDev: true });
    expect(csp).toContain("'unsafe-eval'");
    expect(csp).not.toContain('upgrade-insecure-requests');
  });

  it('falls back to the SharePoint wildcard for unset or invalid hosts', () => {
    expect(sharePointConnectSource(undefined)).toBe('https://*.sharepoint.com');
    expect(sharePointConnectSource('evil.example.com')).toBe('https://*.sharepoint.com');
    expect(sharePointConnectSource('x.sharepoint.com; script-src *')).toBe(
      'https://*.sharepoint.com',
    );
    expect(sharePointConnectSource('Contoso.SharePoint.com')).toBe(
      'https://contoso.sharepoint.com',
    );
  });

  it('rejects malformed nonces', () => {
    expect(() =>
      buildContentSecurityPolicy({ nonce: "abc'; script-src *", isDev: false }),
    ).toThrow();
  });

  it('generates unique nonces', () => {
    const set = new Set(Array.from({ length: 50 }, generateNonce));
    expect(set.size).toBe(50);
  });
});

describe('signed values', () => {
  it('round-trips a payload', () => {
    const value = signValue(SECRET, 'cookie_a', { a: 1 });
    expect(verifyValue(SECRET, 'cookie_a', value)).toEqual({ a: 1 });
  });

  it('rejects tampering, wrong secret and cookie swapping', () => {
    const value = signValue(SECRET, 'cookie_a', { role: 'client' });
    const [body, mac] = value.split('.');
    const forged = Buffer.from(JSON.stringify({ role: 'admin' })).toString('base64url');
    expect(verifyValue(SECRET, 'cookie_a', `${forged}.${mac}`)).toBeNull();
    expect(verifyValue(`${SECRET}x`, 'cookie_a', value)).toBeNull();
    expect(verifyValue(SECRET, 'cookie_b', value)).toBeNull();
    expect(verifyValue(SECRET, 'cookie_a', `${body}`)).toBeNull();
    expect(verifyValue(SECRET, 'cookie_a', undefined)).toBeNull();
    expect(verifyValue(SECRET, 'cookie_a', 'a.b.c')).toBeNull();
  });

  it('refuses short secrets', () => {
    expect(() => signValue('short', 'c', {})).toThrow();
  });

  it('produces stable keyed hashes that do not reveal the input', () => {
    const h1 = keyedHash(SECRET, 'email', 'test.client@example.test');
    expect(h1).toBe(keyedHash(SECRET, 'email', 'test.client@example.test'));
    expect(h1).not.toContain('example');
    expect(h1).not.toBe(keyedHash(SECRET, 'ip', 'test.client@example.test'));
  });
});

describe('route classification', () => {
  it.each([
    ['/', 'client'],
    ['/request/abc', 'client'],
    ['/api/uploads/start', 'client'],
    ['/login', 'public'],
    ['/api/auth/otp/request', 'public'],
    ['/admin', 'admin'],
    ['/admin/clients/1', 'admin'],
    ['/api/admin/folders', 'admin'],
    ['/admin/signin', 'public'],
    ['/adminx', 'public'],
    ['/api/auth/callback/microsoft-entra-id', 'public'],
  ])('%s is %s', (path, area) => {
    expect(classifyPath(path)).toBe(area);
  });

  it('only allows safe relative redirect targets', () => {
    expect(safeNextPath('/request/123')).toBe('/request/123');
    expect(safeNextPath('//evil.example')).toBeNull();
    expect(safeNextPath('/\\evil.example')).toBeNull();
    expect(safeNextPath('https://evil.example')).toBeNull();
    expect(safeNextPath('/api/uploads/start')).toBeNull();
    expect(safeNextPath('/x\u0000y')).toBeNull();
    expect(safeNextPath(null)).toBeNull();
  });
});
