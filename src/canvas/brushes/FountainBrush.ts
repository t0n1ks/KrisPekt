import { BrushRenderer } from './BrushRenderer';
import { Outline } from './Outline';
import type { PathSink, ShapePart } from './PathSink';

/**
 * Direction of the flat nib in canvas coordinates (y points down): 40° above the horizontal,
 * leaning right, as a right-handed writer holds a calligraphy pen.
 */
const NIB_ANGLE = (-40 * Math.PI) / 180;
/** Width share that never goes away, so strokes along the nib stay a visible hairline. */
const HAIRLINE = 0.12;
/** Width share added when the pen moves straight across the nib. */
const NIB = 0.75;
/** Ends narrow to this share of the width … */
const TAPER_MIN = 0.4;
/** … over this many stroke sizes of length. */
const TAPER_SIZES = 3;
/** The direction at a point is averaged over this many neighbours each side, so width changes smoothly. */
const DIRECTION_REACH = 2;

/**
 * A calligraphic fountain pen. Width depends on the angle between the stroke direction and a
 * fixed nib angle (a thin hairline along the nib, a broad line across it) and on pressure.
 * The ends taper slightly.
 */
export class FountainBrush extends BrushRenderer {
  /** Pressure scales the nib between 60 % and 120 %. */
  private static pressureFactor(pressure: number): number {
    return 0.6 + 0.6 * pressure;
  }

  /** Half width for a stroke direction (radians) and pressure, before tapering. */
  static directionalHalfWidth(size: number, pressure: number, direction: number): number {
    const across = Math.abs(Math.sin(direction - NIB_ANGLE));
    return size * (HAIRLINE + NIB * across) * FountainBrush.pressureFactor(pressure);
  }

  halfWidth(size: number, pressure: number): number {
    return size * (HAIRLINE + NIB) * FountainBrush.pressureFactor(pressure);
  }

  shape<P extends PathSink>(points: ArrayLike<number>, size: number, newPath: () => P): ShapePart<P>[] {
    const n = Math.floor(points.length / 3);
    const taper = Outline.taper(points, size * TAPER_SIZES, TAPER_MIN);
    const halfWidths: number[] = [];
    for (let i = 0; i < n; i++) {
      const pressure = points[i * 3 + 2] ?? 0;
      const width =
        n === 1
          ? this.halfWidth(size, pressure) * 0.5
          : FountainBrush.directionalHalfWidth(size, pressure, FountainBrush.direction(points, i, n));
      halfWidths.push(width * (taper[i] ?? 1));
    }
    const path = newPath();
    Outline.traceSmooth(path, points, halfWidths);
    return [{ path, alpha: 1 }];
  }

  /** Direction of travel at point `i`, from neighbours a few points away (0 for a zero-length stretch). */
  private static direction(a: ArrayLike<number>, i: number, n: number): number {
    const i0 = Math.max(0, i - DIRECTION_REACH);
    const i1 = Math.min(n - 1, i + DIRECTION_REACH);
    const dx = (a[i1 * 3] ?? 0) - (a[i0 * 3] ?? 0);
    const dy = (a[i1 * 3 + 1] ?? 0) - (a[i0 * 3 + 1] ?? 0);
    return dx === 0 && dy === 0 ? 0 : Math.atan2(dy, dx);
  }
}
