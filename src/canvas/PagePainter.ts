import { MM, PAPER } from '../core/constants';
import type { Page, Stroke } from '../core/types';
import type { BitmapCache } from './BitmapCache';
import type { PathSink } from './brushes/PathSink';
import type { DrawSink } from './draw/DrawSink';
import type { PatternPainter } from './PatternPainter';
import type { StrokePainter } from './StrokePainter';
import type { TextLayout } from './TextLayout';

/** Bitmaps passed in explicitly (for export), instead of the asynchronous cache. */
export type BitmapSource = Map<string, ImageBitmap | null>;

/** What to include when a page is emitted. */
export interface SceneOptions {
  /** Canvas scale; sets the width of pattern lines (1 device px) and which patterns show. */
  scale: number;
  /** Items left out because the live layer draws them (being dragged or edited). */
  skip?: ReadonlySet<string> | null;
  /** White paper and the background pattern; off for a transparent PNG. Default on. */
  paper?: boolean;
  /**
   * Highlighter strokes before all other ink. Vector PDF has no multiply blend, so drawing
   * them first keeps ink on top of them, as the multiply blend does on screen.
   */
  highlightersFirst?: boolean;
}

/** Canvas-only extras for {@link PagePainter.paint}. */
export interface PaintOptions {
  /** Bitmaps loaded in advance (export) instead of the asynchronous cache. */
  source?: BitmapSource;
  paper?: boolean;
}

/**
 * Emits a page's content in page-local world px: white paper, the background pattern or PDF
 * page, images, strokes, then text. The same commands drive the screen and every export.
 */
export class PagePainter {
  constructor(
    private readonly patterns: PatternPainter,
    private readonly strokes: StrokePainter,
    private readonly texts: TextLayout,
    private readonly bitmaps: BitmapCache,
  ) {}

  /** Emits a page into any drawing backend. */
  emit<P extends PathSink>(sink: DrawSink<P>, page: Page, options: SceneOptions): void {
    const pw = page.w * MM;
    const ph = page.h * MM;
    const skip = options.skip ?? null;
    const paper = options.paper ?? true;
    if (paper) sink.fillRect(0, 0, pw, ph, PAPER.white);
    if (page.bgBlob)
      sink.image({ blob: page.bgBlob, x: 0, y: 0, w: pw, h: ph, placeholder: PAPER.bgPlaceholder });
    else if (paper) this.patterns.draw(sink, page.bg, pw, ph, options.scale);
    for (const im of page.images) {
      if (skip?.has(im.id)) continue;
      sink.image({ blob: im.blob, x: im.x, y: im.y, w: im.w, h: im.h, placeholder: PAPER.imagePlaceholder });
    }
    for (const st of PagePainter.strokeOrder(page.strokes, options.highlightersFirst ?? false)) {
      if (!skip?.has(st.id)) this.strokes.emit(sink, st);
    }
    for (const t of page.texts) if (!skip?.has(t.id)) this.texts.emit(sink, t);
  }

  /** Paints a page on a canvas in its current transform (screen, thumbnails, PNG and raster PDF). */
  paint(
    ctx: CanvasRenderingContext2D,
    page: Page,
    scale: number,
    skip: ReadonlySet<string> | null = null,
    options: PaintOptions = {},
  ): void {
    const source = options.source;
    const bitmap = (id: string): ImageBitmap | null =>
      source ? (source.get(id) ?? null) : this.bitmaps.get(id);
    this.emit(this.strokes.canvasBackend(ctx, bitmap), page, { scale, skip, paper: options.paper });
  }

  /** Strokes in drawing order: as stored, or highlighters first (keeping their own order). */
  static strokeOrder(strokes: readonly Stroke[], highlightersFirst: boolean): readonly Stroke[] {
    if (!highlightersFirst) return strokes;
    return [...strokes.filter((s) => s.k === 'hl'), ...strokes.filter((s) => s.k !== 'hl')];
  }
}
