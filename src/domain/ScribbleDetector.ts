import { SCRATCH_MIN_POINTS, SCRATCH_MIN_SWING } from '../core/constants';
import type { ScratchThresholds } from '../core/types';

/** What the shape of a stroke measures, shown by the input diagnostics to tune on a real tablet. */
export interface ScribbleMetrics {
  /** Points left after dropping those too close together to mean anything. */
  points: number;
  /** The longer side of the box along and across the direction of motion. */
  extent: number;
  /** Times the pen went back over at least half of the stroke's extent along its axis. */
  reversals: number;
  /** Length of the path per unit of its box: back-and-forth motion packs a lot of path in. */
  density: number;
  /** Sideways advance per leg, per unit of leg length: small when the legs lie close together. */
  pitch: number;
  /** Net turning per unit of total turning: 0 for a zigzag, near 1 for a coil. */
  winding: number;
}

/** Points closer than this share of the stroke's diagonal are hand tremor, not direction. */
const RESAMPLE_SHARE = 0.015;
const NO_SHAPE: ScribbleMetrics = { points: 0, extent: 0, reversals: 0, density: 0, pitch: 0, winding: 0 };

interface Path {
  xs: number[];
  ys: number[];
  length: number;
}

/**
 * Tells a scribble from ordinary writing by geometry alone, with no handwriting recognition. Pure.
 *
 * Each measure rules out something that the others let through:
 * - reversals count only a retreat over half of the extent, so "zzz" has none: each z goes back
 *   over only its own width;
 * - the axis comes from the direction of motion, not from the outline, so a tight zigzag up and
 *   down across a wide word still has its reversals counted;
 * - pitch rules out "www", "mmm" and "ш": they also go up and down, but each leg moves on visibly;
 * - winding rules out circling a word several times, which reverses as often as a scribble but
 *   always turns the same way.
 */
export class ScribbleDetector {
  /** Measures a stroke given as x, y, pressure triples. */
  static measure(points: ArrayLike<number>): ScribbleMetrics {
    const path = ScribbleDetector.resampled(points);
    const count = path.xs.length;
    if (count < 3) return { ...NO_SHAPE, points: count };
    const angle = ScribbleDetector.motionAxis(path);
    const along = path.xs.map((x, i) => x * Math.cos(angle) + (path.ys[i] ?? 0) * Math.sin(angle));
    const across = path.xs.map((x, i) => (path.ys[i] ?? 0) * Math.cos(angle) - x * Math.sin(angle));
    const alongExtent = Math.max(...along) - Math.min(...along);
    const acrossExtent = Math.max(...across) - Math.min(...across);
    const extent = Math.max(alongExtent, acrossExtent);
    if (!alongExtent) return { ...NO_SHAPE, points: count, extent };
    const reversals = ScribbleDetector.reversals(along, alongExtent * SCRATCH_MIN_SWING);
    return {
      points: count,
      extent,
      reversals,
      density: path.length / (alongExtent + acrossExtent),
      pitch: acrossExtent / ((reversals + 1) * alongExtent),
      winding: ScribbleDetector.winding(path),
    };
  }

  /**
   * Whether measures describe a scribble.
   * @param minExtent the smallest size that counts, in the stroke's units: below it there is only
   *   hand tremor, and how small that is on the page depends on the zoom
   */
  static isScribble(metrics: ScribbleMetrics, limits: ScratchThresholds, minExtent: number): boolean {
    return (
      metrics.points >= SCRATCH_MIN_POINTS &&
      metrics.extent >= minExtent &&
      metrics.reversals >= limits.minReversals &&
      metrics.density >= limits.minDensity &&
      metrics.pitch <= limits.maxPitch &&
      metrics.winding <= limits.maxWinding
    );
  }

  private static resampled(points: ArrayLike<number>): Path {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let i = 0; i + 2 < points.length; i += 3) {
      const x = points[i] ?? 0;
      const y = points[i + 1] ?? 0;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
    const step = Math.hypot(x1 - x0, y1 - y0) * RESAMPLE_SHARE;
    const path: Path = { xs: [], ys: [], length: 0 };
    for (let i = 0; i + 2 < points.length; i += 3) {
      const x = points[i] ?? 0;
      const y = points[i + 1] ?? 0;
      const n = path.xs.length;
      const gap = n ? Math.hypot(x - (path.xs[n - 1] ?? 0), y - (path.ys[n - 1] ?? 0)) : Infinity;
      if (gap < step || gap === 0) continue;
      if (n) path.length += gap;
      path.xs.push(x);
      path.ys.push(y);
    }
    return path;
  }

  /** The line the segments run along, whichever way each goes; doubling the angle makes it so. */
  private static motionAxis(path: Path): number {
    let cos2 = 0;
    let sin2 = 0;
    for (let i = 1; i < path.xs.length; i++) {
      const dx = (path.xs[i] ?? 0) - (path.xs[i - 1] ?? 0);
      const dy = (path.ys[i] ?? 0) - (path.ys[i - 1] ?? 0);
      const length = Math.hypot(dx, dy);
      if (!length) continue;
      cos2 += (dx * dx - dy * dy) / length;
      sin2 += (2 * dx * dy) / length;
    }
    return Math.atan2(sin2, cos2) / 2;
  }

  private static reversals(along: readonly number[], swing: number): number {
    let count = 0;
    let direction = 0;
    let low = along[0] ?? 0;
    let high = low;
    for (const value of along) {
      low = Math.min(low, value);
      high = Math.max(high, value);
      if (direction >= 0 && high - value >= swing) {
        if (direction > 0) count++;
        direction = -1;
        low = value;
      } else if (direction <= 0 && value - low >= swing) {
        if (direction < 0) count++;
        direction = 1;
        high = value;
      }
    }
    return count;
  }

  private static winding(path: Path): number {
    let net = 0;
    let total = 0;
    for (let i = 2; i < path.xs.length; i++) {
      const ax = (path.xs[i - 1] ?? 0) - (path.xs[i - 2] ?? 0);
      const ay = (path.ys[i - 1] ?? 0) - (path.ys[i - 2] ?? 0);
      const bx = (path.xs[i] ?? 0) - (path.xs[i - 1] ?? 0);
      const by = (path.ys[i] ?? 0) - (path.ys[i - 1] ?? 0);
      const turn = Math.atan2(ax * by - ay * bx, ax * bx + ay * by);
      net += turn;
      total += Math.abs(turn);
    }
    return total ? Math.abs(net) / total : 0;
  }
}
