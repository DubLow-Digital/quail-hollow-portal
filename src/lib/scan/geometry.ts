/** Pure geometry for the document outline (no DOM), shared by the camera and tests. */

export interface Point {
  x: number;
  y: number;
}

export interface Quad {
  topLeft: Point;
  topRight: Point;
  bottomRight: Point;
  bottomLeft: Point;
}

export function quadPoints(q: Quad): Point[] {
  return [q.topLeft, q.topRight, q.bottomRight, q.bottomLeft];
}

/** Shoelace area of the quadrilateral. */
export function quadArea(q: Quad): number {
  const p = quadPoints(q);
  let sum = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i]!;
    const b = p[(i + 1) % p.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

/** True when every turn goes the same way (no bow-tie or dent). */
export function isConvex(q: Quad): boolean {
  const p = quadPoints(q);
  let sign = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i]!;
    const b = p[(i + 1) % p.length]!;
    const c = p[(i + 2) % p.length]!;
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (cross === 0) return false;
    const s = Math.sign(cross);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

/** Minimum share of the frame a detected page must cover before we crop to it. */
export const MIN_COVERAGE = 0.12;

/**
 * Whether a detected outline is trustworthy enough to crop to: inside the frame (a little
 * slack), convex, and covering a reasonable part of the picture.
 */
export function isUsableQuad(q: Quad, width: number, height: number): boolean {
  if (!(width > 0 && height > 0)) return false;
  const slack = 0.02;
  const inFrame = quadPoints(q).every(
    (pt) =>
      Number.isFinite(pt.x) &&
      Number.isFinite(pt.y) &&
      pt.x >= -width * slack &&
      pt.x <= width * (1 + slack) &&
      pt.y >= -height * slack &&
      pt.y <= height * (1 + slack),
  );
  return inFrame && isConvex(q) && quadArea(q) >= MIN_COVERAGE * width * height;
}

/** SVG polygon "points" attribute. */
export function svgPoints(q: Quad): string {
  return quadPoints(q)
    .map((pt) => `${Math.round(pt.x)},${Math.round(pt.y)}`)
    .join(' ');
}
