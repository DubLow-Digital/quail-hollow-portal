/**
 * Shared helpers for the one-off Graph setup scripts. These run on Todd's machine, not in
 * the app, so they are self-contained (no app imports). They never print tokens or secrets.
 */
import { ConfidentialClientApplication, PublicClientApplication } from '@azure/msal-node';

export const GRAPH = 'https://graph.microsoft.com/v1.0';
const SCOPE_DEFAULT = ['https://graph.microsoft.com/.default'];

// Microsoft Graph Command Line Tools (first-party public client used by Graph PowerShell).
const GRAPH_CLI_CLIENT_ID = '14d82eec-204b-4c2f-b7e8-296a70dab67e';

export function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`Missing environment variable ${name}. Add it to .env.local or export it.`);
    process.exit(2);
  }
  return value;
}

export function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1) return undefined;
  const value = process.argv[idx + 1];
  return value && !value.startsWith('--') ? value : '';
}

export function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

export async function clientCredentialsToken(
  tenantId: string,
  clientId: string,
  clientSecret: string,
) {
  const app = new ConfidentialClientApplication({
    auth: { clientId, clientSecret, authority: `https://login.microsoftonline.com/${tenantId}` },
  });
  const result = await app.acquireTokenByClientCredential({ scopes: SCOPE_DEFAULT });
  if (!result?.accessToken) throw new Error('Could not acquire an app token');
  return result.accessToken;
}

/** Interactive device-code sign-in for a Global Admin, requesting Sites.FullControl.All. */
export async function deviceCodeToken(tenantId: string) {
  const app = new PublicClientApplication({
    auth: {
      clientId: GRAPH_CLI_CLIENT_ID,
      authority: `https://login.microsoftonline.com/${tenantId}`,
    },
  });
  const result = await app.acquireTokenByDeviceCode({
    scopes: ['https://graph.microsoft.com/Sites.FullControl.All'],
    deviceCodeCallback: (response) => console.log(`\n${response.message}\n`),
  });
  if (!result?.accessToken) throw new Error('Device code sign-in did not return a token');
  return result.accessToken;
}

export interface GraphResult<T> {
  status: number;
  ok: boolean;
  data: T | null;
  errorCode: string | null;
}

export async function graph<T>(
  token: string,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<GraphResult<T>> {
  const res = await fetch(path.startsWith('https://') ? path : `${GRAPH}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  let data: unknown = null;
  if (res.status !== 204) {
    try {
      data = await res.json();
    } catch {
      data = null;
    }
  }
  const errorCode = res.ok
    ? null
    : ((data as { error?: { code?: string } } | null)?.error?.code ?? 'unknown');
  return { status: res.status, ok: res.ok, data: res.ok ? (data as T) : null, errorCode };
}

/** Reads the app roles from an access token without verifying it (local diagnostics only). */
export function tokenRoles(token: string): string[] {
  const payload = token.split('.')[1];
  if (!payload) return [];
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      roles?: string[];
    };
    return claims.roles ?? [];
  } catch {
    return [];
  }
}

/** Accepts either a full site ID or "hostname:/sites/path" and returns the site ID. */
export async function resolveSiteId(token: string, siteRef: string): Promise<string> {
  if (/^[^,]+,[0-9a-f-]{36},[0-9a-f-]{36}$/i.test(siteRef)) return siteRef;
  const match = /^([a-z0-9.-]+\.sharepoint\.com):?(\/sites\/[^?#]+)$/i.exec(siteRef);
  if (!match) throw new Error('Site must be a site ID or "contoso.sharepoint.com:/sites/SitePath"');
  const res = await graph<{ id: string; displayName: string; webUrl: string }>(
    token,
    `/sites/${match[1]}:${match[2]}`,
  );
  if (!res.ok || !res.data)
    throw new Error(`Could not resolve the site (${res.status} ${res.errorCode})`);
  console.log(`Site: ${res.data.displayName} (${res.data.webUrl})`);
  return res.data.id;
}

export function pass(message: string) {
  console.log(`  PASS  ${message}`);
}

export function fail(message: string) {
  console.log(`  FAIL  ${message}`);
  process.exitCode = 1;
}
