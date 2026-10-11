import type { Box, Stroke } from '../core/types';
import { clamp } from '../core/utils/math';

/** Minimum points kept in a fragment when the eraser splits a stroke (2 points × 3 values). */
const MIN_RUN = 6;

/** Extra eraser reach around a point of a stroke, by the point's pressure. */
export type EraseMargin = (pressure: number) => number;

/** The reach the eraser had before brushes: half the width for highlighters, 40 % of the size for pens. */
function legacyMargin(stroke: Stroke): EraseMargin {
  const margin = stroke.k === 'hl' ? stroke.s / 2 : stroke.s * 0.4;
  return () => margin;
}

/**
 * Pure stroke geometry: bounding boxes, hit tests, eraser splitting, lasso tests and line
 * straightening. Strokes are flat `[x, y, pressure, …]` arrays in page-local world px.
 */
export class StrokeGeometry {
  private readonly boxes = new WeakMap<Stroke, Box>();

  /**
   * @param inkReach how far ink can extend from the centre line of a stroke. Brushes differ
   *   (a pressed paint brush is much wider than its nominal size), so the editor passes the
   *   brush renderer's maximum half width.
   */
  constructor(private readonly inkReach: (stroke: Stroke) => number = (stroke) => stroke.s / 2) {}

  /** Distance from a point to a segment. */
  static distToSegment(px: number, py: number, x0: number, y0: number, x1: number, y1: number): number {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const l2 = dx * dx + dy * dy;
    const t = clamp(l2 ? ((px - x0) * dx + (py - y0) * dy) / l2 : 0, 0, 1);
    return Math.hypot(px - (x0 + dx * t), py - (y0 + dy * t));
  }

