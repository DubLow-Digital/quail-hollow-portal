import 'server-only';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { ConfidentialClientApplication, CryptoProvider, ResponseMode } from '@azure/msal-node';
import { z } from 'zod';
import { adminAuthEnv, allowlistEnv, appEnv } from '@/lib/env';
import { signValue, verifyValue } from '@/lib/security/signed-cookie';
import { ADMIN_OAUTH_COOKIE } from './session-policy';
import { safeNextPath } from './routes';

/**
 * Admin sign-in with Microsoft Entra: OAuth 2.0 authorization code flow with PKCE, state
 * and nonce, via MSAL. The callback path matches the redirect URI in docs/entra-setup.md.
 */

export const ADMIN_CALLBACK_PATH = '/api/auth/callback/microsoft-entra-id';
const SCOPES = ['openid', 'profile', 'email', 'User.Read'];
const OAUTH_TTL_MS = 10 * 60 * 1000;

let msal: ConfidentialClientApplication | null = null;

function authorityTenant(): string {
  const env = adminAuthEnv();
  return env.MS_ADMIN_AUTHORITY_TENANT || env.MS_TENANT_ID;
}

function app(): ConfidentialClientApplication {
  if (!msal) {
    const env = adminAuthEnv();
    msal = new ConfidentialClientApplication({
      auth: {
        clientId: env.MS_ADMIN_CLIENT_ID,
        clientSecret: env.MS_ADMIN_CLIENT_SECRET,
        authority: `https://login.microsoftonline.com/${authorityTenant()}`,
      },
      system: {
        loggerOptions: { piiLoggingEnabled: false, logLevel: 0, loggerCallback: () => {} },
      },
    });
  }
  return msal;
}

function redirectUri(): string {
  return `${appEnv().APP_BASE_URL}${ADMIN_CALLBACK_PATH}`;
}

const oauthStateSchema = z.object({
  v: z.literal(1),
  state: z.string().min(16),
  nonce: z.string().min(16),
  verifier: z.string().min(43),
  next: z.string().nullable(),
  iat: z.number().int(),
});

export async function beginAdminSignIn(
  next: string | null,
): Promise<{ url: string; cookie: string }> {
  const { verifier, challenge } = await new CryptoProvider().generatePkceCodes();
  const state = randomBytes(24).toString('base64url');
  const nonce = randomBytes(24).toString('base64url');
  const url = await app().getAuthCodeUrl({
    scopes: SCOPES,
    redirectUri: redirectUri(),
    codeChallenge: challenge,
    codeChallengeMethod: 'S256',
    state,
    nonce,
    prompt: 'select_account',
    responseMode: ResponseMode.QUERY,
  });
  const cookie = signValue(appEnv().AUTH_SECRET, ADMIN_OAUTH_COOKIE, {
    v: 1,
    state,
    nonce,
    verifier,
    next: safeNextPath(next),
    iat: Date.now(),
  });
  return { url, cookie };
}

export type AdminSignInFailure =
  | 'invalid_state'
  | 'provider_error'
  | 'token_error'
  | 'wrong_tenant'
  | 'not_allowed'
  | 'missing_identity';

export interface AdminIdentity {
  email: string;
  name: string;
  oid: string;
  tid: string;
}

export type AdminSignInResult =
  | { ok: true; identity: AdminIdentity; next: string | null }
  | { ok: false; reason: AdminSignInFailure };

function sameString(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function allowedTenants(): string[] {
  const env = adminAuthEnv();
  const extra = (env.MS_ADMIN_ALLOWED_TENANTS ?? '')
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  return [env.MS_TENANT_ID.toLowerCase(), ...extra];
}

export function isAllowlisted(email: string): boolean {
  return allowlistEnv().ADMIN_ALLOWLIST.includes(email.trim().toLowerCase());
}

export async function completeAdminSignIn(
  params: URLSearchParams,
  oauthCookie: string | undefined,
): Promise<AdminSignInResult> {
  const raw = verifyValue(appEnv().AUTH_SECRET, ADMIN_OAUTH_COOKIE, oauthCookie);
  const parsed = oauthStateSchema.safeParse(raw);
  const state = params.get('state') ?? '';
  if (
    !parsed.success ||
    Date.now() - parsed.data.iat > OAUTH_TTL_MS ||
    !sameString(state, parsed.data.state)
  ) {
    return { ok: false, reason: 'invalid_state' };
  }
  if (params.get('error')) return { ok: false, reason: 'provider_error' };
  const code = params.get('code');
  if (!code) return { ok: false, reason: 'provider_error' };

  let claims: Record<string, unknown>;
  try {
    const result = await app().acquireTokenByCode({
      code,
      scopes: SCOPES,
      redirectUri: redirectUri(),
      codeVerifier: parsed.data.verifier,
      nonce: parsed.data.nonce,
      state: parsed.data.state,
    });
    claims = (result?.idTokenClaims ?? {}) as Record<string, unknown>;
  } catch {
    return { ok: false, reason: 'token_error' };
  }

  const tid = typeof claims.tid === 'string' ? claims.tid.toLowerCase() : '';
  const oid = typeof claims.oid === 'string' ? claims.oid : '';
  // preferred_username is the tenant-managed sign-in name. The `email` claim can be
  // unverified, so it is never used for authorization.
  const username = typeof claims.preferred_username === 'string' ? claims.preferred_username : '';
  const name = typeof claims.name === 'string' ? claims.name.slice(0, 200) : '';

  if (!tid || !oid || !username) return { ok: false, reason: 'missing_identity' };
  if (!allowedTenants().includes(tid)) return { ok: false, reason: 'wrong_tenant' };
  const email = username.toLowerCase();
  if (!isAllowlisted(email)) return { ok: false, reason: 'not_allowed' };

  return { ok: true, identity: { email, name: name || email, oid, tid }, next: parsed.data.next };
}
