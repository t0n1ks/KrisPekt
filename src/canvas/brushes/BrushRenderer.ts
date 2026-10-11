import type { StrokeLike } from '../../core/types';
import type { PathSink, ShapePart } from './PathSink';

/**
 * Base class of the stroke renderers: the five pen brushes and the highlighter. A renderer
 * turns stroke points into paths ({@link shape}, pure geometry) and paints them ({@link draw}).
 * Rendering depends only on the stroke's data, so a stroke looks the same live, after reload,
 * in page thumbnails and in exported PDFs.
 */
export abstract class BrushRenderer {
  /**
   * The stroke's shape as one or more path parts. Pure: `newPath` creates the sink for each
   * part (a Path2D when drawing, a recorder in tests). `points` is `[x, y, pressure, …]`.
   */
  abstract shape<P extends PathSink>(
    points: ArrayLike<number>,
    size: number,
    newPath: () => P,
  ): ShapePart<P>[];

  /** Half the stroke width at a pressure, ignoring end tapers (the widest it can be there). */
  abstract halfWidth(size: number, pressure: number): number;

  /** Padding around the points that contains all ink (bounding boxes, whole-stroke eraser). */
  maxHalfWidth(size: number): number {
    return this.halfWidth(size, 1);
  }

  /**
   * How far beyond the eraser circle a point is still erased. A little less than the half width,
   * so the pixel eraser cuts where the ink visibly ends rather than at the centre line.
   */
  eraseMargin(size: number, pressure: number): number {
    return this.halfWidth(size, pressure) * 0.7;
  }

  /** The shape as Path2D objects, ready to cache and draw. */
  buildPath(points: ArrayLike<number>, size: number): ShapePart<Path2D>[] {
    return this.shape(points, size, () => new Path2D());
  }

  /** Paints a stroke's prepared shape in the current transform. */
  draw(ctx: CanvasRenderingContext2D, stroke: StrokeLike, parts: readonly ShapePart<Path2D>[]): void {
    const base = ctx.globalAlpha;
    ctx.save();
    ctx.fillStyle = stroke.c;
    for (const part of parts) {
      ctx.globalAlpha = base * part.alpha;
      ctx.fill(part.path);
    }
    ctx.restore();
  }
}
