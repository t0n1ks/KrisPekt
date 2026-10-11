import type { Stroke, StrokeLike } from '../core/types';
import type { BrushRegistry } from './brushes/BrushRegistry';
import type { ShapePart } from './brushes/PathSink';

/**
 * Draws strokes with the renderer of their brush (see {@link BrushRegistry}). The paths of
 * stored strokes are cached; strokes are immutable, so a changed stroke is a new object.
 */
export class StrokePainter {
  private readonly shapes = new WeakMap<Stroke, ShapePart<Path2D>[]>();

  constructor(private readonly brushes: BrushRegistry) {}

  /** The prepared shape of a stored stroke (cached) or an in-progress one (`noCache`). */
  private shape(stroke: StrokeLike, noCache: boolean): ShapePart<Path2D>[] {
    const renderer = this.brushes.forStroke(stroke);
    if (noCache) return renderer.buildPath(stroke.p, stroke.s);
    const key = stroke as Stroke;
    let parts = this.shapes.get(key);
    if (!parts) {
      parts = renderer.buildPath(stroke.p, stroke.s);
      this.shapes.set(key, parts);
    }
    return parts;
  }

  /** Draws a stroke in the current transform. */
  draw(ctx: CanvasRenderingContext2D, stroke: StrokeLike, noCache = false): void {
    this.brushes.forStroke(stroke).draw(ctx, stroke, this.shape(stroke, noCache));
  }
}
