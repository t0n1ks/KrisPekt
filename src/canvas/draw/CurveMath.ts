import type { Point } from '../../core/types';

/** A cubic Bézier segment from the current point: two control points and the end point. */
export type Cubic = [number, number, number, number, number, number];

/** A canvas arc as cubic Béziers: where it starts and the segments that trace it. */
export interface ArcCubics {
  start: Point;
  segments: Cubic[];
}

const TAU = Math.PI * 2;

/**
 * Curve conversions for backends that only have cubic Béziers (PDF): quadratic curves convert
 * exactly, arcs are split into pieces of at most 90° (error below 0.03 % of the radius).
 */
export class CurveMath {
  /** The exact cubic form of a quadratic curve from `from` through control `cp` to `to`. */
  static quadToCubic(from: Point, cpx: number, cpy: number, x: number, y: number): Cubic {
    return [
      from.x + ((cpx - from.x) * 2) / 3,
      from.y + ((cpy - from.y) * 2) / 3,
      x + ((cpx - x) * 2) / 3,
      y + ((cpy - y) * 2) / 3,
      x,
      y,
    ];
  }

  /**
   * The signed angle a canvas `arc()` sweeps, following the HTML canvas rules: a difference of
   * a full turn or more draws the whole circle, anything else is reduced to less than a turn
   * in the requested direction.
   */
  static sweep(start: number, end: number, ccw: boolean): number {
    if (!ccw && end - start >= TAU) return TAU;
    if (ccw && start - end >= TAU) return -TAU;
    const delta = ccw ? start - end : end - start;
    const reduced = ((delta % TAU) + TAU) % TAU;
    return ccw ? -reduced : reduced;
  }

  /** A canvas arc (centre, radius, angles in canvas coordinates) as cubic segments. */
  static arcToCubics(cx: number, cy: number, r: number, start: number, end: number, ccw: boolean): ArcCubics {
    const sweep = CurveMath.sweep(start, end, ccw);
    const count = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2) - 1e-9));
    const step = sweep / count;
    const k = (4 / 3) * Math.tan(step / 4);
    const segments: Cubic[] = [];
    for (let i = 0; i < count; i++) {
      const a0 = start + step * i;
      const a1 = a0 + step;
      const x0 = cx + r * Math.cos(a0);
      const y0 = cy + r * Math.sin(a0);
      const x1 = cx + r * Math.cos(a1);
      const y1 = cy + r * Math.sin(a1);
      segments.push([
        x0 - k * r * Math.sin(a0),
        y0 + k * r * Math.cos(a0),
        x1 + k * r * Math.sin(a1),
        y1 - k * r * Math.cos(a1),
        x1,
        y1,
      ]);
    }
    return {
      start: { x: cx + r * Math.cos(start), y: cy + r * Math.sin(start) },
      segments: sweep ? segments : [],
    };
  }
}
