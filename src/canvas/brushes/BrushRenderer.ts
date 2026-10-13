import type { StrokeLike } from '../../core/types';
import type { DrawSink } from '../draw/DrawSink';
import type { PathSink, ShapePart } from './PathSink';

/**
 * Base class of the stroke renderers: the five pen brushes and the highlighter. A renderer
 * turns stroke points into paths ({@link shape}, pure geometry) and emits the commands that
 * paint them ({@link paint}). Rendering depends only on the stroke's data and both steps are
 * backend-independent, so a stroke looks the same live, after reload, in page thumbnails, in
 * PNG export and as vector paths in exported PDFs.
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

  /** Emits the commands that paint a stroke's prepared shape: each part filled in the ink colour. */
  paint<P extends PathSink>(sink: DrawSink<P>, stroke: StrokeLike, parts: readonly ShapePart<P>[]): void {
    for (const part of parts) sink.fillPath(part.path, { color: stroke.c, alpha: part.alpha });
  }
}
