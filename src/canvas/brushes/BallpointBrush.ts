import { BrushRenderer } from './BrushRenderer';
import { Outline } from './Outline';
import type { PathSink, ShapePart } from './PathSink';

/**
 * The original pen: a filled outline whose width follows pressure (42 %–120 % of the size),
 * smoothed with quadratic curves and finished with round caps. Every stroke without a brush id
 * is drawn with it, so older notebooks look exactly as before.
 */
export class BallpointBrush extends BrushRenderer {
  /** Ink width at a pressure: from 42 % to 120 % of the nominal size. */
  static width(size: number, pressure: number): number {
    return size * (0.42 + 0.78 * pressure);
  }

  halfWidth(size: number, pressure: number): number {
    return BallpointBrush.width(size, pressure) / 2;
  }

  /** The eraser reach the app has always used for pens. */
  override eraseMargin(size: number): number {
    return size * 0.4;
  }

  shape<P extends PathSink>(points: ArrayLike<number>, size: number, newPath: () => P): ShapePart<P>[] {
    const n = Math.floor(points.length / 3);
    const halfWidths: number[] = [];
    for (let i = 0; i < n; i++) halfWidths.push(this.halfWidth(size, points[i * 3 + 2] ?? 0));
    const path = newPath();
    Outline.traceSmooth(path, points, halfWidths);
    return [{ path, alpha: 1 }];
  }
}
