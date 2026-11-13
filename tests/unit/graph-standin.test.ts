import { spawn, type ChildProcess } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uploadInChunks } from '@/lib/upload/chunked-upload';

// Runs the portal's real Graph code against the end-to-end stand-in (e2e-full/mock-graph.mjs),
// so the stand-in stays faithful to what the portal sends.
const PORT = 4791;
const ORIGIN = `http://127.0.0.1:${PORT}`;
let server: ChildProcess;

beforeAll(async () => {
  Object.assign(process.env, {
    MS_TENANT_ID: 'tenant',
    MS_PORTAL_CLIENT_ID: 'client',
    MS_PORTAL_CLIENT_SECRET: 'secret',
    SP_SITE_ID: 'site',
    SP_DRIVE_ID: 'b!e2e-drive',
    SP_CLIENT_ROOT_FOLDER_ID: 'E2EROOT',
    E2E_GRAPH_MOCK_URL: ORIGIN,
  });
  delete process.env.SP_HOSTNAME;
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

afterAll(() => {
  server?.kill();
  delete process.env.E2E_GRAPH_MOCK_URL;
});

describe('Graph stand-in', () => {
  it('supports the folder, upload, verification and browsing calls the portal makes', async () => {
    const { createStandardClientFolder } = await import('@/lib/graph/client-folders');
    const { createUploadSession, ensureFolderPath, getChildByPath } =
      await import('@/lib/graph/drive');
    const { sharePointSource } = await import('@/lib/graph/explorer');

    const folder = await createStandardClientFolder('Todd', 'Test');
    expect(folder.relativePath).toBe('Test, Todd');
    const id = await ensureFolderPath(folder.id, ['Individual', 'ID']);

    const bytes = new Uint8Array(700 * 1024).fill(7);
    for (const expected of [
      'TTest_DriversLicense_2026-11-13.pdf',
      'TTest_DriversLicense_2026-11-13 1.pdf',
    ]) {
      const session = await createUploadSession(
        id.id,
        'TTest_DriversLicense_2026-11-13.pdf',
        bytes.length,
      );
      expect(session.uploadUrl.startsWith(`${ORIGIN}/upload/`)).toBe(true);
      const item = await uploadInChunks(session.uploadUrl, new Blob([bytes]), {
        chunkSize: 320 * 1024,
        transport: {
          async putChunk(url, chunk, contentRange) {
            const res = await fetch(url, {
              method: 'PUT',
              headers: { 'Content-Range': contentRange },
              body: chunk,
            });
            return { status: res.status, body: await res.json() };
          },
          async getStatus(url) {
            const res = await fetch(url);
            return { status: res.status, body: await res.json() };
          },
          sleep: async () => undefined,
        },
      });
      expect(item.name).toBe(expected);
      expect(item.size).toBe(bytes.length);
    }
    const found = await getChildByPath(id.id, ['TTest_DriversLicense_2026-11-13.pdf']);
    expect(found?.parentReference?.id).toBe(id.id);

    const listing = await sharePointSource.listFolder(id.id);
    expect(listing.trail.map((c) => c.name)).toEqual([
      'All clients',
      'Test, Todd',
      'Individual',
      'ID',
    ]);
    expect(listing.items).toHaveLength(2);
    const link = await sharePointSource.downloadUrl(found!.id);
    expect(link).toBe(`${ORIGIN}/content/${found!.id}`);
    expect((await sharePointSource.search(folder.id, 'license')).length).toBe(2);
  });
});
