import 'server-only';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { appEnv, clientSsoCredentials } from '@/lib/env';
import { loopbackOrigin } from '@/lib/graph/mock';
import { signValue, verifyValue } from '@/lib/security/signed-cookie';
import {
  type ClaimFailure,
  type SsoIdentity,
  type SsoProvider,
  checkIdTokenClaims,
  decodeJwtPayload,
} from './oidc-claims';
import { CLIENT_OAUTH_COOKIE } from './session-policy';
import { safeNextPath } from './routes';

/**
 * Client sign-in with Google or Microsoft: OpenID Connect authorization code flow with PKCE,
 * state and nonce, held in a short-lived signed cookie. The portal never sees a password;
 * the provider only tells us a verified email address, which must belong to an approved user.
 */

const OAUTH_TTL_MS = 10 * 60 * 1000;
const SCOPE = 'openid email profile';

const ENDPOINTS: Record<SsoProvider, { authorize: string; token: string }> = {
  google: {
    authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
  },
  microsoft: {
    // `common`: work or school accounts and personal Microsoft accounts.
    authorize: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    token: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
  },
};

/**
 * End-to-end tests point both providers at a local stand-in named by E2E_OAUTH_MOCK_URL.
 * Only a plain-http loopback address is accepted, so this can never send anything elsewhere.
 */
export function ssoEndpoints(
  provider: SsoProvider,
  env: Record<string, string | undefined> = process.env,
): { authorize: string; token: string } {
  const mock = loopbackOrigin(env.E2E_OAUTH_MOCK_URL);
  if (mock) {
    return {
      authorize: `${mock}/oauth/${provider}/authorize`,
      token: `${mock}/oauth/${provider}/token`,
    };
  }
  return ENDPOINTS[provider];
}

export function ssoCallbackPath(provider: SsoProvider): string {
  return `/api/auth/client/sso/${provider}/callback`;
}

function redirectUri(provider: SsoProvider): string {
  return `${appEnv().APP_BASE_URL}${ssoCallbackPath(provider)}`;
}

const stateSchema = z.object({
  v: z.literal(1),
  p: z.enum(['google', 'microsoft']),
  state: z.string().min(16),
  nonce: z.string().min(16),
  verifier: z.string().min(43),
  next: z.string().nullable(),
  iat: z.number().int(),
});

export function beginSsoSignIn(
  provider: SsoProvider,
  next: string | null,
): { url: string; cookie: string } | null {
  const creds = clientSsoCredentials(provider);
  if (!creds) return null;
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const state = randomBytes(24).toString('base64url');
  const nonce = randomBytes(24).toString('base64url');

  const url = new URL(ssoEndpoints(provider).authorize);
  url.search = new URLSearchParams({
    client_id: creds.clientId,
    redirect_uri: redirectUri(provider),
    response_type: 'code',
    scope: SCOPE,
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
    ...(provider === 'microsoft' ? { response_mode: 'query' } : {}),
  }).toString();

  const cookie = signValue(appEnv().AUTH_SECRET, CLIENT_OAUTH_COOKIE, {
    v: 1,
    p: provider,
    state,
    nonce,
    verifier,
    next: safeNextPath(next),
    iat: Date.now(),
  });
  return { url: url.toString(), cookie };
}

export type SsoFailure =
  | 'not_configured'
  | 'invalid_state'
  | 'cancelled'
  | 'provider_error'
  | 'token_error'
  | ClaimFailure;

export type SsoResult =
  { ok: true; identity: SsoIdentity; next: string | null } | { ok: false; reason: SsoFailure };

function sameString(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export async function completeSsoSignIn(
  provider: SsoProvider,
  params: URLSearchParams,
  cookie: string | undefined,
): Promise<SsoResult> {
  const creds = clientSsoCredentials(provider);
  if (!creds) return { ok: false, reason: 'not_configured' };

  const parsed = stateSchema.safeParse(
    verifyValue(appEnv().AUTH_SECRET, CLIENT_OAUTH_COOKIE, cookie),
  );
  const state = params.get('state') ?? '';
  if (
    !parsed.success ||
    parsed.data.p !== provider ||
    Date.now() - parsed.data.iat > OAUTH_TTL_MS ||
    !sameString(state, parsed.data.state)
  ) {
    return { ok: false, reason: 'invalid_state' };
  }
  const error = params.get('error');
  if (error) {
    return { ok: false, reason: error === 'access_denied' ? 'cancelled' : 'provider_error' };
  }
  const code = params.get('code');
  if (!code || code.length > 4096) return { ok: false, reason: 'provider_error' };

  let idToken: unknown;
  try {
    const res = await fetch(ssoEndpoints(provider).token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri(provider),
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        code_verifier: parsed.data.verifier,
      }),
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { ok: false, reason: 'token_error' };
    idToken = ((await res.json()) as { id_token?: unknown }).id_token;
  } catch {
    return { ok: false, reason: 'token_error' };
  }

  const check = checkIdTokenClaims(provider, decodeJwtPayload(idToken), {
    clientId: creds.clientId,
    nonce: parsed.data.nonce,
  });
  if (!check.ok) return check;
  return { ok: true, identity: check.identity, next: parsed.data.next };
}
