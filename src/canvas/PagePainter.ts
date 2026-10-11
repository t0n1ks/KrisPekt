import { MM, PAPER } from '../core/constants';
import type { Page } from '../core/types';
import type { BitmapCache } from './BitmapCache';
import type { PatternPainter } from './PatternPainter';
import type { StrokePainter } from './StrokePainter';
import type { TextLayout } from './TextLayout';

/** Bitmaps passed in explicitly (for export), instead of the asynchronous cache. */
export type BitmapSource = Map<string, ImageBitmap | null>;

/**
 * Paints a page's content in page-local world px: white paper, the background pattern or
 * PDF page, images, strokes, then text. Items in `skip` (being dragged or edited) are left out
 * because the live layer draws them.
 */
export class PagePainter {
  constructor(
    private readonly patterns: PatternPainter,
    private readonly strokes: StrokePainter,
    private readonly texts: TextLayout,
    private readonly bitmaps: BitmapCache,
  ) {}

  paint(
    ctx: CanvasRenderingContext2D,
    page: Page,
    scale: number,
    skip: ReadonlySet<string> | null = null,
    source?: BitmapSource,
  ): void {
    const pw = page.w * MM;
    const ph = page.h * MM;
    ctx.fillStyle = PAPER.white;
    ctx.fillRect(0, 0, pw, ph);
    const bitmap = (id: string): ImageBitmap | null =>
      source ? (source.get(id) ?? null) : this.bitmaps.get(id);
    if (page.bgBlob) {
      const bm = bitmap(page.bgBlob);
      if (bm) ctx.drawImage(bm, 0, 0, pw, ph);
      else {
        ctx.fillStyle = PAPER.bgPlaceholder;
        ctx.fillRect(0, 0, pw, ph);
      }
    } else this.patterns.draw(ctx, page.bg, pw, ph, scale);
    for (const im of page.images) {
      if (skip?.has(im.id)) continue;
      const bm = bitmap(im.blob);
      if (bm) ctx.drawImage(bm, im.x, im.y, im.w, im.h);
      else {
        ctx.fillStyle = PAPER.imagePlaceholder;
        ctx.fillRect(im.x, im.y, im.w, im.h);
      }
    }
    for (const st of page.strokes) if (!skip?.has(st.id)) this.strokes.draw(ctx, st);
    for (const t of page.texts) if (!skip?.has(t.id)) this.texts.draw(ctx, t);
  }
}
