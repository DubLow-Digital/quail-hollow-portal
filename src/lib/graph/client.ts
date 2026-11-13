import 'server-only';
import { ConfidentialClientApplication } from '@azure/msal-node';
import { graphEnv } from '@/lib/env';
import { log } from '@/lib/log';
import { graphMockOrigin } from './mock';

/**
 * Microsoft Graph access for the "Quail Hollow Client Portal" Entra app.
 *
 * The app holds only the `Sites.Selected` application permission and has been granted
 * `write` on Aleida's one SharePoint site. MSAL caches the client-credentials token in
 * memory and refreshes it before expiry.
 */

const GRAPH = 'https://graph.microsoft.com/v1.0';

/** Graph's base URL, or the local stand-in during end-to-end tests (see ./mock.ts). */
function graphBase(): string {
  const mock = graphMockOrigin();
  return mock ? `${mock}/v1.0` : GRAPH;
}
const SCOPES = ['https://graph.microsoft.com/.default'];

let msal: ConfidentialClientApplication | null = null;

function app(): ConfidentialClientApplication {
  if (!msal) {
    const env = graphEnv();
    msal = new ConfidentialClientApplication({
      auth: {
        clientId: env.MS_PORTAL_CLIENT_ID,
        clientSecret: env.MS_PORTAL_CLIENT_SECRET,
        authority: `https://login.microsoftonline.com/${env.MS_TENANT_ID}`,
      },
      system: {
        loggerOptions: { piiLoggingEnabled: false, logLevel: 0, loggerCallback: () => {} },
      },
    });
  }
  return msal;
}

export async function graphToken(): Promise<string> {
  if (graphMockOrigin()) return 'e2e-mock-token';
  const result = await app().acquireTokenByClientCredential({ scopes: SCOPES });
  if (!result?.accessToken)
    throw new GraphError(401, 'token_unavailable', 'Could not acquire a Graph token');
  return result.accessToken;
}

export class GraphError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'GraphError';
  }
}

interface GraphRequest {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT';
  body?: unknown;
  /** Return null instead of throwing on 404. */
  allow404?: boolean;
  timeoutMs?: number;
}

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

/** Calls Graph with retries on throttling and transient errors. Never logs URLs or bodies. */
export async function graphRequest<T>(path: string, opts: GraphRequest = {}): Promise<T | null> {
  const base = graphBase();
  const url = /^https?:\/\//.test(path) ? path : `${base}${path}`;
  if (!url.startsWith(`${base}/`)) throw new Error('Refusing to call a non-Graph URL');

  for (let attempt = 1; ; attempt++) {
    const token = await graphToken();
    const started = Date.now();
    let res: Response;
    try {
      res = await fetch(url, {
        method: opts.method ?? 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
        cache: 'no-store',
      });
    } catch (err) {
      if (attempt < 3) {
        await sleep(400 * attempt);
        continue;
      }
      log.error('graph.network_error', { attempt, reason: (err as Error).name });
      throw new GraphError(503, 'network_error', 'Could not reach Microsoft Graph');
    }

    if (res.status === 404 && opts.allow404) return null;
    if (res.ok) {
      if (res.status === 204) return null;
      return (await res.json()) as T;
    }

    let code = 'unknown';
    try {
      const payload = (await res.json()) as { error?: { code?: string } };
      code = payload.error?.code ?? code;
    } catch {
      // Non-JSON error body.
    }

    if (RETRYABLE.has(res.status) && attempt < 4) {
      const retryAfter = Number(res.headers.get('Retry-After'));
      const waitMs =
        Number.isFinite(retryAfter) && retryAfter > 0
          ? Math.min(retryAfter, 10) * 1000
          : 500 * 2 ** attempt;
      log.warn('graph.retry', {
        statusCode: res.status,
        graphCode: code,
        attempt,
        durationMs: Date.now() - started,
      });
      await sleep(waitMs);
      continue;
    }

    log.warn('graph.error', { statusCode: res.status, graphCode: code, attempt });
    throw new GraphError(res.status, code, `Graph request failed (${res.status} ${code})`);
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
