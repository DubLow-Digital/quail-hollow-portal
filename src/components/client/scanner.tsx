'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { SCAN_MAX_EDGE, compressPhoto, drawToJpeg } from '@/lib/upload/image';
import { Alert, Button } from '@/components/ui';

export interface ScannedPage {
  blob: Blob;
  url: string;
}

const MAX_PAGES = 30;

/**
 * In-app document scanner: live rear-camera preview, capture one or more pages, review,
 * then hand the pages back to be combined into one PDF. Falls back to the phone's camera
 * app (one photo per page) when live camera access is not available.
 */
export function Scanner({
  onDone,
  onCancel,
}: {
  onDone: (pages: ScannedPage[]) => void;
  onCancel: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fallbackInput = useRef<HTMLInputElement>(null);
  const [pages, setPages] = useState<ScannedPage[]>([]);
  const [cameraState, setCameraState] = useState<'starting' | 'live' | 'unavailable'>('starting');
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState(false);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraState('unavailable');
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play().catch(() => undefined);
        }
        setCameraState('live');
      } catch {
        setCameraState('unavailable');
      }
    }
    void start();
    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [stopCamera]);

  // Free preview URLs when the scanner closes.
  const pagesRef = useRef<ScannedPage[]>([]);
  useEffect(() => {
    pagesRef.current = pages;
  }, [pages]);
  useEffect(() => () => pagesRef.current.forEach((p) => URL.revokeObjectURL(p.url)), []);

  const addPage = (blob: Blob) =>
    setPages((prev) =>
      prev.length >= MAX_PAGES ? prev : [...prev, { blob, url: URL.createObjectURL(blob) }],
    );

  async function capture() {
    const video = videoRef.current;
    if (!video || !video.videoWidth || busy) return;
    setBusy(true);
    setFlash(true);
    window.setTimeout(() => setFlash(false), 150);
    try {
      addPage(await drawToJpeg(video, SCAN_MAX_EDGE, 0.8));
    } finally {
      setBusy(false);
    }
  }

  async function addFromCameraApp(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      const jpeg = await compressPhoto(file, SCAN_MAX_EDGE);
      if (jpeg) addPage(jpeg);
    } finally {
      setBusy(false);
      if (fallbackInput.current) fallbackInput.current.value = '';
    }
  }

  function removePage(index: number) {
    setPages((prev) => {
      const target = prev[index];
      if (target) URL.revokeObjectURL(target.url);
      return prev.filter((_, i) => i !== index);
    });
  }

  function finish() {
    stopCamera();
    const done = pages;
    pagesRef.current = []; // ownership of the URLs passes to the caller
    onDone(done);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black text-white"
      role="dialog"
      aria-modal="true"
      aria-label="Scan document"
    >
      <div className="flex items-center justify-between px-4 py-3">
        <button
          type="button"
          onClick={() => {
            stopCamera();
            onCancel();
          }}
          className="min-h-11 rounded-lg px-3 text-base"
        >
          Cancel
        </button>
        <p className="text-sm text-white/80" aria-live="polite">
          {pages.length} page{pages.length === 1 ? '' : 's'}
        </p>
        <button
          type="button"
          onClick={finish}
          disabled={pages.length === 0 || busy}
          className="min-h-11 rounded-lg bg-white px-4 font-semibold text-black disabled:opacity-40"
        >
          Done
        </button>
      </div>

      <div className="relative flex-1 overflow-hidden">
        {cameraState !== 'unavailable' ? (
          <>
            <video
              ref={videoRef}
              playsInline
              muted
              autoPlay
              className="h-full w-full object-contain"
            />
            <div
              aria-hidden="true"
              className={`pointer-events-none absolute inset-6 rounded-2xl border-2 border-dashed border-white/50 transition ${flash ? 'bg-white/40' : ''}`}
            />
            {cameraState === 'starting' ? (
              <p className="absolute inset-x-0 top-1/2 text-center text-white/80">
                Starting camera…
              </p>
            ) : null}
          </>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
            <Alert tone="warning">
              Live camera is not available here. You can still take one photo per page with your
              camera.
            </Alert>
            <Button
              type="button"
              size="lg"
              onClick={() => fallbackInput.current?.click()}
              disabled={busy}
            >
              {pages.length ? 'Take another page' : 'Take a photo of page 1'}
            </Button>
          </div>
        )}
        <input
          ref={fallbackInput}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => void addFromCameraApp(e.target.files?.[0])}
        />
      </div>

      {pages.length ? (
        <ul className="flex gap-2 overflow-x-auto px-4 py-2" aria-label="Captured pages">
          {pages.map((p, i) => (
            <li key={p.url} className="relative shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={p.url}
                alt={`Page ${i + 1}`}
                className="h-20 w-16 rounded-md object-cover ring-1 ring-white/30"
              />
              <button
                type="button"
                onClick={() => removePage(i)}
                aria-label={`Remove page ${i + 1}`}
                className="absolute -top-2 -right-2 flex size-7 items-center justify-center rounded-full bg-red-600 text-sm font-bold"
              >
                ×
              </button>
              <span className="absolute bottom-0.5 left-1 text-xs font-semibold drop-shadow">
                {i + 1}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex items-center justify-center pt-2 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        {cameraState === 'live' ? (
          <button
            type="button"
            onClick={() => void capture()}
            disabled={busy || pages.length >= MAX_PAGES}
            aria-label={`Capture page ${pages.length + 1}`}
            className="size-20 rounded-full border-4 border-white bg-white/20 active:bg-white/60 disabled:opacity-40"
          />
        ) : cameraState === 'unavailable' && pages.length ? (
          <p className="text-sm text-white/70">Tap Done when every page is captured.</p>
        ) : null}
      </div>
      <p className="px-4 pb-4 text-center text-xs text-white/70">
        Lay the page flat in good light and fill the frame. Capture each page, then tap Done.
      </p>
    </div>
  );
}
