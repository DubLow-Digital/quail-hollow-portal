'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  FILE_ERROR_MESSAGES,
  acceptAttribute,
  checkFileAgainstRules,
  effectiveMime,
  formatBytes,
  type FileCheckError,
} from '@/lib/files/types';
import { UploadError, uploadInChunks } from '@/lib/upload/chunked-upload';
import { compressPhoto } from '@/lib/upload/image';
import { buildPdf } from '@/lib/upload/pdf';
import { Alert, Button, buttonClass } from '@/components/ui';
import { ACTIVITY_EVENT } from './idle-logout';
import { Scanner, type CameraMode, type ScannedPage } from './scanner';

type CaptureMethod = 'photo' | 'scan' | 'file';

interface Prepared {
  blob: Blob;
  mime: string;
  captureMethod: CaptureMethod;
  pageCount?: number;
  originalName?: string;
  previews: string[];
  label: string;
}

type Phase = 'choose' | 'preparing' | 'ready' | 'uploading' | 'success' | 'error';

const SERVER_ERRORS: Record<string, string> = {
  not_ready:
    'Your secure folder is still being set up. Please try again later, or call our office and we will help.',
  request_closed: 'This document is already complete. Thank you!',
  rate_limited: 'Too many uploads in a short time. Please wait a few minutes and try again.',
  unauthorized: 'For your security you were signed out. Please sign in again to send this file.',
  verification_failed: 'Something went wrong while saving your file. Please try again.',
};

const GENERIC_ERROR = 'We could not send your file. Check your connection and try again.';

function messageFor(code: string | undefined): string {
  if (!code) return GENERIC_ERROR;
  if (code in FILE_ERROR_MESSAGES) return FILE_ERROR_MESSAGES[code as FileCheckError];
  return SERVER_ERRORS[code] ?? GENERIC_ERROR;
}

async function postJson(
  url: string,
  body: unknown,
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, data };
}

