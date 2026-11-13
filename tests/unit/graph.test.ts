import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@azure/msal-node', () => ({
  ConfidentialClientApplication: class {
    async acquireTokenByClientCredential() {
      return { accessToken: 'test-token' };
    }
  },
}));

const ENV = {
  MS_TENANT_ID: 'tenant',
  MS_PORTAL_CLIENT_ID: 'client',
  MS_PORTAL_CLIENT_SECRET: 'secret',
  SP_SITE_ID: 'site',
  SP_DRIVE_ID: 'b!drive',
  SP_CLIENT_ROOT_FOLDER_ID: 'ROOT',
  SP_HOSTNAME: 'example.sharepoint.com',
};

type Call = { url: string; method: string; body: unknown; auth: string | null };
let calls: Call[];
let responder: (call: Call) => Response;

function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

beforeEach(async () => {
  Object.assign(process.env, ENV);
  const { resetEnvCacheForTests } = await import('@/lib/env');
  resetEnvCacheForTests();
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      const call: Call = {
        url,
        method: init.method ?? 'GET',
        body: init.body ? JSON.parse(String(init.body)) : undefined,
        auth: new Headers(init.headers).get('Authorization'),
      };
      calls.push(call);
      return responder(call);
    }),
  );
  vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 1000 });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('createUploadSession', () => {
  it('encodes the filename, asks Graph to rename on conflict, and returns the URL', async () => {
    responder = () =>
      json(200, {
        uploadUrl: 'https://example.sharepoint.com/upload/abc',
        expirationDateTime: '2026-11-13T00:00:00Z',
      });
    const { createUploadSession } = await import('@/lib/graph/drive');
    const session = await createUploadSession('FOLDER 1', 'JSmith_W2_2025_2026-11-12.pdf', 1234);
    expect(session.uploadUrl).toBe('https://example.sharepoint.com/upload/abc');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(
      'https://graph.microsoft.com/v1.0/drives/b!drive/items/FOLDER%201:/JSmith_W2_2025_2026-11-12.pdf:/createUploadSession',
    );
    expect(calls[0]!.auth).toBe('Bearer test-token');
    expect(calls[0]!.body).toEqual({
      item: {
        '@microsoft.graph.conflictBehavior': 'rename',
        name: 'JSmith_W2_2025_2026-11-12.pdf',
        fileSize: 1234,
      },
      deferCommit: false,
    });
  });

  it('refuses upload URLs on hosts other than the configured SharePoint host', async () => {
    responder = () =>
      json(200, { uploadUrl: 'https://evil.example.com/upload', expirationDateTime: 'x' });
    const { createUploadSession } = await import('@/lib/graph/drive');
    await expect(createUploadSession('F', 'a.pdf', 1)).rejects.toThrow(/host/);
  });
});

describe('ensureFolderPath', () => {
  it('returns an existing path in one call', async () => {
    responder = () => json(200, { id: 'LEAF', name: '2025', folder: {} });
    const { ensureFolderPath } = await import('@/lib/graph/drive');
    const item = await ensureFolderPath('CLIENT', ['Individual', 'Tax Returns', '2025']);
    expect(item.id).toBe('LEAF');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain('/items/CLIENT:/Individual/Tax%20Returns/2025:');
  });

  it('creates missing segments one at a time', async () => {
    responder = (call) => {
      if (call.method === 'POST') {
        const name = (call.body as { name: string }).name;
        return json(201, { id: `NEW-${name}`, name, folder: {} });
      }
      if (call.url.includes('/items/CLIENT:/Individual:')) {
        return json(200, { id: 'IND', name: 'Individual', folder: {} });
      }
      return json(404, { error: { code: 'itemNotFound' } });
    };
    const { ensureFolderPath } = await import('@/lib/graph/drive');
    const item = await ensureFolderPath('CLIENT', ['Individual', 'Tax Returns']);
    expect(item.id).toBe('NEW-Tax Returns');
    const posts = calls.filter((c) => c.method === 'POST');
    expect(posts).toHaveLength(1);
    expect(posts[0]!.url).toContain('/items/IND/children');
    expect(posts[0]!.body).toMatchObject({
      name: 'Tax Returns',
      '@microsoft.graph.conflictBehavior': 'fail',
    });
  });

  it('sanitizes segments before they reach Graph', async () => {
    responder = () => json(200, { id: 'X', name: 'x', folder: {} });
    const { ensureFolderPath } = await import('@/lib/graph/drive');
    await ensureFolderPath('CLIENT', ['Businesses', 'Acme: "Widgets"']);
    expect(calls[0]!.url).toContain('/Businesses/Acme%20Widgets:');
  });
});

describe('graphRequest retries', () => {
  it('retries throttled requests and then succeeds', async () => {
    let n = 0;
    responder = () => {
      n++;
      return n === 1
        ? json(429, { error: { code: 'tooManyRequests' } }, { 'Retry-After': '1' })
        : json(200, { id: 'ITEM', name: 'a.pdf', size: 10 });
    };
    const { getItem } = await import('@/lib/graph/drive');
    const item = await getItem('ITEM');
    expect(item?.id).toBe('ITEM');
    expect(calls).toHaveLength(2);
  });

  it('returns null for missing items and throws GraphError for other failures', async () => {
    responder = () => json(404, { error: { code: 'itemNotFound' } });
    const { getItem } = await import('@/lib/graph/drive');
    expect(await getItem('missing')).toBeNull();

    responder = () => json(403, { error: { code: 'accessDenied' } });
    const { GraphError } = await import('@/lib/graph/client');
    await expect(getItem('forbidden')).rejects.toBeInstanceOf(GraphError);
  });
});
