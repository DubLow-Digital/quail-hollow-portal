import { describe, expect, it } from 'vitest';
import {
  MSA_CONSUMER_TENANT,
  checkIdTokenClaims,
  decodeJwtPayload,
  isSsoProvider,
} from '@/lib/auth/oidc-claims';
import { passwordProblem } from '@/lib/auth/password-policy';
import { setupAllowed, classifyPath } from '@/lib/auth/routes';
import { checkClientSession, issueClientSession } from '@/lib/auth/session-policy';
import { signValue } from '@/lib/security/signed-cookie';
import {
  authenticationCredentialSchema,
  registrationCredentialSchema,
} from '@/lib/auth/webauthn-json';

const NOW = Date.UTC(2026, 10, 17, 12, 0, 0);
const S = Math.floor(NOW / 1000);
const CLIENT_ID = 'test-client-id';
const NONCE = 'nonce-0123456789abcdef';
const TENANT = '11111111-2222-4333-8444-555555555555';

function jwt(claims: Record<string, unknown>): string {
  const enc = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
  return `${enc({ alg: 'RS256' })}.${enc(claims)}.sig`;
}

const google = (over: Record<string, unknown> = {}) => ({
  iss: 'https://accounts.google.com',
  aud: CLIENT_ID,
  sub: '1234567890',
  email: 'Test.Client@Example.com',
  email_verified: true,
  nonce: NONCE,
  iat: S - 10,
  exp: S + 3600,
  name: 'Test Client',
  ...over,
});

const microsoft = (over: Record<string, unknown> = {}) => ({
  iss: `https://login.microsoftonline.com/${TENANT}/v2.0`,
  aud: CLIENT_ID,
  tid: TENANT,
  oid: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  sub: 'pairwise-subject',
  email: 'office.manager@example.com',
  xms_edov: true,
  nonce: NONCE,
  iat: S - 10,
  exp: S + 3600,
  ...over,
});

const expected = { clientId: CLIENT_ID, nonce: NONCE, now: NOW };

describe('ID token checks for client sign-in', () => {
  it('accepts a verified Google account and lowercases the email', () => {
    const r = checkIdTokenClaims('google', decodeJwtPayload(jwt(google())), expected);
    expect(r).toEqual({
      ok: true,
      identity: {
        provider: 'google',
        subject: '1234567890',
        email: 'test.client@example.com',
        name: 'Test Client',
      },
    });
  });

  it('refuses a Google account whose email Google has not verified', () => {
    expect(checkIdTokenClaims('google', google({ email_verified: false }), expected)).toEqual({
      ok: false,
      reason: 'email_unverified',
    });
  });

  it('checks issuer, audience, expiry and nonce', () => {
    const cases: [Record<string, unknown>, string][] = [
      [google({ iss: 'https://evil.example' }), 'bad_issuer'],
      [google({ aud: 'someone-else' }), 'bad_audience'],
      [google({ aud: [CLIENT_ID, 'x'], azp: 'x' }), 'bad_audience'],
      [google({ exp: S - 600 }), 'expired'],
      [google({ iat: S + 600 }), 'expired'],
      [google({ nonce: 'replayed' }), 'bad_nonce'],
      [google({ email: undefined }), 'no_email'],
      [google({ email: 'not-an-email' }), 'no_email'],
    ];
    for (const [claims, reason] of cases) {
      expect(checkIdTokenClaims('google', claims, expected)).toEqual({ ok: false, reason });
    }
  });

  it('accepts a Microsoft work account only when the email domain is verified (xms_edov)', () => {
    const ok = checkIdTokenClaims('microsoft', microsoft(), expected);
    expect(ok.ok && ok.identity.subject).toBe(`${TENANT}:aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee`);
    for (const edov of [false, undefined, 'false', 0]) {
      expect(checkIdTokenClaims('microsoft', microsoft({ xms_edov: edov }), expected)).toEqual({
        ok: false,
        reason: 'email_unverified',
      });
    }
  });

  it('accepts a personal Microsoft account without xms_edov', () => {
    const tid = MSA_CONSUMER_TENANT;
    const r = checkIdTokenClaims(
      'microsoft',
      microsoft({ tid, iss: `https://login.microsoftonline.com/${tid}/v2.0`, xms_edov: undefined }),
      expected,
    );
    expect(r.ok).toBe(true);
  });

  it('refuses a Microsoft token whose issuer does not match its tenant', () => {
    const other = '99999999-2222-4333-8444-555555555555';
    expect(
      checkIdTokenClaims(
        'microsoft',
        microsoft({ iss: `https://login.microsoftonline.com/${other}/v2.0` }),
        expected,
      ),
    ).toEqual({ ok: false, reason: 'bad_issuer' });
    expect(checkIdTokenClaims('microsoft', microsoft({ tid: 'common' }), expected)).toEqual({
      ok: false,
      reason: 'malformed',
    });
  });

  it('decodes only well-formed tokens', () => {
    expect(decodeJwtPayload('not.a')).toBeNull();
    expect(decodeJwtPayload(123)).toBeNull();
    expect(decodeJwtPayload('a.!!!.c')).toBeNull();
    expect(isSsoProvider('google')).toBe(true);
    expect(isSsoProvider('github')).toBe(false);
  });
});

describe('password rules', () => {
  it('wants a long password not built from the email or a common one', () => {
    expect(passwordProblem('short', 'pat@example.com')).toMatch(/12 characters/);
    expect(passwordProblem('aaaaaaaaaaaaaa', 'pat@example.com')).toMatch(/repeating/);
    expect(passwordProblem('Password1234', 'pat@example.com')).toMatch(/too common/);
    expect(passwordProblem('patexample-2026!', 'patexample@example.com')).toMatch(/email/);
    expect(passwordProblem('blue heron porch light', 'pat@example.com')).toBeNull();
  });
});

