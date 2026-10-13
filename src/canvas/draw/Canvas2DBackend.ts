import type { Stroke } from '../../core/types';
import type { ShapePart } from '../brushes/PathSink';
import type { PencilGrain } from '../brushes/PencilGrain';
import { TextLayout } from '../TextLayout';
import type { DrawSink, FillStyle, ImageRun, LineStyle, TextRun } from './DrawSink';

export interface Canvas2DBackendDeps {
  grain: PencilGrain;
  /** Long-lived Path2D shapes of stored strokes. */
  shapes?: WeakMap<Stroke, ShapePart<Path2D>[]>;
  /** A decoded image, or null while it is not available (its placeholder is drawn). */
  bitmap?: (blob: string) => ImageBitmap | null;
}

/**
 * Paints drawing commands on a 2D canvas in its current transform: the screen, page
 * thumbnails, PNG export and raster PDF export. Every command saves and restores the state
 * it changes, so commands can be emitted in any order.
 */
export class Canvas2DBackend implements DrawSink<Path2D> {
  readonly shapeCache?: WeakMap<Stroke, ShapePart<Path2D>[]>;

  constructor(
    private readonly ctx: CanvasRenderingContext2D,
    private readonly deps: Canvas2DBackendDeps,
  ) {
    this.shapeCache = deps.shapes;
  }

  newPath(): Path2D {
    return new Path2D();
  }

  fillPath(path: Path2D, style: FillStyle): void {
    const ctx = this.ctx;
    const base = ctx.globalAlpha;
    ctx.save();
    ctx.fillStyle =
      (style.texture === 'pencil' ? this.deps.grain.patternFor(ctx, style.color) : null) ?? style.color;
    ctx.globalAlpha = base * style.alpha;
    ctx.fill(path);
    ctx.restore();
  }

  strokePath(path: Path2D, style: LineStyle): void {
    const ctx = this.ctx;
    const base = ctx.globalAlpha;
    ctx.save();
    ctx.globalAlpha = base * style.alpha;
    if (style.blend === 'multiply') ctx.globalCompositeOperation = 'multiply';
    ctx.strokeStyle = style.color;
    ctx.lineWidth = style.width;
    ctx.lineCap = style.cap;
    ctx.lineJoin = style.join;
    ctx.stroke(path);
    ctx.restore();
  }

  fillRect(x: number, y: number, w: number, h: number, color: string): void {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(x, y, w, h);
  }

  /** Draws with `fillText` (never as markup). */
  text(run: TextRun): void {
    const ctx = this.ctx;
    ctx.font = TextLayout.font(run.size);
    ctx.fillStyle = run.color;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillText(run.text, run.x, run.top);
  }

  image(run: ImageRun): void {
    const bitmap = this.deps.bitmap?.(run.blob) ?? null;
    if (bitmap) this.ctx.drawImage(bitmap, run.x, run.y, run.w, run.h);
    else this.fillRect(run.x, run.y, run.w, run.h, run.placeholder);
  }
}
