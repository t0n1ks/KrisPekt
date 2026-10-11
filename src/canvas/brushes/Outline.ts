import type { PathSink } from './PathSink';

/** Edge points of a variable-width stroke: `left`/`right` are flat `[x, y, …]`, one pair per point. */
export interface Ribbon {
  left: number[];
  right: number[];
  /** Angle of each point's left normal, used to start the round caps. */
  angles: number[];
}

/**
 * Pure outline geometry shared by the brushes. A stroke is a flat `[x, y, pressure, …]` list;
 * each point gets a half width, and the outline runs along the left edge, around the end, back
 * along the right edge and around the start.
 */
export class Outline {
  /**
   * Offsets every point by its half width along the normal. The direction at a point is taken
   * from the points `reach` steps before and after it; zero-length segments give a zero normal
   * instead of NaN.
   */
  static ribbon(a: ArrayLike<number>, halfWidths: readonly number[], reach = 1): Ribbon {
    const n = Math.floor(a.length / 3);
    const at = (i: number): number => a[i] ?? 0;
    const left: number[] = [];
    const right: number[] = [];
    const angles: number[] = [];
    for (let i = 0; i < n; i++) {
      const i0 = Math.max(0, i - reach);
      const i1 = Math.min(n - 1, i + reach);
      let dx = at(i1 * 3) - at(i0 * 3);
      let dy = at(i1 * 3 + 1) - at(i0 * 3 + 1);
      const d = Math.hypot(dx, dy) || 1;
      dx /= d;
      dy /= d;
      const nx = -dy;
      const ny = dx;
      const hw = halfWidths[i] ?? 0;
      const x = at(i * 3);
      const y = at(i * 3 + 1);
      left.push(x + nx * hw, y + ny * hw);
      right.push(x - nx * hw, y - ny * hw);
      angles.push(Math.atan2(ny, nx));
    }
    return { left, right, angles };
  }

  /** A filled circle (strokes of a single point). */
  static dot(sink: PathSink, x: number, y: number, r: number): void {
    sink.arc(x, y, Math.max(0, r), 0, Math.PI * 2);
  }

  /**
   * The closed outline of a whole stroke with round caps. The edges are smoothed with
   * quadratic curves through the midpoints of consecutive edge points.
   */
  static traceSmooth(sink: PathSink, a: ArrayLike<number>, halfWidths: readonly number[]): void {
    const n = Math.floor(a.length / 3);
    if (!n) return;
    const at = (arr: ArrayLike<number>, i: number): number => arr[i] ?? 0;
    if (n === 1) {
      Outline.dot(sink, at(a, 0), at(a, 1), halfWidths[0] ?? 0);
      return;
    }
    const { left: L, right: R, angles: A } = Outline.ribbon(a, halfWidths);
    sink.moveTo(at(L, 0), at(L, 1));
    for (let i = 1; i < n; i++) {
      const px = at(L, (i - 1) * 2);
      const py = at(L, (i - 1) * 2 + 1);
      sink.quadraticCurveTo(px, py, (px + at(L, i * 2)) / 2, (py + at(L, i * 2 + 1)) / 2);
    }
    sink.lineTo(at(L, (n - 1) * 2), at(L, (n - 1) * 2 + 1));
    const endAngle = at(A, n - 1);
    const we = Math.max(0, halfWidths[n - 1] ?? 0);
    sink.arc(at(a, (n - 1) * 3), at(a, (n - 1) * 3 + 1), we, endAngle, endAngle - Math.PI, true);
    for (let i = n - 2; i >= 0; i--) {
      const px = at(R, (i + 1) * 2);
      const py = at(R, (i + 1) * 2 + 1);
      sink.quadraticCurveTo(px, py, (px + at(R, i * 2)) / 2, (py + at(R, i * 2 + 1)) / 2);
    }
    sink.lineTo(at(R, 0), at(R, 1));
    const ws = Math.max(0, halfWidths[0] ?? 0);
    sink.arc(at(a, 0), at(a, 1), ws, at(A, 0) + Math.PI, at(A, 0), true);
    sink.closePath();
  }

  /**
   * A straight-edged piece of the outline from point `i0` to `i1`. Neighbouring bands share
   * their boundary edge exactly, so they meet without a gap or an overlap. Round caps are
   * added only at the real ends of the stroke.
   */
  static traceBand(
    sink: PathSink,
    a: ArrayLike<number>,
    halfWidths: readonly number[],
    ribbon: Ribbon,
    i0: number,
    i1: number,
  ): void {
    const n = Math.floor(a.length / 3);
    const at = (arr: ArrayLike<number>, i: number): number => arr[i] ?? 0;
    const { left: L, right: R, angles: A } = ribbon;
    sink.moveTo(at(L, i0 * 2), at(L, i0 * 2 + 1));
    for (let i = i0 + 1; i <= i1; i++) sink.lineTo(at(L, i * 2), at(L, i * 2 + 1));
    if (i1 === n - 1) {
      const angle = at(A, i1);
      const r = Math.max(0, halfWidths[i1] ?? 0);
      sink.arc(at(a, i1 * 3), at(a, i1 * 3 + 1), r, angle, angle - Math.PI, true);
    } else sink.lineTo(at(R, i1 * 2), at(R, i1 * 2 + 1));
    for (let i = i1 - 1; i >= i0; i--) sink.lineTo(at(R, i * 2), at(R, i * 2 + 1));
    if (i0 === 0) {
      const r = Math.max(0, halfWidths[0] ?? 0);
      sink.arc(at(a, 0), at(a, 1), r, at(A, 0) + Math.PI, at(A, 0), true);
    }
    sink.closePath();
  }

  /**
   * How much to narrow each point near the ends: 1 in the middle, `minFactor` at the very
   * first and last point, easing in over `length` world px of arc length.
   */
  static taper(a: ArrayLike<number>, length: number, minFactor: number): number[] {
    const n = Math.floor(a.length / 3);
    const fromStart: number[] = [0];
    for (let i = 1; i < n; i++) {
      const step = Math.hypot(
        (a[i * 3] ?? 0) - (a[i * 3 - 3] ?? 0),
        (a[i * 3 + 1] ?? 0) - (a[i * 3 - 2] ?? 0),
      );
      fromStart.push((fromStart[i - 1] ?? 0) + step);
    }
    const total = fromStart[n - 1] ?? 0;
    // Short strokes taper over half their length, so their middle still reaches full width.
    const reach = Math.min(length, total / 2);
    if (!(reach > 1e-6)) return fromStart.map(() => 1);
    return fromStart.map((s) => {
      const t = Math.min(1, Math.min(s, total - s) / reach);
      const eased = t * t * (3 - 2 * t);
      return minFactor + (1 - minFactor) * eased;
    });
  }
}
