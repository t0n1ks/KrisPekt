import { TEXT_FONT, TEXT_LINE_HEIGHT } from '../core/constants';
import type { Box, TextItem } from '../core/types';

/** Measures text; a canvas context in the app, a stub in tests. */
export interface TextMeasurer {
  font: string;
  measureText(text: string): { width: number };
}

/**
 * Word-wraps text boxes and draws them. Wrapped lines are cached per item object; the cache
 * is reset when fonts finish loading or the language changes (metrics may differ).
 */
export class TextLayout {
  private cache = new WeakMap<TextItem, string[]>();

  constructor(private readonly measurer: TextMeasurer) {}

  static font(size: number): string {
    return `400 ${size}px ${TEXT_FONT}`;
  }

  /** Forgets every wrapped layout. */
  reset(): void {
    this.cache = new WeakMap();
  }

  /** Lines after wrapping at `item.w`; explicit newlines are kept. */
  lines(item: TextItem): string[] {
    const cached = this.cache.get(item);
    if (cached) return cached;
    this.measurer.font = TextLayout.font(item.fs);
    const out: string[] = [];
    for (const paragraph of String(item.t).split('\n')) {
      let line = '';
      for (const word of paragraph.split(/(\s+)/)) {
        const test = line + word;
        if (line.trim() && this.measurer.measureText(test).width > item.w) {
          out.push(line.replace(/\s+$/, ''));
          line = word.replace(/^\s+/, '');
        } else line = test;
      }
      out.push(line);
    }
    this.cache.set(item, out);
    return out;
  }

  /** Bounding box of a text item in page-local px. */
  box(item: TextItem): Box {
    const n = this.lines(item).length;
    return { x0: item.x, y0: item.y, x1: item.x + item.w, y1: item.y + n * item.fs * TEXT_LINE_HEIGHT };
  }

  /** Draws a text item with `fillText` (never as markup). */
  draw(ctx: CanvasRenderingContext2D, item: TextItem): void {
    ctx.font = TextLayout.font(item.fs);
    ctx.fillStyle = item.c;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    const lh = item.fs * TEXT_LINE_HEIGHT;
    const off = (lh - item.fs) / 2;
    this.lines(item).forEach((line, i) => ctx.fillText(line, item.x, item.y + i * lh + off));
  }
}
