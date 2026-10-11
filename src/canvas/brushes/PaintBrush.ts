import { BrushRenderer } from './BrushRenderer';
import { Outline } from './Outline';
import type { PathSink, ShapePart } from './PathSink';

/** Width share at zero pressure (very thin) … */
const MIN_SHARE = 0.08;
/** … plus this much at full pressure (very thick). */
const PRESSURE_SHARE = 1.1;
/** Pressure is raised to this power, so light touches stay thin. */
const PRESSURE_CURVE = 1.6;
/** Soft start and end: the width eases in from this share … */
const TAPER_MIN = 0.1;
/** … over this many stroke sizes of length. */
const TAPER_SIZES = 5;
/** Smoothing passes over positions and pressure (a [1, 2, 1] / 4 kernel each). */
const SMOOTH_PASSES = 2;

/**
 * A soft brush: strong pressure response from very thin to very thick, soft tapered start and
 * end, and extra smoothing of the path and the pressure.
 */
export class PaintBrush extends BrushRenderer {
  halfWidth(size: number, pressure: number): number {
    return (size * (MIN_SHARE + PRESSURE_SHARE * Math.pow(Math.max(0, pressure), PRESSURE_CURVE))) / 2;
  }

  shape<P extends PathSink>(points: ArrayLike<number>, size: number, newPath: () => P): ShapePart<P>[] {
    const smooth = PaintBrush.smooth(points);
    const n = Math.floor(smooth.length / 3);
    const taper = Outline.taper(smooth, size * TAPER_SIZES, TAPER_MIN);
    const halfWidths: number[] = [];
    for (let i = 0; i < n; i++)
      halfWidths.push(this.halfWidth(size, smooth[i * 3 + 2] ?? 0) * (taper[i] ?? 1));
    const path = newPath();
    Outline.traceSmooth(path, smooth, halfWidths);
    return [{ path, alpha: 1 }];
  }

  /** Low-pass filters x, y and pressure; the end points stay where they are. */
  static smooth(points: ArrayLike<number>): number[] {
    let out = Array.from(points);
    const n = Math.floor(out.length / 3);
    if (n < 3) return out;
    for (let pass = 0; pass < SMOOTH_PASSES; pass++) {
      const prev = out;
      out = prev.slice();
      for (let i = 1; i < n - 1; i++) {
        for (let k = 0; k < 3; k++) {
          const at = (j: number): number => prev[j * 3 + k] ?? 0;
          out[i * 3 + k] = (at(i - 1) + 2 * at(i) + at(i + 1)) / 4;
        }
      }
    }
    return out;
  }
}
