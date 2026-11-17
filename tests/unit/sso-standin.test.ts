import { spawn, type ChildProcess } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Runs the portal's real Google / Microsoft sign-in code against the end-to-end stand-in
// (e2e-full/mock-graph.mjs): authorization request, redirect back, code exchange with the
// client secret and PKCE verifier, and the ID token checks.
const PORT = 4792;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const CREDS = {
  GOOGLE_OAUTH_CLIENT_ID: 'unit-google',
  GOOGLE_OAUTH_CLIENT_SECRET: 'unit-google-secret',
  MS_CLIENT_SIGNIN_CLIENT_ID: 'unit-microsoft',
  MS_CLIENT_SIGNIN_CLIENT_SECRET: 'unit-microsoft-secret',
};
const WORK_TENANT = '11111111-2222-4333-8444-555555555555';
let server: ChildProcess;
const saved = { ...process.env };

beforeAll(async () => {
  Object.assign(process.env, CREDS, {
    APP_BASE_URL: 'http://localhost:3999',
    AUTH_SECRET: 'unit-test-secret-that-is-long-enough-0123456789',
    E2E_OAUTH_MOCK_URL: ORIGIN,
  });
  const { resetEnvCacheForTests } = await import('@/lib/env');
  resetEnvCacheForTests();
  server = spawn(process.execPath, ['e2e-full/mock-graph.mjs'], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'ignore',
  });
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`${ORIGIN}/__test/health`)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('stand-in did not start');
});

afterAll(async () => {
  server?.kill();
  process.env = saved;
  const { resetEnvCacheForTests } = await import('@/lib/env');
  resetEnvCacheForTests();
});

async function signIn(provider: 'google' | 'microsoft', claims: Record<string, unknown> | null) {
  await fetch(`${ORIGIN}/__test/oauth-identity`, {
    method: 'POST',
    body: JSON.stringify({ provider, claims }),
  });
  const { beginSsoSignIn, completeSsoSignIn } = await import('@/lib/auth/client-oauth');
  const started = beginSsoSignIn(provider, '/people')!;
  const res = await fetch(started.url, { redirect: 'manual' });
  expect(res.status).toBe(302);
  const back = new URL(res.headers.get('location')!);
  expect(back.origin + back.pathname).toBe(
    `http://localhost:3999/api/auth/client/sso/${provider}/callback`,
  );
  return { back, cookie: started.cookie, completeSsoSignIn };
}

describe('client sign-in against the stand-in', () => {
  it('Google: a verified email comes back as the identity, with the saved next page', async () => {
    const { back, cookie, completeSsoSignIn } = await signIn('google', {
      email: 'Office.Manager@Example.com',
      email_verified: true,
      name: 'Office Manager',
    });
    expect(await completeSsoSignIn('google', back.searchParams, cookie)).toEqual({
      ok: true,
      identity: {
        provider: 'google',
        subject: 'g-Office.Manager@Example.com',
        email: 'office.manager@example.com',
        name: 'Office Manager',
      },
      next: '/people',
    });
  });

  it('Microsoft work account: refused unless the email domain is verified', async () => {
    const ok = await signIn('microsoft', {
      email: 'owner@example.com',
      tid: WORK_TENANT,
      xms_edov: true,
    });
    const good = await ok.completeSsoSignIn('microsoft', ok.back.searchParams, ok.cookie);
    expect(good.ok && good.identity.email).toBe('owner@example.com');

    const bad = await signIn('microsoft', { email: 'owner@example.com', tid: WORK_TENANT });
    expect(await bad.completeSsoSignIn('microsoft', bad.back.searchParams, bad.cookie)).toEqual({
      ok: false,
      reason: 'email_unverified',
    });
  });

  it('a tampered state, a replayed code or another provider is refused', async () => {
    const run = await signIn('google', { email: 'a@example.com', email_verified: true });
    const params = new URLSearchParams(run.back.searchParams);
    params.set('state', 'x'.repeat(32));
    expect(await run.completeSsoSignIn('google', params, run.cookie)).toEqual({
      ok: false,
      reason: 'invalid_state',
    });
    // The same code a second time: the stand-in (like Google) refuses it.
    const first = await run.completeSsoSignIn('google', run.back.searchParams, run.cookie);
    expect(first.ok).toBe(true);
    expect(await run.completeSsoSignIn('google', run.back.searchParams, run.cookie)).toEqual({
      ok: false,
      reason: 'token_error',
    });
    expect(await run.completeSsoSignIn('microsoft', run.back.searchParams, run.cookie)).toEqual({
      ok: false,
      reason: 'invalid_state',
    });
  });

  it('cancelling at the provider is reported as cancelled', async () => {
    const run = await signIn('google', null);
    expect(run.back.searchParams.get('error')).toBe('access_denied');
    expect(await run.completeSsoSignIn('google', run.back.searchParams, run.cookie)).toEqual({
      ok: false,
      reason: 'cancelled',
    });
  });
});
