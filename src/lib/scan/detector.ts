'use client';

import { isUsableQuad, type Quad } from './geometry';

/**
 * Document edge detection and perspective correction in the browser, using Scanic
 * (MIT, Rust/WebAssembly, bundled with our own code). Loaded only when the camera opens.
 * Every function degrades to "no outline" instead of throwing, so the camera always works
 * even where WebAssembly is unavailable.
 */

type ScanicModule = typeof import('scanic');
type ScanicScanner = InstanceType<ScanicModule['Scanner']>;
type Source = HTMLVideoElement | HTMLCanvasElement;

let loading: Promise<ScanicScanner | null> | null = null;

function scanner(): Promise<ScanicScanner | null> {
  if (!loading) {
    loading = import('scanic')
      .then(async (m) => {
        const s = new m.Scanner();
        await s.initialize();
        return s;
      })
      .catch(() => null);
  }
  return loading;
}

/** Starts loading the detector early (for example when the camera opens). */
export function preloadDetector(): void {
  void scanner();
}

function sizeOf(source: Source): { w: number; h: number } {
  return source instanceof HTMLVideoElement
    ? { w: source.videoWidth, h: source.videoHeight }
    : { w: source.width, h: source.height };
}

/** Finds the page outline, in the source's own pixel coordinates, or null. */
export async function detectQuad(
  source: Source,
  maxProcessingDimension = 360,
): Promise<Quad | null> {
  const { w, h } = sizeOf(source);
  if (!w || !h) return null;
  const s = await scanner();
  if (!s) return null;
  try {
    const r = await s.scan(source, { mode: 'detect', maxProcessingDimension });
    return r.success && r.corners && isUsableQuad(r.corners, w, h) ? r.corners : null;
  } catch {
    return null;
  }
}

/** Crops to the outline and straightens it; null if that fails. */
export async function extractQuad(source: Source, quad: Quad): Promise<HTMLCanvasElement | null> {
  const s = await scanner();
  if (!s) return null;
  try {
    const r = await s.extract(source, quad, { output: 'canvas' });
    const out = r.output;
    return r.success && out instanceof HTMLCanvasElement && out.width > 0 && out.height > 0
      ? out
      : null;
  } catch {
    return null;
  }
}
