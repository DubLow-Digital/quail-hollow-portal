import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanSearch,
  fileKindLabel,
  sortItems,
  type ExplorerItem,
} from '@/lib/files/explorer-types';
import { SAMPLE_ROOT_ID, sampleSource } from '@/lib/files/sample-tree';

vi.mock('@azure/msal-node', () => ({
  ConfidentialClientApplication: class {
    async acquireTokenByClientCredential() {
      return { accessToken: 'test-token' };
    }
  },
}));

const item = (name: string, kind: 'file' | 'folder'): ExplorerItem => ({
  id: name,
  name,
  kind,
  size: null,
  childCount: null,
  mime: null,
  modifiedAt: null,
  modifiedBy: null,
  webUrl: null,
  parentId: null,
});

describe('explorer helpers', () => {
  it('sorts folders first, then names naturally', () => {
    const sorted = sortItems([
      item('b.pdf', 'file'),
      item('2025', 'folder'),
      item('a10.pdf', 'file'),
      item('a2.pdf', 'file'),
      item('ID', 'folder'),
    ]);
    expect(sorted.map((i) => i.name)).toEqual(['2025', 'ID', 'a2.pdf', 'a10.pdf', 'b.pdf']);
  });

  it('cleans search text', () => {
    expect(cleanSearch('  W2 \n 2025  ')).toBe('W2 2025');
    expect(cleanSearch('x'.repeat(300))).toHaveLength(100);
    expect(cleanSearch(undefined)).toBe('');
  });

  it('labels file kinds', () => {
    expect(fileKindLabel('TTest_W2_2025.pdf', null)).toBe('PDF');
    expect(fileKindLabel('scan.HEIC', null)).toBe('Photo');
    expect(fileKindLabel('noext', 'image/png')).toBe('Image');
    expect(fileKindLabel('ledger.qbb', null)).toBe('QuickBooks');
  });
});

describe('sample file source', () => {
  it('lists the root with fake client folders only', async () => {
    const root = await sampleSource.listFolder(null);
    expect(root.id).toBe(SAMPLE_ROOT_ID);
    expect(root.trail).toEqual([{ id: SAMPLE_ROOT_ID, name: 'All clients' }]);
    const names = root.items.map((i) => i.name);
    expect(names).toContain('Test, Todd');
    expect(root.items.every((i) => i.kind === 'folder')).toBe(true);
  });

  it('walks into a client folder with a breadcrumb trail', async () => {
    const root = await sampleSource.listFolder(null);
    const todd = root.items.find((i) => i.name === 'Test, Todd')!;
    const folder = await sampleSource.listFolder(todd.id);
    expect(folder.trail.map((c) => c.name)).toEqual(['All clients', 'Test, Todd']);
    expect(folder.items.map((i) => i.name)).toEqual(['Businesses', 'Dependents', 'Individual']);
  });

  it('searches within a folder and never offers downloads', async () => {
    const results = await sampleSource.search(SAMPLE_ROOT_ID, 'w2');
    expect(results.length).toBe(2);
    expect(results.every((r) => r.name.includes('W2'))).toBe(true);
    expect(await sampleSource.downloadUrl(results[0]!.id)).toBeNull();
  });

  it('rejects unknown folders and files', async () => {
    await expect(sampleSource.listFolder('sample.9999')).rejects.toThrow();
    await expect(sampleSource.downloadUrl('nope')).rejects.toThrow();
  });
});

const ENV = {
  MS_TENANT_ID: 'tenant',
  MS_PORTAL_CLIENT_ID: 'client',
  MS_PORTAL_CLIENT_SECRET: 'secret',
  SP_SITE_ID: 'site',
  SP_DRIVE_ID: 'b!drive',
  SP_CLIENT_ROOT_FOLDER_ID: 'ROOT',
  SP_HOSTNAME: 'example.sharepoint.com',
};

