import { MM, SCRATCH_FADE_MS } from '../core/constants';
import type { Page, Stroke } from '../core/types';
import type { LaidGlyph } from '../domain/RichTextLayout';
import type { LiveLayer, OverlayPainter } from './LiveLayer';
import type { StrokePainter } from './StrokePainter';
import { TextLayout } from './TextLayout';

interface Fading {
  page: Page;
  strokes: readonly Stroke[];
  glyphs: readonly LaidGlyph[];
  startedAt: number;
}

/**
 * What a scribble just deleted, fading out on the live layer. It is off the page by then, so this
 * is only a picture of it. With reduced motion there is no fade and it is simply gone.
 */
export class ScratchFade implements OverlayPainter {
  private fading: Fading | null = null;

  constructor(
    private readonly painter: StrokePainter,
    private readonly requestLive: () => void,
    private readonly now: () => number = () => performance.now(),
    private readonly reducedMotion: () => boolean = () =>
      matchMedia('(prefers-reduced-motion: reduce)').matches,
  ) {}

  /** Starts fading these out. */
  start(page: Page, strokes: readonly Stroke[], glyphs: readonly LaidGlyph[]): void {
    if (this.reducedMotion()) return;
    this.fading = { page, strokes, glyphs, startedAt: this.now() };
    this.requestLive();
  }

  /** Draws the current frame of the fade, and asks for the next. */
  renderOverlay(ctx: CanvasRenderingContext2D, live: LiveLayer): void {
    const fading = this.fading;
    if (!fading) return;
    const left = 1 - (this.now() - fading.startedAt) / SCRATCH_FADE_MS;
    if (left <= 0) {
      this.fading = null;
      return;
    }
    live.usePageSpace(ctx, fading.page);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, fading.page.w * MM, fading.page.h * MM);
    ctx.clip();
    ctx.globalAlpha = left;
    for (const stroke of fading.strokes) this.painter.draw(ctx, stroke, true);
    ctx.globalAlpha = left;
    ctx.textBaseline = 'alphabetic';
    for (const glyph of fading.glyphs) {
      ctx.font = TextLayout.font(glyph.style.fs, glyph.style.b, glyph.style.i);
      ctx.fillStyle = glyph.style.c;
      ctx.fillText(glyph.text, glyph.x0, glyph.baseline);
    }
    ctx.restore();
    this.requestLive();
  }
}
