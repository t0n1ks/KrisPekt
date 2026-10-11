import type { Stroke, StrokeKind } from '../core/types';
import { StrokeGeometry } from './StrokeGeometry';

/** Anything drawable as a stroke; in-progress strokes use a plain number array. */
export interface StrokeLike {
  k: StrokeKind;
  c: string;
  s: number;
  p: ArrayLike<number>;
}

/**
 * Turns strokes into Path2D objects and draws them. Pens are a filled variable-width outline
 * (pressure → width) with round caps; highlighters are a translucent centre line drawn with
 * `multiply` so the ink underneath stays visible. Paths of stored strokes are cached.
 */
export class StrokePainter {
  private readonly paths = new WeakMap<Stroke, Path2D>();

  /** Variable-width outline through the points, smoothed with quadratic curves. */
  static outlinePath(a: ArrayLike<number>, size: number): Path2D {
    const path = new Path2D();
    const n = Math.floor(a.length / 3);
    if (!n) return path;
    const at = (i: number): number => a[i] ?? 0;
    if (n === 1) {
      path.arc(at(0), at(1), StrokeGeometry.penWidth(size, at(2)) / 2, 0, Math.PI * 2);
      return path;
    }
    const left: number[] = [];
    const right: number[] = [];
    const angles: number[] = [];
    for (let i = 0; i < n; i++) {
      const i0 = Math.max(0, i - 1);
      const i1 = Math.min(n - 1, i + 1);
      let dx = at(i1 * 3) - at(i0 * 3);
      let dy = at(i1 * 3 + 1) - at(i0 * 3 + 1);
      const d = Math.hypot(dx, dy) || 1;
      dx /= d;
      dy /= d;
      const nx = -dy;
      const ny = dx;
      const hw = StrokeGeometry.penWidth(size, at(i * 3 + 2)) / 2;
      const x = at(i * 3);
      const y = at(i * 3 + 1);
      left.push(x + nx * hw, y + ny * hw);
      right.push(x - nx * hw, y - ny * hw);
      angles.push(Math.atan2(ny, nx));
    }
    StrokePainter.traceOutline(path, a, size, n, left, right, angles);
    return path;
  }

  private static traceOutline(
    path: Path2D,
    a: ArrayLike<number>,
    size: number,
    n: number,
    L: number[],
    R: number[],
    A: number[],
  ): void {
    const at = (arr: ArrayLike<number>, i: number): number => arr[i] ?? 0;
    path.moveTo(at(L, 0), at(L, 1));
    for (let i = 1; i < n; i++) {
      const px = at(L, (i - 1) * 2);
      const py = at(L, (i - 1) * 2 + 1);
      path.quadraticCurveTo(px, py, (px + at(L, i * 2)) / 2, (py + at(L, i * 2 + 1)) / 2);
    }
    path.lineTo(at(L, (n - 1) * 2), at(L, (n - 1) * 2 + 1));
    const endAngle = at(A, n - 1);
    const we = StrokeGeometry.penWidth(size, at(a, (n - 1) * 3 + 2)) / 2;
    path.arc(at(a, (n - 1) * 3), at(a, (n - 1) * 3 + 1), we, endAngle, endAngle - Math.PI, true);
    for (let i = n - 2; i >= 0; i--) {
      const px = at(R, (i + 1) * 2);
      const py = at(R, (i + 1) * 2 + 1);
      path.quadraticCurveTo(px, py, (px + at(R, i * 2)) / 2, (py + at(R, i * 2 + 1)) / 2);
    }
    path.lineTo(at(R, 0), at(R, 1));
    const ws = StrokeGeometry.penWidth(size, at(a, 2)) / 2;
    path.arc(at(a, 0), at(a, 1), ws, at(A, 0) + Math.PI, at(A, 0), true);
    path.closePath();
  }

  /** Smoothed centre line (for highlighters). */
  static centerPath(a: ArrayLike<number>): Path2D {
    const path = new Path2D();
    const n = Math.floor(a.length / 3);
    if (!n) return path;
    const at = (i: number): number => a[i] ?? 0;
    path.moveTo(at(0), at(1));
    if (n === 1) {
      path.lineTo(at(0) + 0.01, at(1));
      return path;
    }
    for (let i = 1; i < n; i++) {
      const px = at((i - 1) * 3);
      const py = at((i - 1) * 3 + 1);
      path.quadraticCurveTo(px, py, (px + at(i * 3)) / 2, (py + at(i * 3 + 1)) / 2);
    }
    path.lineTo(at((n - 1) * 3), at((n - 1) * 3 + 1));
    return path;
  }

  private static build(stroke: StrokeLike): Path2D {
    return stroke.k === 'hl'
      ? StrokePainter.centerPath(stroke.p)
      : StrokePainter.outlinePath(stroke.p, stroke.s);
  }

  /** Path for a stored stroke (cached) or an in-progress one (`noCache`). */
  path(stroke: StrokeLike, noCache = false): Path2D {
    if (noCache) return StrokePainter.build(stroke);
    const key = stroke as Stroke;
    let path = this.paths.get(key);
    if (!path) {
      path = StrokePainter.build(stroke);
      this.paths.set(key, path);
    }
    return path;
  }

  /** Draws a stroke in the current transform. */
  draw(ctx: CanvasRenderingContext2D, stroke: StrokeLike, noCache = false): void {
    const path = this.path(stroke, noCache);
    if (stroke.k === 'hl') {
      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.globalCompositeOperation = 'multiply';
      ctx.strokeStyle = stroke.c;
      ctx.lineWidth = stroke.s;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke(path);
      ctx.restore();
    } else {
      ctx.fillStyle = stroke.c;
      ctx.fill(path);
    }
  }
}