describe('setup-level sessions', () => {
  const SECRET = 'test-secret-that-is-long-enough-for-hmac-0123456789';
  const UID = '00000000-0000-4000-8000-0000000000a1';

  it('records the session level, and older cookies without one count as setup', () => {
    const full = checkClientSession(SECRET, issueClientSession(SECRET, UID, 'full', NOW), NOW);
    expect(full.ok && full.session.m).toBe('full');
    const setup = checkClientSession(SECRET, issueClientSession(SECRET, UID, 'setup', NOW), NOW);
    expect(setup.ok && setup.session.m).toBe('setup');
    const legacy = signValue(SECRET, 'qh_cs', { v: 1, uid: UID, iat: NOW, lat: NOW });
    const old = checkClientSession(SECRET, legacy, NOW);
    expect(old.ok && old.session.m).toBe('setup');
  });

  it('lets a setup session reach only the setup screen and its API', () => {
    expect(setupAllowed('/account/setup')).toBe(true);
    expect(setupAllowed('/api/auth/client/setup/totp/enroll')).toBe(true);
    expect(setupAllowed('/')).toBe(false);
    expect(setupAllowed('/request/abc')).toBe(false);
    expect(setupAllowed('/api/uploads/start')).toBe(false);
    expect(setupAllowed('/people')).toBe(false);
    expect(classifyPath('/account/setup')).toBe('client');
    expect(classifyPath('/people')).toBe('client');
    expect(classifyPath('/api/auth/client/setup/password')).toBe('client');
    expect(classifyPath('/api/auth/client/password')).toBe('public');
    expect(classifyPath('/api/auth/client/sso/google/callback')).toBe('public');
  });
});

describe('passkey response shapes', () => {
  it('accepts browser JSON and rejects junk', () => {
    const base = { id: 'abc_-', rawId: 'abc_-', type: 'public-key', clientExtensionResults: {} };
    expect(
      authenticationCredentialSchema.safeParse({
        ...base,
        response: { clientDataJSON: 'eyJ0', authenticatorData: 'AAAA', signature: 'MEUC' },
      }).success,
    ).toBe(true);
    expect(
      registrationCredentialSchema.safeParse({
        ...base,
        response: { clientDataJSON: 'eyJ0', attestationObject: 'o2Nm', transports: ['internal'] },
      }).success,
    ).toBe(true);
    expect(
      authenticationCredentialSchema.safeParse({
        ...base,
        type: 'password',
        response: { clientDataJSON: 'x', authenticatorData: 'y', signature: 'z' },
      }).success,
    ).toBe(false);
    expect(
      authenticationCredentialSchema.safeParse({
        ...base,
        response: { clientDataJSON: '<script>', authenticatorData: 'y', signature: 'z' },
      }).success,
    ).toBe(false);
  });
});

describe('Google and Microsoft sign-in start', () => {
  it('uses the real providers unless a loopback test stand-in is named', async () => {
    const { ssoEndpoints } = await import('@/lib/auth/client-oauth');
    expect(ssoEndpoints('google', {}).token).toBe('https://oauth2.googleapis.com/token');
    expect(ssoEndpoints('microsoft', {}).authorize).toBe(
      'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    );
    expect(ssoEndpoints('google', { E2E_OAUTH_MOCK_URL: 'http://127.0.0.1:4010' }).token).toBe(
      'http://127.0.0.1:4010/oauth/google/token',
    );
    for (const bad of ['https://127.0.0.1:4010', 'http://evil.example', 'http://10.0.0.1']) {
      expect(ssoEndpoints('google', { E2E_OAUTH_MOCK_URL: bad }).token).toBe(
        'https://oauth2.googleapis.com/token',
      );
    }
  });

  it('builds an authorization request with PKCE, state, nonce and the exact callback', async () => {
    const saved = { ...process.env };
    Object.assign(process.env, {
      APP_BASE_URL: 'https://portal.example.test',
      AUTH_SECRET: 'test-secret-that-is-long-enough-for-hmac-0123456789',
      GOOGLE_OAUTH_CLIENT_ID: 'gid',
      GOOGLE_OAUTH_CLIENT_SECRET: 'gsecret',
    });
    delete process.env.E2E_OAUTH_MOCK_URL;
    const { resetEnvCacheForTests } = await import('@/lib/env');
    resetEnvCacheForTests();
    try {
      const { beginSsoSignIn } = await import('@/lib/auth/client-oauth');
      const started = beginSsoSignIn('google', '/request/abc');
      expect(started).not.toBeNull();
      const url = new URL(started!.url);
      expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
      const p = url.searchParams;
      expect(p.get('client_id')).toBe('gid');
      expect(p.get('redirect_uri')).toBe(
        'https://portal.example.test/api/auth/client/sso/google/callback',
      );
      expect(p.get('response_type')).toBe('code');
      expect(p.get('scope')).toBe('openid email profile');
      expect(p.get('code_challenge_method')).toBe('S256');
      expect(p.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(p.get('state')!.length).toBeGreaterThanOrEqual(32);
      expect(p.get('nonce')!.length).toBeGreaterThanOrEqual(32);
      expect(started!.url).not.toContain('gsecret');
      expect(beginSsoSignIn('microsoft', null)).toBeNull(); // not configured
    } finally {
      process.env = saved;
      resetEnvCacheForTests();
    }
  });
});