  /** Even-odd point-in-polygon test; `poly` is a flat `[x, y, …]` list. */
  static pointInPolygon(x: number, y: number, poly: ArrayLike<number>): boolean {
    let inside = false;
    for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) {
      const xi = poly[i] ?? 0;
      const yi = poly[i + 1] ?? 0;
      const xj = poly[j] ?? 0;
      const yj = poly[j + 1] ?? 0;
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  /** Bounding box including half the stroke width (cached per stroke object). */
  bbox(stroke: Stroke): Box {
    const cached = this.boxes.get(stroke);
    if (cached) return cached;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    const a = stroke.p;
    for (let i = 0; i < a.length; i += 3) {
      const x = a[i] ?? 0;
      const y = a[i + 1] ?? 0;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    const pad = this.inkReach(stroke) + 1;
    const box = { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
    this.boxes.set(stroke, box);
    return box;
  }

  /**
   * Whether a circle of radius `r` touches the stroke (used by the stroke eraser). `reach` is
   * how far the ink extends from the centre line.
   */
  static hit(stroke: Stroke, x: number, y: number, r: number, reach = stroke.s / 2): boolean {
    const a = stroke.p;
    const n = a.length / 3;
    const rr = r + reach;
    if (n === 1) return Math.hypot((a[0] ?? 0) - x, (a[1] ?? 0) - y) <= rr;
    for (let i = 1; i < n; i++) {
      const d = StrokeGeometry.distToSegment(
        x,
        y,
        a[i * 3 - 3] ?? 0,
        a[i * 3 - 2] ?? 0,
        a[i * 3] ?? 0,
        a[i * 3 + 1] ?? 0,
      );
      if (d <= rr) return true;
    }
    return false;
  }

  /**
   * Cuts a circle out of a stroke (pixel eraser). Long segments near the circle are
   * resampled so the cut is clean. A point is erased when it lies within `r` plus the stroke's
   * margin at that point's pressure, so brushes whose width follows pressure are cut where
   * their ink ends. Returns null if the circle misses, otherwise the remaining fragments
   * (possibly none) as new strokes with fresh ids and the same kind, colour, size and brush.
   */
  static split(
    stroke: Stroke,
    cx: number,
    cy: number,
    r: number,
    makeId: () => string,
    margin: EraseMargin = legacyMargin(stroke),
  ): Stroke[] | null {
    const a = stroke.p;
    const n = a.length / 3;
    const reach = (p: number): number => r + margin(p);
    if (n === 1) return Math.hypot((a[0] ?? 0) - cx, (a[1] ?? 0) - cy) <= reach(a[2] ?? 0) ? [] : null;
    const step = Math.max(0.4, r / 4);
    const maxReach = Math.max(reach(0), reach(1));
    const runs: number[][] = [];
    let run: number[] = [];
    let removed = false;
    const push = (x: number, y: number, p: number): void => {
      const rr = reach(p);
      if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= rr * rr) {
        removed = true;
        if (run.length >= MIN_RUN) runs.push(run);
        run = [];
      } else run.push(x, y, p);
    };
    for (let i = 0; i < n; i++) {
      const x = a[i * 3] ?? 0;
      const y = a[i * 3 + 1] ?? 0;
      const p = a[i * 3 + 2] ?? 0;
      if (i > 0) StrokeGeometry.resampleNear(a, i, cx, cy, maxReach, step, push);
      push(x, y, p);
    }
    if (!removed) return null;
    if (run.length >= MIN_RUN) runs.push(run);
    return runs.map((r2) => {
      const part: Stroke = { id: makeId(), k: stroke.k, c: stroke.c, s: stroke.s, p: new Float32Array(r2) };
      if (stroke.b) part.b = stroke.b;
      return part;
    });
  }

  /** Emits intermediate points on segment i-1 → i when it is long and passes near the circle. */
  private static resampleNear(
    a: Float32Array,
    i: number,
    cx: number,
    cy: number,
    rr: number,
    step: number,
    push: (x: number, y: number, p: number) => void,
  ): void {
    const x = a[i * 3] ?? 0;
    const y = a[i * 3 + 1] ?? 0;
    const p = a[i * 3 + 2] ?? 0;
    const px = a[i * 3 - 3] ?? 0;
    const py = a[i * 3 - 2] ?? 0;
    const pp = a[i * 3 - 1] ?? 0;
    const len = Math.hypot(x - px, y - py);
    if (len <= step || StrokeGeometry.distToSegment(cx, cy, px, py, x, y) > rr + step) return;
    const k = Math.ceil(len / step);
    for (let j = 1; j < k; j++)
      push(px + ((x - px) * j) / k, py + ((y - py) * j) / k, pp + ((p - pp) * j) / k);
  }

  /** A stroke counts as lassoed when at least half of up to ~24 sampled points are inside. */
  static insideLasso(stroke: Stroke, poly: ArrayLike<number>): boolean {
    const n = stroke.p.length / 3;
    const step = Math.max(1, Math.floor(n / 24));
    let inside = 0;
    let total = 0;
    for (let i = 0; i < n; i += step) {
      total++;
      if (StrokeGeometry.pointInPolygon(stroke.p[i * 3] ?? 0, stroke.p[i * 3 + 1] ?? 0, poly)) inside++;
    }
    return total > 0 && inside / total >= 0.5;
  }

  /**
   * Decides whether a hand-drawn line is straight enough to snap: at least 4 points, at least
   * 60 screen px long, and no point further than 13 % of the length from the chord.
   * Returns the average pressure to use for the straight line, or null.
   */
  static straightLinePressure(points: ArrayLike<number>, zoom: number): number | null {
    const n = points.length / 3;
    if (n < 4) return null;
    const x0 = points[0] ?? 0;
    const y0 = points[1] ?? 0;
    const x1 = points[points.length - 3] ?? 0;
    const y1 = points[points.length - 2] ?? 0;
    const length = Math.hypot(x1 - x0, y1 - y0);
    if (length * zoom < 60) return null;
    let maxDist = 0;
    let pressure = 0;
    for (let i = 0; i < n; i++) {
      const px = points[i * 3] ?? 0;
      const py = points[i * 3 + 1] ?? 0;
      const d = Math.abs((x1 - x0) * (y0 - py) - (x0 - px) * (y1 - y0)) / length;
      if (d > maxDist) maxDist = d;
      pressure += points[i * 3 + 2] ?? 0;
    }
    return maxDist / length > 0.13 ? null : pressure / n;
  }

  /** A straight line from an anchor to (x1, y1) as 11 evenly spaced points with constant pressure. */
  static line(ax: number, ay: number, pressure: number, x1: number, y1: number): number[] {
    const steps = 10;
    const out: number[] = [];
    for (let i = 0; i <= steps; i++)
      out.push(ax + ((x1 - ax) * i) / steps, ay + ((y1 - ay) * i) / steps, pressure);
    return out;
  }
}
