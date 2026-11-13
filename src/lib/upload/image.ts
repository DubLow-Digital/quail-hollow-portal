/**
 * Browser image helpers. Re-encoding through a canvas also strips EXIF metadata such as
 * GPS location from phone photos before they leave the device.
 */

export const SCAN_MAX_EDGE = 1600;
export const PHOTO_MAX_EDGE = 2400;

type Drawable = ImageBitmap | HTMLImageElement | HTMLVideoElement;

function dims(source: Drawable): { w: number; h: number } {
  if (source instanceof HTMLVideoElement) return { w: source.videoWidth, h: source.videoHeight };
  if (source instanceof HTMLImageElement)
    return { w: source.naturalWidth, h: source.naturalHeight };
  return { w: source.width, h: source.height };
}

export function fitWithin(w: number, h: number, maxEdge: number): { w: number; h: number } {
  const scale = Math.min(1, maxEdge / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) };
}

export async function drawToJpeg(source: Drawable, maxEdge: number, quality = 0.82): Promise<Blob> {
  const { w, h } = dims(source);
  if (!w || !h) throw new Error('Image has no size');
  const size = fitWithin(w, h, maxEdge);
  const canvas = document.createElement('canvas');
  canvas.width = size.w;
  canvas.height = size.h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas not available');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size.w, size.h);
  ctx.drawImage(source, 0, 0, size.w, size.h);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', quality),
  );
  canvas.width = 0;
  canvas.height = 0;
  if (!blob) throw new Error('Could not encode image');
  return blob;
}

/** Decodes an image file honoring EXIF orientation. Returns null if the browser can't decode it (e.g. HEIC on Android). */
export async function decodeImage(file: Blob): Promise<ImageBitmap | HTMLImageElement | null> {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      // Fall through to <img> decoding.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Downscales and re-encodes a photo as JPEG; returns null if it cannot be decoded. */
export async function compressPhoto(file: Blob, maxEdge = PHOTO_MAX_EDGE): Promise<Blob | null> {
  const decoded = await decodeImage(file);
  if (!decoded) return null;
  try {
    return await drawToJpeg(decoded, maxEdge, 0.85);
  } finally {
    if ('close' in decoded) decoded.close();
  }
}
