import type { StrokeLike } from '../../core/types';
import { BrushRenderer } from './BrushRenderer';
import { Outline } from './Outline';
import type { PathSink, ShapePart } from './PathSink';
import type { PencilGrain } from './PencilGrain';

/** Opacity at zero pressure … */
const ALPHA_MIN = 0.45;
/** … plus this much at full pressure. */
const ALPHA_RANGE = 0.5;
/** Opacity is rounded to steps of this size; each run of equal opacity is one path. */
const ALPHA_STEP = 0.05;

/**
 * A graphite pencil: thin, slightly transparent, with a paper grain. Pressure changes the
 * opacity much more than the width. The stroke is split into bands of equal opacity that share
 * their boundary edges, so a harder press darkens the line without overlapping seams.
 */
export class PencilBrush extends BrushRenderer {
  constructor(private readonly grain: PencilGrain) {
    super();
  }

  /** Opacity for a pressure, rounded to {@link ALPHA_STEP}. */
  static alpha(pressure: number): number {
    const raw = ALPHA_MIN + ALPHA_RANGE * Math.min(1, Math.max(0, pressure));
    return Math.round(raw / ALPHA_STEP) * ALPHA_STEP;
  }

  halfWidth(size: number, pressure: number): number {
    return size * (0.36 + 0.14 * pressure);
  }

  shape<P extends PathSink>(points: ArrayLike<number>, size: number, newPath: () => P): ShapePart<P>[] {
    const n = Math.floor(points.length / 3);
    if (!n) return [];
    const halfWidths: number[] = [];
    for (let i = 0; i < n; i++) halfWidths.push(this.halfWidth(size, points[i * 3 + 2] ?? 0));
    if (n === 1) {
      const path = newPath();
      Outline.dot(path, points[0] ?? 0, points[1] ?? 0, halfWidths[0] ?? 0);
      return [{ path, alpha: PencilBrush.alpha(points[2] ?? 0) }];
    }
    const ribbon = Outline.ribbon(points, halfWidths);
    return PencilBrush.bands(points, n).map(({ from, to, alpha }) => {
      const path = newPath();
      Outline.traceBand(path, points, halfWidths, ribbon, from, to);
      return { path, alpha };
    });
  }

  /** Runs of segments with equal opacity (a segment's pressure is the mean of its two ends). */
  static bands(points: ArrayLike<number>, n: number): { from: number; to: number; alpha: number }[] {
    const out: { from: number; to: number; alpha: number }[] = [];
    for (let i = 0; i < n - 1; i++) {
      const alpha = PencilBrush.alpha(((points[i * 3 + 2] ?? 0) + (points[i * 3 + 5] ?? 0)) / 2);
      const last = out[out.length - 1];
      if (last && Math.abs(last.alpha - alpha) < 1e-9) last.to = i + 1;
      else out.push({ from: i, to: i + 1, alpha });
    }
    return out;
  }

  /** Fills each band with the grain pattern in the stroke colour. */
  override draw(
    ctx: CanvasRenderingContext2D,
    stroke: StrokeLike,
    parts: readonly ShapePart<Path2D>[],
  ): void {
    const base = ctx.globalAlpha;
    ctx.save();
    ctx.fillStyle = this.grain.patternFor(ctx, stroke.c) ?? stroke.c;
    for (const part of parts) {
      ctx.globalAlpha = base * part.alpha;
      ctx.fill(part.path);
    }
    ctx.restore();
  }
}