type Graph = Record<string, { id: string; name: string; parent?: string; folder?: boolean }>;
const TREE: Graph = {
  ROOT: { id: 'ROOT', name: 'Clients', parent: 'LIB', folder: true },
  LIB: { id: 'LIB', name: 'Documents', folder: true },
  SMITH: { id: 'SMITH', name: 'Smith, Jane', parent: 'ROOT', folder: true },
  ID: { id: 'ID', name: 'ID', parent: 'SMITH', folder: true },
  F1: { id: 'F1', name: 'JSmith_DriversLicense.pdf', parent: 'ID' },
  OUT: { id: 'OUT', name: 'HR', parent: 'LIB', folder: true },
  F2: { id: 'F2', name: 'payroll.xlsx', parent: 'OUT' },
};
let urls: string[];
let downloadHost = 'example.sharepoint.com';

function graphItem(id: string, withDownload = false) {
  const n = TREE[id]!;
  return {
    id: n.id,
    name: n.name,
    ...(n.folder
      ? { folder: { childCount: 1 } }
      : { file: { mimeType: 'application/pdf' }, size: 10 }),
    parentReference: n.parent ? { id: n.parent, driveId: 'b!drive' } : { driveId: 'b!drive' },
    ...(withDownload && !n.folder
      ? { '@microsoft.graph.downloadUrl': `https://${downloadHost}/download.aspx?tempauth=x` }
      : {}),
  };
}

beforeEach(async () => {
  Object.assign(process.env, ENV);
  const { resetEnvCacheForTests } = await import('@/lib/env');
  resetEnvCacheForTests();
  urls = [];
  downloadHost = 'example.sharepoint.com';
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      urls.push(url);
      const u = new URL(url);
      const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), {
          status,
          headers: { 'Content-Type': 'application/json' },
        });
      const children = /\/items\/([^/]+)\/children$/.exec(u.pathname);
      if (children) {
        const kids = Object.values(TREE).filter((n) => n.parent === children[1]);
        return json({ value: kids.map((k) => graphItem(k.id)) });
      }
      if (/\/search\(q=/.test(decodeURIComponent(u.pathname)))
        return json({ value: [graphItem('F1')] });
      const one = /\/items\/([^/]+)$/.exec(u.pathname);
      if (one && TREE[one[1]!]) return json(graphItem(one[1]!, !u.searchParams.has('$select')));
      return json({ error: { code: 'itemNotFound' } }, 404);
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

describe('SharePoint file source', () => {
  it('lists a client folder with a trail back to the client root', async () => {
    const { sharePointSource } = await import('@/lib/graph/explorer');
    const folder = await sharePointSource.listFolder('ID');
    expect(folder.trail.map((c) => c.name)).toEqual(['All clients', 'Smith, Jane', 'ID']);
    expect(folder.items.map((i) => i.name)).toEqual(['JSmith_DriversLicense.pdf']);
  });

  it('refuses folders outside the client root', async () => {
    const { sharePointSource } = await import('@/lib/graph/explorer');
    await expect(sharePointSource.listFolder('OUT')).rejects.toThrow('outside_root');
    await expect(sharePointSource.downloadUrl('F2')).rejects.toThrow('outside_root');
  });

  it('returns SharePoint download links only for files inside the root', async () => {
    const { sharePointSource } = await import('@/lib/graph/explorer');
    expect(await sharePointSource.downloadUrl('F1')).toMatch(
      /^https:\/\/example\.sharepoint\.com\//,
    );
    expect(await sharePointSource.downloadUrl('SMITH')).toBeNull();
    downloadHost = 'evil.example.com';
    await expect(sharePointSource.downloadUrl('F1')).rejects.toThrow();
  });

  it('escapes quotes in search terms', async () => {
    const { graphSearchSegment, sharePointSource } = await import('@/lib/graph/explorer');
    expect(graphSearchSegment("O'Neil W2")).toBe("search(q='O''Neil%20W2')");
    const results = await sharePointSource.search('SMITH', "O'Neil");
    expect(results.map((r) => r.id)).toEqual(['F1']);
    expect(urls.some((u) => u.includes("search(q='O''Neil')"))).toBe(true);
  });
});
