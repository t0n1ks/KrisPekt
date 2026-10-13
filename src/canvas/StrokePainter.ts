import type { Stroke, StrokeLike } from '../core/types';
import type { BrushRegistry } from './brushes/BrushRegistry';
import type { PathSink, ShapePart } from './brushes/PathSink';
import type { PencilGrain } from './brushes/PencilGrain';
import { Canvas2DBackend } from './draw/Canvas2DBackend';
import type { DrawSink } from './draw/DrawSink';

/**
 * Emits strokes with the renderer of their brush (see {@link BrushRegistry}) into any drawing
 * backend. On canvas the Path2D shapes of stored strokes are cached; strokes are immutable, so
 * a changed stroke is a new object.
 */
export class StrokePainter {
  private readonly shapes = new WeakMap<Stroke, ShapePart<Path2D>[]>();
  private readonly backends = new WeakMap<CanvasRenderingContext2D, Canvas2DBackend>();

  constructor(
    private readonly brushes: BrushRegistry,
    private readonly grain: PencilGrain,
  ) {}

  /** The canvas backend for a context, sharing this painter's shape cache and pencil grain. */
  canvasBackend(
    ctx: CanvasRenderingContext2D,
    bitmap?: (blob: string) => ImageBitmap | null,
  ): Canvas2DBackend {
    if (bitmap) return new Canvas2DBackend(ctx, { grain: this.grain, shapes: this.shapes, bitmap });
    let backend = this.backends.get(ctx);
    if (!backend) {
      backend = new Canvas2DBackend(ctx, { grain: this.grain, shapes: this.shapes });
      this.backends.set(ctx, backend);
    }
    return backend;
  }

  /**
   * Emits a stroke into a backend. Stored strokes reuse the backend's cached shape;
   * `noCache` is for in-progress strokes, whose points still change.
   */
  emit<P extends PathSink>(sink: DrawSink<P>, stroke: StrokeLike, noCache = false): void {
    const renderer = this.brushes.forStroke(stroke);
    const cache = noCache ? undefined : sink.shapeCache;
    const key = stroke as Stroke;
    let parts = cache?.get(key);
    if (!parts) {
      parts = renderer.shape(stroke.p, stroke.s, () => sink.newPath());
      cache?.set(key, parts);
    }
    renderer.paint(sink, stroke, parts);
  }

  /** Draws a stroke on a canvas in its current transform. */
  draw(ctx: CanvasRenderingContext2D, stroke: StrokeLike, noCache = false): void {
    this.emit(this.canvasBackend(ctx), stroke, noCache);
  }
}
