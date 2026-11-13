/**
 * Browser-side chunked upload straight to a Microsoft Graph upload session URL.
 *
 * - Chunks are 5 MiB, a multiple of 320 KiB as Graph requires.
 * - No Authorization header is sent: the upload URL is pre-authenticated.
 * - Transient failures (network, 5xx, 429) retry with backoff; after a range error the
 *   session status is read and the upload resumes from the next expected byte.
 *
 * The transport is injectable so the logic is unit tested without a browser.
 */

export const CHUNK_UNIT = 320 * 1024;
export const DEFAULT_CHUNK_SIZE = 16 * CHUNK_UNIT; // 5 MiB

export interface ChunkResponse {
  status: number;
  body: unknown;
}

export interface Transport {
  putChunk(
    url: string,
    chunk: Blob,
    contentRange: string,
    onProgress: (loadedInChunk: number) => void,
  ): Promise<ChunkResponse>;
  getStatus(url: string): Promise<ChunkResponse>;
  sleep(ms: number): Promise<void>;
  waitForOnline?(): Promise<void>;
}

export type UploadErrorCode =
  | 'session_expired'
  /** The final chunk was sent but its response was lost; the file may already exist. */
  | 'maybe_complete'
  | 'rejected'
  | 'too_many_retries';

export class UploadError extends Error {
  constructor(
    public readonly code: UploadErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'UploadError';
  }
}

export interface UploadedItem {
  id: string;
  name: string;
  size: number;
}

export interface UploadOptions {
  chunkSize?: number;
  maxRetries?: number;
  onProgress?: (sent: number, total: number) => void;
  signal?: AbortSignal;
  transport?: Transport;
}

export function planChunks(total: number, chunkSize = DEFAULT_CHUNK_SIZE): [number, number][] {
  if (chunkSize % CHUNK_UNIT !== 0) throw new Error('Chunk size must be a multiple of 320 KiB');
  const out: [number, number][] = [];
  for (let start = 0; start < total; start += chunkSize)
    out.push([start, Math.min(start + chunkSize, total)]);
  return out;
}

function parseNextExpected(body: unknown): number | null {
  const ranges = (body as { nextExpectedRanges?: string[] } | null)?.nextExpectedRanges;
  const first = ranges?.[0];
  if (!first) return null;
  const start = Number(first.split('-')[0]);
  return Number.isFinite(start) ? start : null;
}

function asItem(body: unknown): UploadedItem | null {
  const b = body as { id?: unknown; name?: unknown; size?: unknown } | null;
  if (b && typeof b.id === 'string' && typeof b.name === 'string') {
    return { id: b.id, name: b.name, size: typeof b.size === 'number' ? b.size : 0 };
  }
  return null;
}

const isTransient = (status: number) =>
  status === 0 || status === 408 || status === 429 || status >= 500;

export async function uploadInChunks(
  url: string,
  file: Blob,
  options: UploadOptions = {},
): Promise<UploadedItem> {
  const transport = options.transport ?? xhrTransport();
  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
  if (chunkSize % CHUNK_UNIT !== 0) throw new Error('Chunk size must be a multiple of 320 KiB');
  const maxRetries = options.maxRetries ?? 6;
  const total = file.size;
  if (total <= 0) throw new UploadError('rejected', 'The file is empty');
  let offset = 0;
  let failures = 0;
  let sentFinal = false;

  const expired = () =>
    sentFinal
      ? new UploadError('maybe_complete', 'The upload may have finished; confirming')
      : new UploadError('session_expired', 'The upload session expired');

  while (offset < total) {
    if (options.signal?.aborted) throw new DOMException('Upload cancelled', 'AbortError');
    const end = Math.min(offset + chunkSize, total);
    if (end === total) sentFinal = true;
    let res: ChunkResponse;
    try {
      res = await transport.putChunk(
        url,
        file.slice(offset, end),
        `bytes ${offset}-${end - 1}/${total}`,
        (loaded) => options.onProgress?.(offset + loaded, total),
      );
    } catch {
      res = { status: 0, body: null };
    }

    if (res.status === 200 || res.status === 201) {
      const item = asItem(res.body);
      if (!item) throw new UploadError('rejected', 'Upload finished without file details');
      options.onProgress?.(total, total);
      return item;
    }
    if (res.status === 202) {
      offset = parseNextExpected(res.body) ?? end;
      failures = 0;
      options.onProgress?.(offset, total);
      continue;
    }
    if (res.status === 404) throw expired();
    if (!isTransient(res.status) && res.status !== 416) {
      throw new UploadError('rejected', `Upload rejected (${res.status})`);
    }

    failures++;
    if (failures > maxRetries) throw new UploadError('too_many_retries', 'The upload kept failing');
    if (isTransient(res.status)) {
      if (res.status === 0 && transport.waitForOnline) await transport.waitForOnline();
      await transport.sleep(Math.min(1000 * 2 ** (failures - 1), 15_000));
    }

    // Ask the session where to resume; it may already have the chunk we just sent.
    const status = await transport.getStatus(url).catch(() => ({ status: 0, body: null }));
    if (status.status === 404) throw expired();
    if (status.status === 200) {
      const resumeAt = parseNextExpected(status.body);
      if (resumeAt !== null) offset = resumeAt;
    }
  }
  throw new UploadError('rejected', 'Upload ended without completing');
}

/** XMLHttpRequest transport (fetch cannot report upload progress). */
export function xhrTransport(): Transport {
  return {
    putChunk(url, chunk, contentRange, onProgress) {
      return new Promise((resolve) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', url);
        xhr.setRequestHeader('Content-Range', contentRange);
        xhr.timeout = 120_000;
        xhr.upload.onprogress = (e) => onProgress(e.loaded);
        xhr.onload = () => {
          let body: unknown = null;
          try {
            body = xhr.responseText ? JSON.parse(xhr.responseText) : null;
          } catch {
            body = null;
          }
          resolve({ status: xhr.status, body });
        };
        xhr.onerror = () => resolve({ status: 0, body: null });
        xhr.ontimeout = () => resolve({ status: 0, body: null });
        xhr.send(chunk);
      });
    },
    async getStatus(url) {
      try {
        const res = await fetch(url, { method: 'GET', credentials: 'omit', cache: 'no-store' });
        return { status: res.status, body: await res.json().catch(() => null) };
      } catch {
        return { status: 0, body: null };
      }
    },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    waitForOnline: () =>
      new Promise((resolve) => {
        if (typeof navigator === 'undefined' || navigator.onLine) return resolve();
        const done = () => {
          window.removeEventListener('online', done);
          resolve();
        };
        window.addEventListener('online', done);
        setTimeout(done, 60_000);
      }),
  };
}
