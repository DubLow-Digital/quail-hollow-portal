import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import {
  CHUNK_UNIT,
  DEFAULT_CHUNK_SIZE,
  UploadError,
  planChunks,
  uploadInChunks,
  type ChunkResponse,
  type Transport,
} from '@/lib/upload/chunked-upload';
import { buildPdf } from '@/lib/upload/pdf';
import { fitWithin } from '@/lib/upload/image';

const MiB = 1024 * 1024;

/** Simulated Graph upload session. */
function fakeSession(
  total: number,
  opts: { failPuts?: number[]; statusOnFail?: number; dropFinalResponse?: boolean } = {},
) {
  let received = 0;
  let puts = 0;
  const ranges: string[] = [];
  const sizes: number[] = [];
  let committed = false;
  const transport: Transport = {
    async putChunk(_url, chunk, contentRange): Promise<ChunkResponse> {
      puts++;
      ranges.push(contentRange);
      sizes.push(chunk.size);
      if (opts.failPuts?.includes(puts)) return { status: opts.statusOnFail ?? 503, body: null };
      const [, start, end] = /bytes (\d+)-(\d+)\//.exec(contentRange)!.map(Number) as [
        number,
        number,
        number,
      ];
      if (start !== received) return { status: 416, body: null };
      received = end + 1;
      if (received === total) {
        committed = true;
        if (opts.dropFinalResponse) return { status: 0, body: null };
        return {
          status: 201,
          body: { id: 'ITEM-1', name: 'TTest_W2_2025_2026-11-12.pdf', size: total },
        };
      }
      return { status: 202, body: { nextExpectedRanges: [`${received}-`] } };
    },
    async getStatus(): Promise<ChunkResponse> {
      if (committed) return { status: 404, body: null };
      return { status: 200, body: { nextExpectedRanges: [`${received}-`] } };
    },
    sleep: async () => undefined,
  };
  return {
    transport,
    ranges,
    sizes,
    get puts() {
      return puts;
    },
  };
}

describe('planChunks', () => {
  it('uses 5 MiB chunks that are multiples of 320 KiB', () => {
    expect(DEFAULT_CHUNK_SIZE).toBe(5 * MiB);
    expect(DEFAULT_CHUNK_SIZE % CHUNK_UNIT).toBe(0);
    const chunks = planChunks(40 * MiB + 123);
    expect(chunks).toHaveLength(9);
    for (const [start, end] of chunks.slice(0, -1)) expect((end - start) % CHUNK_UNIT).toBe(0);
    expect(chunks.at(-1)![1]).toBe(40 * MiB + 123);
  });

  it('rejects chunk sizes that are not multiples of 320 KiB', () => {
    expect(() => planChunks(10, 1000)).toThrow();
  });
});

describe('uploadInChunks', () => {
  it('uploads a 40 MB file in order with correct Content-Range headers', async () => {
    const total = 40 * 1000 * 1000;
    const session = fakeSession(total);
    const progress: number[] = [];
    const item = await uploadInChunks(
      'https://example.sharepoint.com/up',
      new Blob([new Uint8Array(total)]),
      {
        transport: session.transport,
        onProgress: (sent) => progress.push(sent),
      },
    );
    expect(item.id).toBe('ITEM-1');
    expect(session.ranges[0]).toBe(`bytes 0-${5 * MiB - 1}/${total}`);
    expect(session.ranges.at(-1)).toBe(
      `bytes ${Math.floor(total / (5 * MiB)) * 5 * MiB}-${total - 1}/${total}`,
    );
    expect(session.sizes.slice(0, -1).every((s) => s === 5 * MiB)).toBe(true);
    expect(progress.at(-1)).toBe(total);
  });

  it('retries transient failures and resumes from the next expected range', async () => {
    const total = 12 * MiB;
    const session = fakeSession(total, { failPuts: [2, 3] });
    const item = await uploadInChunks('u', new Blob([new Uint8Array(total)]), {
      transport: session.transport,
    });
    expect(item.id).toBe('ITEM-1');
    expect(session.puts).toBe(5);
  });

  it('gives up after too many failures', async () => {
    const total = 1 * MiB;
    const session = fakeSession(total, { failPuts: [1, 2, 3, 4, 5, 6, 7, 8] });
    await expect(
      uploadInChunks('u', new Blob([new Uint8Array(total)]), {
        transport: session.transport,
        maxRetries: 3,
      }),
    ).rejects.toMatchObject({ code: 'too_many_retries' });
  });

  it('fails fast on a non-retryable rejection', async () => {
    const session = fakeSession(MiB, { failPuts: [1], statusOnFail: 413 });
    await expect(
      uploadInChunks('u', new Blob([new Uint8Array(MiB)]), { transport: session.transport }),
    ).rejects.toMatchObject({ code: 'rejected' });
    expect(session.puts).toBe(1);
  });

  it('reports maybe_complete when the final response is lost after commit', async () => {
    const total = 6 * MiB;
    const session = fakeSession(total, { dropFinalResponse: true });
    const err = await uploadInChunks('u', new Blob([new Uint8Array(total)]), {
      transport: session.transport,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(UploadError);
    expect(err.code).toBe('maybe_complete');
  });

  it('can be cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const session = fakeSession(MiB);
    await expect(
      uploadInChunks('u', new Blob([new Uint8Array(MiB)]), {
        transport: session.transport,
        signal: controller.signal,
      }),
    ).rejects.toThrow('cancelled');
  });
});

describe('buildPdf', () => {
  // Smallest valid PNG (1x1 white pixel), so the test needs no image fixtures.
  const PNG_1X1 = Uint8Array.from(
    atob(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC',
    ),
    (c) => c.charCodeAt(0),
  );

  it('combines a three-page scan into one PDF', async () => {
    const bytes = await buildPdf([
      { bytes: PNG_1X1, kind: 'png' },
      { bytes: PNG_1X1, kind: 'png' },
      { bytes: PNG_1X1, kind: 'png' },
    ]);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(3);
    expect(doc.getPage(0).getWidth()).toBe(612);
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
  });

  it('refuses an empty scan', async () => {
    await expect(buildPdf([])).rejects.toThrow();
  });
});

describe('fitWithin', () => {
  it('scales the long edge down and never up', () => {
    expect(fitWithin(4032, 3024, 1600)).toEqual({ w: 1600, h: 1200 });
    expect(fitWithin(3024, 4032, 1600)).toEqual({ w: 1200, h: 1600 });
    expect(fitWithin(800, 600, 1600)).toEqual({ w: 800, h: 600 });
  });
});
