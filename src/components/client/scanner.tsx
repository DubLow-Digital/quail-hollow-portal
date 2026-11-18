'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { PHOTO_MAX_EDGE, SCAN_MAX_EDGE, compressPhoto, drawToJpeg } from '@/lib/upload/image';
import { detectQuad, extractQuad, preloadDetector } from '@/lib/scan/detector';
import { svgPoints, type Quad } from '@/lib/scan/geometry';
import { Alert, Button } from '@/components/ui';

export interface ScannedPage {
  blob: Blob;
  url: string;
}

export type CameraMode = 'photo' | 'scan';

const MAX_PAGES = 30;
/** How often the live outline is refreshed. */
const DETECT_EVERY_MS = 250;
/** Drop the outline when the page has not been seen for this long. */
const OUTLINE_HOLD_MS = 900;

interface Captured {
  cropped: Blob | null;
  full: Blob;
}

/**
 * In-app camera with a live document outline. "photo" takes one picture and shows it for
 * review; "scan" captures several pages that become one PDF. When the page edges are found,
 * each capture is cropped to the page and straightened. Falls back to the phone's camera
 * app when live camera access is not available.
 */
export function Scanner({
  mode = 'scan',
  onDone,
  onCancel,
  onFallback,
  frontBack = false,
}: {
  mode?: CameraMode;
  onDone: (pages: ScannedPage[]) => void;
  onCancel: () => void;
  /** Photo mode only: use the phone's own camera app instead (must run in the click). */
  onFallback?: () => void;
  /** Scan mode only: the document needs both sides, so ask for the front, then the back. */
  frontBack?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fallbackInput = useRef<HTMLInputElement>(null);
  const [pages, setPages] = useState<ScannedPage[]>([]);
  const [cameraState, setCameraState] = useState<'starting' | 'live' | 'unavailable'>('starting');
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState(false);
  const [quad, setQuad] = useState<Quad | null>(null);
  const [frame, setFrame] = useState<{ w: number; h: number } | null>(null);
  const [review, setReview] = useState<(Captured & { url: string; useFull: boolean }) | null>(null);
  const isPhoto = mode === 'photo';
  const label = isPhoto ? 'Take photo' : 'Scan document';
  const sides = frontBack && !isPhoto;
  /** "Front" and "Back" for the first two captures of a two-sided card, else page numbers. */
  const pageName = (i: number) => (sides && i < 2 ? (i === 0 ? 'Front' : 'Back') : `Page ${i + 1}`);
  const nextSide = sides && pages.length < 2 ? (pages.length === 0 ? 'front' : 'back') : null;

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    let cancelled = false;
    preloadDetector();
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

  // Live outline: look for the page a few times a second while the camera is showing.
  useEffect(() => {
    if (cameraState !== 'live' || review) return;
    let stopped = false;
    let running = false;
    let lastSeen = 0;
    const timer = window.setInterval(() => {
      const video = videoRef.current;
      if (running || stopped || !video?.videoWidth) return;
      running = true;
      void detectQuad(video)
        .then((found) => {
          if (stopped) return;
          setFrame({ w: video.videoWidth, h: video.videoHeight });
          if (found) {
            lastSeen = Date.now();
            setQuad(found);
          } else if (Date.now() - lastSeen > OUTLINE_HOLD_MS) {
            setQuad(null);
          }
        })
        .finally(() => {
          running = false;
        });
    }, DETECT_EVERY_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [cameraState, review]);

  // Free preview URLs when the scanner closes.
  const pagesRef = useRef<ScannedPage[]>([]);
  const reviewRef = useRef<string | null>(null);
  useEffect(() => {
    pagesRef.current = pages;
  }, [pages]);
  useEffect(() => {
    reviewRef.current = review?.url ?? null;
  }, [review]);
  useEffect(
    () => () => {
      pagesRef.current.forEach((p) => URL.revokeObjectURL(p.url));
      if (reviewRef.current) URL.revokeObjectURL(reviewRef.current);
    },
    [],
  );

  const addPage = (blob: Blob) =>
    setPages((prev) =>
      prev.length >= MAX_PAGES ? prev : [...prev, { blob, url: URL.createObjectURL(blob) }],
    );

  /** Grabs the current frame; when the page is found, also a cropped, straightened copy. */
  async function grab(video: HTMLVideoElement): Promise<Captured> {
    const maxEdge = isPhoto ? PHOTO_MAX_EDGE : SCAN_MAX_EDGE;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas not available');
    ctx.drawImage(video, 0, 0);
    try {
      const full = await drawToJpeg(canvas, maxEdge, isPhoto ? 0.85 : 0.8);
      const found = await detectQuad(canvas, 640);
      const page = found ? await extractQuad(canvas, found) : null;
      const cropped = page ? await drawToJpeg(page, maxEdge, isPhoto ? 0.88 : 0.82) : null;
      if (page) {
        page.width = 0;
        page.height = 0;
      }
      return { cropped, full };
    } finally {
      canvas.width = 0;
      canvas.height = 0;
    }
  }

  async function capture() {
    const video = videoRef.current;
    if (!video || !video.videoWidth || busy) return;
    setBusy(true);
    setFlash(true);
    window.setTimeout(() => setFlash(false), 150);
    try {
      const shot = await grab(video);
      if (isPhoto) {
        const blob = shot.cropped ?? shot.full;
        setReview({ ...shot, url: URL.createObjectURL(blob), useFull: !shot.cropped });
      } else {
        addPage(shot.cropped ?? shot.full);
      }
    } finally {
      setBusy(false);
    }
  }

  function toggleCrop() {
    setReview((r) => {
      if (!r || !r.cropped) return r;
      URL.revokeObjectURL(r.url);
      const useFull = !r.useFull;
      return { ...r, useFull, url: URL.createObjectURL(useFull ? r.full : r.cropped) };
    });
  }

  function retake() {
    setReview((r) => {
      if (r) URL.revokeObjectURL(r.url);
      return null;
    });
  }

  function usePhoto() {
    if (!review) return;
    const blob = review.useFull || !review.cropped ? review.full : review.cropped;
    stopCamera();
    URL.revokeObjectURL(review.url);
    reviewRef.current = null;
    onDone([{ blob, url: URL.createObjectURL(blob) }]);
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

  function cancel() {
    stopCamera();
    onCancel();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black text-white"
      role="dialog"
      aria-modal="true"
      aria-label={label}
    >
      <div className="flex items-center justify-between px-4 py-3">
        <button type="button" onClick={cancel} className="min-h-11 rounded-lg px-3 text-base">
          Cancel
        </button>
        {isPhoto ? (
          <p className="text-sm text-white/80">{review ? 'Check your photo' : label}</p>
        ) : (
          <>
            <p className="text-sm text-white/80" aria-live="polite">
              {nextSide
                ? nextSide === 'front'
                  ? 'Capture the front'
                  : 'Now capture the back'
                : `${pages.length} page${pages.length === 1 ? '' : 's'}`}
            </p>
            <button
              type="button"
              onClick={finish}
              disabled={pages.length === 0 || busy}
              className="min-h-11 rounded-lg bg-white px-4 font-semibold text-black disabled:opacity-40"
            >
              Done
            </button>
          </>
        )}
        {isPhoto ? <span className="w-16" aria-hidden="true" /> : null}
      </div>

      <div className="relative flex-1 overflow-hidden">
        {review ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={review.url}
            alt="Your photo"
            className="absolute inset-0 h-full w-full object-contain"
          />
        ) : null}
        {cameraState !== 'unavailable' ? (
          <div className={review ? 'invisible absolute inset-0' : 'absolute inset-0'}>
            <video
              ref={videoRef}
              playsInline
              muted
              autoPlay
              className="h-full w-full object-contain"
            />
            {quad && frame ? (
              <svg
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 h-full w-full"
                viewBox={`0 0 ${frame.w} ${frame.h}`}
                preserveAspectRatio="xMidYMid meet"
              >
                <polygon
                  points={svgPoints(quad)}
                  className="fill-emerald-400/20 stroke-emerald-400"
                  strokeWidth={Math.max(3, Math.round(frame.w / 200))}
                  strokeLinejoin="round"
                />
              </svg>
            ) : (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-6 rounded-2xl border-2 border-dashed border-white/50"
              />
            )}
            <div
              aria-hidden="true"
              className={`pointer-events-none absolute inset-0 transition ${flash ? 'bg-white/40' : ''}`}
            />
            {cameraState === 'starting' ? (
              <p className="absolute inset-x-0 top-1/2 text-center text-white/80">
                Starting camera…
              </p>
            ) : null}
            <p
              className="absolute inset-x-0 top-3 text-center text-sm font-medium drop-shadow"
              aria-live="polite"
            >
              {cameraState === 'live'
                ? quad
                  ? 'Page found. Hold steady.'
                  : 'Looking for the page…'
                : ''}
            </p>
          </div>
        ) : isPhoto ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
            <Alert tone="warning">
              Live camera is not available here. You can take the photo with your camera app.
            </Alert>
            <Button type="button" size="lg" onClick={() => onFallback?.()}>
              Open camera
            </Button>
          </div>
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
              {nextSide
                ? `Take a photo of the ${nextSide}`
                : pages.length
                  ? 'Take another page'
                  : 'Take a photo of page 1'}
            </Button>
          </div>
        )}
        {!isPhoto ? (
          <input
            ref={fallbackInput}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => void addFromCameraApp(e.target.files?.[0])}
          />
        ) : null}
      </div>

      {!isPhoto && pages.length ? (
        <ul className="flex gap-2 overflow-x-auto px-4 py-2" aria-label="Captured pages">
          {pages.map((p, i) => (
            <li key={p.url} className="relative shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={p.url}
                alt={pageName(i)}
                className="h-20 w-16 rounded-md object-cover ring-1 ring-white/30"
              />
              <button
                type="button"
                onClick={() => removePage(i)}
                aria-label={`Remove ${pageName(i).toLowerCase()}`}
                className="absolute -top-2 -right-2 flex size-7 items-center justify-center rounded-full bg-red-600 text-sm font-bold"
              >
                ×
              </button>
              <span className="absolute bottom-0.5 left-1 text-xs font-semibold drop-shadow">
                {sides && i < 2 ? pageName(i) : i + 1}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {review ? (
        <div className="space-y-2 px-4 pt-3 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          <Button type="button" size="lg" className="w-full" onClick={usePhoto}>
            Use photo
          </Button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={retake}
              className="min-h-11 flex-1 rounded-lg ring-1 ring-white/40"
            >
              Retake
            </button>
            {review.cropped ? (
              <button
                type="button"
                onClick={toggleCrop}
                className="min-h-11 flex-1 rounded-lg ring-1 ring-white/40"
              >
                {review.useFull ? 'Crop to page' : 'Use whole photo'}
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-center pt-2 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
            {cameraState === 'live' ? (
              <button
                type="button"
                onClick={() => void capture()}
                disabled={busy || (!isPhoto && pages.length >= MAX_PAGES)}
                aria-label={
                  isPhoto
                    ? 'Take picture'
                    : nextSide
                      ? `Capture the ${nextSide}`
                      : `Capture page ${pages.length + 1}`
                }
                className={`size-20 rounded-full border-4 bg-white/20 active:bg-white/60 disabled:opacity-40 ${quad ? 'border-emerald-400' : 'border-white'}`}
              />
            ) : !isPhoto && cameraState === 'unavailable' && pages.length ? (
              <p className="text-sm text-white/70">Tap Done when every page is captured.</p>
            ) : null}
          </div>
          <p className="px-4 pb-4 text-center text-xs text-white/70">
            {isPhoto
              ? 'Lay it flat on a darker surface in good light. When the green outline matches the edges, take the picture.'
              : sides
                ? 'Lay it flat on a darker surface in good light. Capture the front, turn it over and capture the back, then tap Done.'
                : 'Lay each page flat on a darker surface in good light. When the green outline matches the edges, capture the page, then tap Done.'}
          </p>
        </>
      )}
    </div>
  );
}
