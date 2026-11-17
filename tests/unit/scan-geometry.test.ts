import { describe, expect, it } from 'vitest';
import { isConvex, isUsableQuad, quadArea, svgPoints, type Quad } from '@/lib/scan/geometry';

const page: Quad = {
  topLeft: { x: 300, y: 150 },
  topRight: { x: 950, y: 220 },
  bottomRight: { x: 900, y: 780 },
  bottomLeft: { x: 250, y: 700 },
};

describe('document outline geometry', () => {
  it('measures the area of a tilted page', () => {
    const square: Quad = {
      topLeft: { x: 0, y: 0 },
      topRight: { x: 10, y: 0 },
      bottomRight: { x: 10, y: 10 },
      bottomLeft: { x: 0, y: 10 },
    };
    expect(quadArea(square)).toBe(100);
    expect(quadArea(page)).toBeGreaterThan(300_000);
  });

  it('accepts a real page inside the frame', () => {
    expect(isConvex(page)).toBe(true);
    expect(isUsableQuad(page, 1200, 900)).toBe(true);
  });

  it('rejects crossed corners, tiny outlines and outlines outside the frame', () => {
    const bowTie: Quad = { ...page, topRight: page.bottomRight, bottomRight: page.topRight };
    expect(isConvex(bowTie)).toBe(false);
    expect(isUsableQuad(bowTie, 1200, 900)).toBe(false);

    const tiny: Quad = {
      topLeft: { x: 10, y: 10 },
      topRight: { x: 60, y: 10 },
      bottomRight: { x: 60, y: 60 },
      bottomLeft: { x: 10, y: 60 },
    };
    expect(isUsableQuad(tiny, 1200, 900)).toBe(false);

    const outside: Quad = { ...page, topRight: { x: 2000, y: 220 } };
    expect(isUsableQuad(outside, 1200, 900)).toBe(false);
    expect(isUsableQuad({ ...page, topLeft: { x: Number.NaN, y: 0 } }, 1200, 900)).toBe(false);
    expect(isUsableQuad(page, 0, 900)).toBe(false);
  });

  it('formats SVG points in corner order', () => {
    expect(svgPoints(page)).toBe('300,150 950,220 900,780 250,700');
  });
});
