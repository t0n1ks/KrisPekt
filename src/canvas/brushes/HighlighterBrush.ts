import type { StrokeLike } from '../../core/types';
import { BrushRenderer } from './BrushRenderer';
import type { PathSink, ShapePart } from './PathSink';

/**
 * The highlighter: a smoothed centre line stroked wide and translucent with `multiply`, so the
 * ink underneath stays visible.
 */
export class HighlighterBrush extends BrushRenderer {
  halfWidth(size: number): number {
    return size / 2;
  }

  /** The highlighter has always been erased up to its full width. */
  override eraseMargin(size: number): number {
    return size / 2;
  }

  shape<P extends PathSink>(points: ArrayLike<number>, _size: number, newPath: () => P): ShapePart<P>[] {
    const path = newPath();
    const n = Math.floor(points.length / 3);
    if (!n) return [{ path, alpha: 1 }];
    const at = (i: number): number => points[i] ?? 0;
    path.moveTo(at(0), at(1));
    if (n === 1) {
      path.lineTo(at(0) + 0.01, at(1));
      return [{ path, alpha: 1 }];
    }
    for (let i = 1; i < n; i++) {
      const px = at((i - 1) * 3);
      const py = at((i - 1) * 3 + 1);
      path.quadraticCurveTo(px, py, (px + at(i * 3)) / 2, (py + at(i * 3 + 1)) / 2);
    }
    path.lineTo(at((n - 1) * 3), at((n - 1) * 3 + 1));
    return [{ path, alpha: 1 }];
  }

  override draw(
    ctx: CanvasRenderingContext2D,
    stroke: StrokeLike,
    parts: readonly ShapePart<Path2D>[],
  ): void {
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.globalCompositeOperation = 'multiply';
    ctx.strokeStyle = stroke.c;
    ctx.lineWidth = stroke.s;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const part of parts) ctx.stroke(part.path);
    ctx.restore();
  }
}