export function UploadPanel({
  requestId,
  documentName,
  acceptedMime,
  maxMb,
  requiresFrontBack = false,
  onPhone = false,
}: {
  requestId: string;
  documentName: string;
  acceptedMime: string[];
  maxMb: number;
  /** The document type asks for both sides of a card. */
  requiresFrontBack?: boolean;
  /** Signed in on a phone from a "continue on your phone" code (this item only). */
  onPhone?: boolean;
}) {
  const router = useRouter();
  const photoInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [phase, setPhase] = useState<Phase>('choose');
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [camera, setCamera] = useState<CameraMode | null>(null);

  const acceptsImages = acceptedMime.includes('image/jpeg');
  const acceptsPdf = acceptedMime.includes('application/pdf');
  const rules = { acceptedMime, maxMb };

  // Release preview URLs when they are replaced or the panel unmounts.
  useEffect(() => {
    const urls = prepared?.previews ?? [];
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [prepared]);

  // Warn before leaving mid-upload.
  useEffect(() => {
    if (phase !== 'uploading') return;
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [phase]);

  function reset() {
    setPrepared(null);
    setError(null);
    setProgress(0);
    setPhase('choose');
  }

  function showError(message: string) {
    setError(message);
    setPhase('error');
  }

  function ready(p: Prepared) {
    const problem = checkFileAgainstRules(
      {
        mime: p.mime,
        sizeBytes: p.blob.size,
        originalName: p.originalName,
        pageCount: p.pageCount,
      },
      rules,
    );
    if (problem) {
      p.previews.forEach((u) => URL.revokeObjectURL(u));
      showError(FILE_ERROR_MESSAGES[problem]);
      return;
    }
    setPrepared(p);
    setPhase('ready');
  }

  /** A JPEG from the in-app camera or the phone's camera app: sent as is, or as a PDF. */
  async function readyPhotoJpeg(jpeg: Blob) {
    if (acceptsImages) {
      ready({
        blob: jpeg,
        mime: 'image/jpeg',
        captureMethod: 'photo',
        previews: [URL.createObjectURL(jpeg)],
        label: 'Photo',
      });
      return;
    }
    const pdf = await buildPdf([{ bytes: new Uint8Array(await jpeg.arrayBuffer()), kind: 'jpeg' }]);
    const blob = new Blob([pdf as BlobPart], { type: 'application/pdf' });
    ready({
      blob,
      mime: 'application/pdf',
      captureMethod: 'photo',
      pageCount: 1,
      previews: [URL.createObjectURL(jpeg)],
      label: 'Photo (saved as PDF)',
    });
  }

  async function onPhoto(file: File | undefined) {
    if (photoInput.current) photoInput.current.value = '';
    if (!file) return;
    setError(null);
    setPhase('preparing');
    try {
      const jpeg = await compressPhoto(file);
      if (jpeg && (acceptsImages || acceptsPdf)) {
        await readyPhotoJpeg(jpeg);
      } else {
        // The browser could not process the photo (for example HEIC on some phones); send it as is.
        const mime = effectiveMime(file.type, file.name);
        ready({
          blob: file,
          mime,
          captureMethod: 'photo',
          originalName: file.name,
          previews: [],
          label: file.name,
        });
      }
    } catch {
      showError('We could not read that photo. Please try again.');
    }
  }

  async function onCameraPhoto(pages: ScannedPage[]) {
    setCamera(null);
    const page = pages[0];
    if (!page) return;
    URL.revokeObjectURL(page.url);
    setError(null);
    setPhase('preparing');
    try {
      await readyPhotoJpeg(page.blob);
    } catch {
      showError('We could not read that photo. Please try again.');
    }
  }

  async function onScanned(pages: ScannedPage[]) {
    setCamera(null);
    if (pages.length === 0) return;
    setError(null);
    setPhase('preparing');
    try {
      const images = await Promise.all(
        pages.map(async (p) => ({
          bytes: new Uint8Array(await p.blob.arrayBuffer()),
          kind: 'jpeg' as const,
        })),
      );
      const pdf = await buildPdf(images);
      const blob = new Blob([pdf as BlobPart], { type: 'application/pdf' });
      ready({
        blob,
        mime: 'application/pdf',
        captureMethod: 'scan',
        pageCount: pages.length,
        previews: pages.map((p) => p.url),
        label: `${pages.length}-page scan`,
      });
    } catch {
      pages.forEach((p) => URL.revokeObjectURL(p.url));
      showError('We could not combine those pages. Please try scanning again.');
    }
  }

  function onFile(file: File | undefined) {
    if (fileInput.current) fileInput.current.value = '';
    if (!file) return;
    setError(null);
    const mime = effectiveMime(file.type, file.name);
    const isImage = mime.startsWith('image/') && mime !== 'image/heic' && mime !== 'image/heif';
    ready({
      blob: file,
      mime,
      captureMethod: 'file',
      originalName: file.name,
      previews: isImage ? [URL.createObjectURL(file)] : [],
      label: file.name,
    });
  }

  async function send() {
    if (!prepared) return;
    setPhase('uploading');
    setProgress(0);
    setError(null);
    const controller = new AbortController();
    abortRef.current = controller;
    const heartbeat = window.setInterval(
      () => {
        void fetch('/api/uploads/heartbeat', { method: 'POST' }).catch(() => undefined);
      },
      4 * 60 * 1000,
    );

    let uploadId: string | null = null;
    try {
      for (let attempt = 1; attempt <= 2; attempt++) {
        const start = await postJson('/api/uploads/start', {
          requestId,
          mime: prepared.mime,
          size: prepared.blob.size,
          pageCount: prepared.pageCount,
          captureMethod: prepared.captureMethod,
          originalName: prepared.originalName,
        });
        if (!start.ok) {
          showError(messageFor(start.data.error as string | undefined));
          return;
        }
        uploadId = start.data.uploadId as string;
        let itemId: string | undefined;
        try {
          const item = await uploadInChunks(start.data.uploadUrl as string, prepared.blob, {
            signal: controller.signal,
            onProgress: (sent, total) => {
              setProgress(Math.round((sent / total) * 100));
              window.dispatchEvent(new Event(ACTIVITY_EVENT));
            },
          });
          itemId = item.id;
        } catch (err) {
          if (err instanceof UploadError && err.code === 'maybe_complete') {
            itemId = undefined; // the server looks the file up by name
          } else if (
            err instanceof UploadError &&
            err.code === 'session_expired' &&
            attempt === 1
          ) {
            await postJson('/api/uploads/fail', { uploadId, reason: 'session_expired' });
            uploadId = null;
            continue;
          } else {
            throw err;
          }
        }

        const done = await postJson('/api/uploads/complete', { uploadId, itemId });
        if (!done.ok) {
          showError(messageFor(done.data.error as string | undefined));
          return;
        }
        setProgress(100);
        setPhase('success');
        router.refresh();
        return;
      }
    } catch (err) {
      const cancelled = err instanceof DOMException && err.name === 'AbortError';
      if (uploadId) {
        await postJson('/api/uploads/fail', {
          uploadId,
          reason: cancelled ? 'cancelled' : err instanceof UploadError ? 'rejected' : 'network',
        }).catch(() => undefined);
      }
      if (cancelled) reset();
      else showError(GENERIC_ERROR);
    } finally {
      window.clearInterval(heartbeat);
      abortRef.current = null;
    }
  }

  if (phase === 'success') {
    return (
      <div
        className="space-y-4 rounded-2xl bg-emerald-50 p-5 text-center ring-1 ring-emerald-200"
        role="status"
      >
        <p className="text-4xl" aria-hidden="true">
          ✓
        </p>
        <p className="text-xl font-semibold text-emerald-900">
          Thank you! We received your {documentName}.
        </p>
        <p className="text-emerald-900/80">
          {onPhone
            ? 'It is saved securely in your client file, and your computer shows it too. You can put your phone down.'
            : 'It is saved securely in your client file.'}
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
          {onPhone ? null : (
            <Link href="/" className={buttonClass('primary', 'lg')}>
              Back to my list
            </Link>
          )}
          <Button type="button" variant="secondary" size="lg" onClick={reset}>
            Send another file for this item
          </Button>
        </div>
      </div>
    );
  }

  if (phase === 'uploading') {
    return (
      <div className="space-y-4 rounded-2xl bg-white p-5 ring-1 ring-black/5" aria-live="polite">
        <p className="text-lg font-medium text-brand-900">Sending securely… {progress}%</p>
        <progress className="qh-progress" max={100} value={progress} aria-label="Upload progress" />
        <p className="text-sm text-neutral-600">Please keep this page open until it finishes.</p>
        <Button type="button" variant="ghost" onClick={() => abortRef.current?.abort()}>
          Cancel
        </Button>
      </div>
    );
  }

  if ((phase === 'ready' || phase === 'preparing') && (prepared || phase === 'preparing')) {
    return (
      <div className="space-y-4 rounded-2xl bg-white p-5 ring-1 ring-black/5">
        {phase === 'preparing' || !prepared ? (
          <p className="text-lg text-brand-900" aria-live="polite">
            Getting your file ready…
          </p>
        ) : (
          <>
            <p className="text-lg font-medium text-brand-900">Ready to send</p>
            {prepared.previews.length ? (
              <ul className="flex gap-2 overflow-x-auto" aria-label="Preview">
                {prepared.previews.map((url, i) => (
                  <li key={url} className="shrink-0">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={url}
                      alt={prepared.previews.length > 1 ? `Page ${i + 1}` : 'Preview'}
                      className="h-48 w-auto max-w-[70vw] rounded-lg object-contain ring-1 ring-black/10"
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-lg bg-neutral-50 p-3 text-sm">📄 {prepared.label}</p>
            )}
            <p className="text-sm text-neutral-600">
              {prepared.label} · {formatBytes(prepared.blob.size)}
              {prepared.pageCount && prepared.pageCount > 1 ? ` · ${prepared.pageCount} pages` : ''}
            </p>
            <p className="text-sm text-neutral-600">
              Check that every page is clear and easy to read.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button type="button" size="lg" onClick={() => void send()} className="sm:flex-1">
                Send to Quail Hollow
              </Button>
              <Button type="button" size="lg" variant="secondary" onClick={reset}>
                Start over
              </Button>
            </div>
          </>
        )}
      </div>
    );
  }

  // For a card that needs both sides, Scan document (front, then back, as one PDF) comes first.
  const scanFirst = requiresFrontBack && acceptsPdf;
  const primary =
    'flex min-h-20 w-full items-center gap-4 rounded-2xl bg-brand-700 px-5 text-left text-white shadow-sm active:scale-[0.99]';
  const secondary =
    'flex min-h-20 w-full items-center gap-4 rounded-2xl bg-white px-5 text-left text-brand-900 shadow-sm ring-1 ring-brand-200 active:scale-[0.99]';
  const photoButton =
    acceptsImages || acceptsPdf ? (
      <button
        type="button"
        onClick={() => setCamera('photo')}
        className={scanFirst ? secondary : primary}
      >
        <span aria-hidden="true" className="text-3xl">
          📷
        </span>
        <span>
          <span className="block text-lg font-semibold">Take photo</span>
          <span className={`block text-sm ${scanFirst ? 'text-neutral-600' : 'text-white/80'}`}>
            {scanFirst ? 'One side only' : 'Best for a single card or page'}
          </span>
        </span>
      </button>
    ) : null;
  const scanButton = acceptsPdf ? (
    <button
      type="button"
      onClick={() => setCamera('scan')}
      className={scanFirst ? primary : secondary}
    >
      <span aria-hidden="true" className="text-3xl">
        📑
      </span>
      <span>
        <span className="block text-lg font-semibold">Scan document</span>
        <span className={`block text-sm ${scanFirst ? 'text-white/80' : 'text-neutral-600'}`}>
          {requiresFrontBack ? 'The front, then the back, as one PDF' : 'Several pages as one PDF'}
        </span>
      </span>
    </button>
  ) : null;

  return (
    <div className="space-y-3">
      {phase === 'error' && error ? (
        <Alert tone="error" title="That did not work">
          {error}{' '}
          {error === SERVER_ERRORS.unauthorized ? (
            <Link href={`/login?next=/request/${requestId}`} className="font-medium underline">
              Sign in
            </Link>
          ) : null}
        </Alert>
      ) : null}

      {scanFirst ? scanButton : null}
      {photoButton}
      {scanFirst ? null : scanButton}

      <button
        type="button"
        onClick={() => fileInput.current?.click()}
        className="flex min-h-20 w-full items-center gap-4 rounded-2xl bg-white px-5 text-left text-brand-900 shadow-sm ring-1 ring-brand-200 active:scale-[0.99]"
      >
        <span aria-hidden="true" className="text-3xl">
          📁
        </span>
        <span>
          <span className="block text-lg font-semibold">Choose file</span>
          <span className="block text-sm text-neutral-600">
            A PDF or picture already on your device
          </span>
        </span>
      </button>

      <p className="text-xs text-neutral-500">Files up to {maxMb} MB.</p>

      <input
        ref={photoInput}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => void onPhoto(e.target.files?.[0])}
      />
      <input
        ref={fileInput}
        type="file"
        accept={acceptAttribute(acceptedMime)}
        className="hidden"
        onChange={(e) => onFile(e.target.files?.[0])}
      />
      {camera === 'scan' ? (
        <Scanner
          mode="scan"
          frontBack={requiresFrontBack}
          onDone={(pages) => void onScanned(pages)}
          onCancel={() => setCamera(null)}
        />
      ) : null}
      {camera === 'photo' ? (
        <Scanner
          mode="photo"
          onDone={(pages) => void onCameraPhoto(pages)}
          onCancel={() => setCamera(null)}
          onFallback={() => {
            // Runs inside the click, so the browser allows opening the camera app.
            photoInput.current?.click();
            setCamera(null);
          }}
        />
      ) : null}
    </div>
  );
}
