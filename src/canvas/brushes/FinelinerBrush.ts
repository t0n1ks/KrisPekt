import { BrushRenderer } from './BrushRenderer';
import { Outline } from './Outline';
import type { PathSink, ShapePart } from './PathSink';

/** Share of the nominal size used as the line width (matches a ballpoint at medium pressure). */
const WIDTH_RATIO = 0.8;

/** A technical pen: constant width that ignores pressure, round caps, crisp lines for diagrams. */
export class FinelinerBrush extends BrushRenderer {
  halfWidth(size: number): number {
    return (size * WIDTH_RATIO) / 2;
  }

  shape<P extends PathSink>(points: ArrayLike<number>, size: number, newPath: () => P): ShapePart<P>[] {
    const n = Math.floor(points.length / 3);
    const halfWidths = new Array<number>(n).fill(this.halfWidth(size));
    const path = newPath();
    Outline.traceSmooth(path, points, halfWidths);
    return [{ path, alpha: 1 }];
  }
}
