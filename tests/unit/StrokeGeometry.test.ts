import { describe, expect, it } from 'vitest';
import { PageLayout } from '../../src/canvas/PageLayout';
import { StrokeGeometry } from '../../src/canvas/StrokeGeometry';
import { TextLayout } from '../../src/canvas/TextLayout';
import { GAP, MM } from '../../src/core/constants';
import type { Stroke } from '../../src/core/types';
import { page } from './fixtures';

let n = 0;
const makeId = (): string => 'f' + ++n;

/** A horizontal stroke from x0 to x1 at y with one point per px. */
function line(x0: number, x1: number, y = 0, size = 2): Stroke {
  const p: number[] = [];
  for (let x = x0; x <= x1; x++) p.push(x, y, 0.5);
  return { id: 'line', k: 'pen', c: '#000000', s: size, p: new Float32Array(p) };
}

describe('StrokeGeometry', () => {
  it('pen width follows pressure', () => {
    expect(StrokeGeometry.penWidth(2, 0)).toBeCloseTo(0.84);
    expect(StrokeGeometry.penWidth(2, 1)).toBeCloseTo(2.4);
  });

  it('computes and caches the bounding box with half the width as padding', () => {
    const geo = new StrokeGeometry();
    const st = line(10, 20, 5, 4);
    const box = geo.bbox(st);
    expect(box).toEqual({ x0: 7, y0: 2, x1: 23, y1: 8 });
    expect(geo.bbox(st)).toBe(box);
  });

  it('measures point-to-segment distance', () => {
    expect(StrokeGeometry.distToSegment(5, 3, 0, 0, 10, 0)).toBe(3);
    expect(StrokeGeometry.distToSegment(-4, 3, 0, 0, 10, 0)).toBe(5);
    expect(StrokeGeometry.distToSegment(1, 1, 0, 0, 0, 0)).toBeCloseTo(Math.SQRT2);
  });

  it('hit-tests for the whole-stroke eraser', () => {
    const st = line(0, 100);
    expect(StrokeGeometry.hit(st, 50, 5, 4)).toBe(true);
    expect(StrokeGeometry.hit(st, 50, 10, 4)).toBe(false);
  });

  describe('partial eraser split', () => {
    it('returns null when the eraser misses', () => {
      expect(StrokeGeometry.split(line(0, 100), 50, 40, 5, makeId)).toBeNull();
    });

    it('cuts a stroke into two fragments with new ids', () => {
      const parts = StrokeGeometry.split(line(0, 100), 50, 0, 5, makeId);
      expect(parts).toHaveLength(2);
      const [left, right] = parts ?? [];
      expect(left?.id).not.toBe('line');
      expect(Math.max(...Array.from(left?.p ?? []).filter((_, i) => i % 3 === 0))).toBeLessThan(45);
      expect(Math.min(...Array.from(right?.p ?? []).filter((_, i) => i % 3 === 0))).toBeGreaterThan(55);
      expect(left?.c).toBe('#000000');
    });

    it('removes a stroke entirely when the eraser covers it', () => {
      expect(StrokeGeometry.split(line(0, 4), 2, 0, 10, makeId)).toEqual([]);
    });

    it('resamples long segments so a cut in the middle of a segment works', () => {
      const st: Stroke = {
        id: 's',
        k: 'pen',
        c: '#000000',
        s: 1,
        p: new Float32Array([0, 0, 0.5, 100, 0, 0.5]),
      };
      const parts = StrokeGeometry.split(st, 50, 0, 5, makeId);
      expect(parts).toHaveLength(2);
    });

    it('drops tiny leftovers', () => {
      const parts = StrokeGeometry.split(line(0, 10), 9, 0, 5, makeId);
      expect(parts?.every((p) => p.p.length >= 6)).toBe(true);
    });
  });

  describe('lasso', () => {
    const square = [0, 0, 100, 0, 100, 100, 0, 100];

    it('point in polygon', () => {
      expect(StrokeGeometry.pointInPolygon(50, 50, square)).toBe(true);
      expect(StrokeGeometry.pointInPolygon(150, 50, square)).toBe(false);
    });

    it('selects a stroke when at least half of it is inside', () => {
      expect(StrokeGeometry.insideLasso(line(10, 90, 50), square)).toBe(true);
      expect(StrokeGeometry.insideLasso(line(40, 200, 50), square)).toBe(false);
    });
  });

  describe('straightening', () => {
    it('accepts a long, nearly straight line', () => {
      const pts = [0, 0, 0.4, 30, 1, 0.6, 60, -1, 0.5, 100, 0, 0.5];
      expect(StrokeGeometry.straightLinePressure(pts, 1)).toBeCloseTo(0.5);
    });

    it('rejects curves, short lines and too few points', () => {
      expect(
        StrokeGeometry.straightLinePressure([0, 0, 0.5, 50, 40, 0.5, 100, 0, 0.5, 120, 0, 0.5], 1),
      ).toBeNull();
      expect(
        StrokeGeometry.straightLinePressure([0, 0, 0.5, 10, 0, 0.5, 20, 0, 0.5, 30, 0, 0.5], 1),
      ).toBeNull();
      expect(StrokeGeometry.straightLinePressure([0, 0, 0.5, 100, 0, 0.5], 1)).toBeNull();
    });

    it('builds an 11-point line', () => {
      const pts = StrokeGeometry.line(0, 0, 0.5, 100, 50);
      expect(pts).toHaveLength(33);
      expect(pts.slice(-3)).toEqual([100, 50, 0.5]);
    });
  });
});

describe('PageLayout', () => {
  it('stacks pages centred on x = 0 with a gap', () => {
    const a = page({ id: 'a', w: 210, h: 297 });
    const b = page({ id: 'b', w: 148, h: 210 });
    const layout = new PageLayout();
    layout.update([a, b]);
    expect(layout.pos(a)).toEqual({ x: (-210 * MM) / 2, y: 0 });
    expect(layout.pos(b).y).toBeCloseTo(297 * MM + GAP);
    expect(layout.totalHeight).toBeCloseTo(297 * MM + GAP + 210 * MM);
    expect(layout.maxPageWidth).toBeCloseTo(210 * MM);
    expect(layout.pageAt(0, 297 * MM + GAP + 10)).toBe(b);
    expect(layout.pageAt(0, 297 * MM + 5)).toBeNull();
    expect(layout.currentIndex(297 * MM, 100)).toBe(1);
  });
});

describe('TextLayout', () => {
  const measurer = { font: '', measureText: (s: string) => ({ width: s.length * 10 }) };

  it('wraps at the box width and keeps newlines', () => {
    const layout = new TextLayout(measurer);
    const item = { id: 't', x: 0, y: 0, w: 100, t: 'aaa bbb ccc ddd\nnext', fs: 20, c: '#000000' };
    expect(layout.lines(item)).toEqual(['aaa bbb', 'ccc ddd', 'next']);
    expect(layout.box(item).y1).toBeCloseTo(3 * 20 * 1.35);
  });
});
