import { TEXT_LINE_HEIGHT } from '../core/constants';
import type { Box, LinkTarget, TextItem } from '../core/types';
import { RichText } from '../domain/RichText';
import { RichTextLayout, type LaidGlyph, type LaidText, type TextMeasurer } from '../domain/RichTextLayout';
import type { TextRun } from './draw/DrawSink';

export type { TextMeasurer };

/** Below the baseline, per unit of font size. */
const UNDERLINE_AT = 0.11;
/** Above the baseline, per unit of font size. */
const STRIKE_AT = 0.27;
const DECORATION_THICKNESS = 0.07;
/** Onest's ascent share of its em box, when the measurer cannot tell. */
const FALLBACK_EM_ASCENT = 970 / 1275;

/** The drawing commands text needs. */
export interface TextSink {
  text(run: TextRun): void;
  fillRect(x: number, y: number, w: number, h: number, color: string): void;
  link?(x: number, y: number, w: number, h: number, target: LinkTarget): void;
}

/**
 * Word-wraps text boxes and positions their lines. Layouts are cached per item object (items are
 * replaced, never changed); the cache is reset when fonts finish loading or the language changes.
 * The screen and every export use the same lines and positions.
 *
 * Two kinds of item exist. An old one, without paragraphs, wraps only at whitespace and keeps its
 * own baseline, so it looks exactly as it did when it was written. A rich one is laid out by
 * {@link RichTextLayout} and matches the editor.
 */
export class TextLayout {
  private cache = new WeakMap<TextItem, string[]>();
  private laidCache = new WeakMap<TextItem, LaidText>();
  private readonly rich: RichTextLayout;

  constructor(private readonly measurer: TextMeasurer) {
    this.rich = new RichTextLayout(measurer);
  }

  static font(size: number, bold = false, italic = false): string {
    return RichTextLayout.font(size, bold, italic);
  }

  /** Forgets every wrapped layout. */
  reset(): void {
    this.cache = new WeakMap();
    this.laidCache = new WeakMap();
    this.rich.reset();
  }

  /** Laid-out lines of a rich item. */
  laid(item: TextItem): LaidText {
    const cached = this.laidCache.get(item);
    if (cached) return cached;
    const laid = this.rich.layout(RichText.paragraphsOf(item), item.w, item);
    this.laidCache.set(item, laid);
    return laid;
  }

  /** The characters of a rich item that can touch a box, in page coordinates. */
  glyphs(item: TextItem, near: Box): LaidGlyph[] {
    const local = {
      x0: near.x0 - item.x,
      y0: near.y0 - item.y,
      x1: near.x1 - item.x,
      y1: near.y1 - item.y,
    };
    return this.rich.glyphs(this.laid(item), local).map((glyph) => ({
      ...glyph,
      x0: glyph.x0 + item.x,
      x1: glyph.x1 + item.x,
      y0: glyph.y0 + item.y,
      y1: glyph.y1 + item.y,
      baseline: glyph.baseline + item.y,
    }));
  }

  /**
   * An old item as a rich one that looks the same: the rich baseline follows the browser's line
   * box, the old one sits a little higher, so the box moves to keep the text where it was.
   */
  migrated(item: TextItem): TextItem {
    if (item.paras) return item;
    const rich: TextItem = { ...item, paras: RichText.paragraphsOf(item) };
    const first = this.laid(rich).lines[0];
    if (!first) return rich;
    this.measurer.font = TextLayout.font(item.fs);
    const m = this.measurer.measureText('H');
    const ascent = m.fontBoundingBoxAscent ?? FALLBACK_EM_ASCENT;
    const share =
      m.fontBoundingBoxDescent === undefined
        ? FALLBACK_EM_ASCENT
        : ascent / (ascent + m.fontBoundingBoxDescent);
    const oldBaseline = (item.fs * TEXT_LINE_HEIGHT - item.fs) / 2 + item.fs * share;
    return { ...rich, y: item.y + oldBaseline - first.baseline };
  }

  /** The width a box needs for its text not to wrap. */
  naturalWidth(item: Pick<TextItem, 't' | 'paras' | 'fs' | 'c'>): number {
    return this.rich.naturalWidth(RichText.paragraphsOf(item), item);
  }

  /** Lines after wrapping at `item.w`; explicit newlines are kept. */
  lines(item: TextItem): string[] {
    if (item.paras) return this.laid(item).lines.map((line) => line.runs.map((r) => r.text).join(''));
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
    const height = item.paras ? this.laid(item).height : this.lines(item).length * item.fs * TEXT_LINE_HEIGHT;
    return { x0: item.x, y0: item.y, x1: item.x + item.w, y1: item.y + height };
  }

  /**
   * The box around the text you can see, in page-local px. It is narrower than {@link box} when
   * the box is wider than its text, which old text items nearly always are.
   */
  contentBox(item: TextItem): Box {
    const box = this.box(item);
    let left = Infinity;
    let right = -Infinity;
    if (item.paras) {
      for (const line of this.laid(item).lines) {
        if (!line.runs.length && !line.marker) continue;
        left = Math.min(left, line.marker ? 0 : line.left);
        right = Math.max(right, line.right);
      }
    } else {
      this.measurer.font = TextLayout.font(item.fs);
      left = 0;
      right = Math.max(0, ...this.lines(item).map((line) => this.measurer.measureText(line).width));
    }
    if (left === Infinity) return box;
    return { x0: item.x + left, y0: box.y0, x1: item.x + right, y1: box.y1 };
  }

  /** The wrapped lines of a text item as runs, each centred vertically in its line box. */
  runs(item: TextItem): TextRun[] {
    if (item.paras) return this.richRuns(item);
    const lh = item.fs * TEXT_LINE_HEIGHT;
    const off = (lh - item.fs) / 2;
    return this.lines(item).map((text, i) => ({
      text,
      x: item.x,
      top: item.y + i * lh + off,
      size: item.fs,
      color: item.c,
    }));
  }

  /** Emits a text item's lines (drawn as text, never as markup). */
  emit(sink: TextSink, item: TextItem): void {
    for (const run of this.runs(item)) sink.text(run);
    if (item.paras) {
      this.emitDecorations(sink, item);
      this.emitLinks(sink, item);
    }
  }

  /** Where a linked word under a page point leads, if there is one. */
  linkAt(item: TextItem, x: number, y: number): LinkTarget | null {
    if (!item.paras) return null;
    const localX = x - item.x;
    const localY = y - item.y;
    for (const line of this.laid(item).lines) {
      if (localY < line.top || localY > line.top + line.height) continue;
      for (const run of line.runs) {
        if (run.style.link && localX >= run.x && localX <= run.x + run.width) return run.style.link;
      }
    }
    return null;
  }

  private emitLinks(sink: TextSink, item: TextItem): void {
    if (!sink.link) return;
    for (const line of this.laid(item).lines) {
      for (const run of line.runs) {
        if (!run.style.link || !run.text.trim()) continue;
        sink.link(item.x + run.x, item.y + line.top, run.width, line.height, run.style.link);
      }
    }
  }

  private richRuns(item: TextItem): TextRun[] {
    const out: TextRun[] = [];
    for (const line of this.laid(item).lines) {
      const baseline = item.y + line.baseline;
      if (line.marker) {
        out.push(TextLayout.run(line.marker.text, item.x, baseline, line.marker.style));
      }
      for (const run of line.runs) out.push(TextLayout.run(run.text, item.x + run.x, baseline, run.style));
    }
    return out;
  }

  private static run(
    text: string,
    x: number,
    baseline: number,
    style: { fs: number; c: string; b: boolean; i: boolean },
  ): TextRun {
    const run: TextRun = { text, x, top: baseline - style.fs, size: style.fs, color: style.c, baseline };
    if (style.b) run.bold = true;
    if (style.i) run.italic = true;
    return run;
  }

  /** Underline and strikethrough as thin rectangles, the same on screen and in every export. */
  private emitDecorations(sink: TextSink, item: TextItem): void {
    for (const line of this.laid(item).lines) {
      const baseline = item.y + line.baseline;
      for (const run of line.runs) {
        const { fs, c, u, s } = run.style;
        if (!run.text.trim() || (!u && !s)) continue;
        const thickness = Math.max(0.5, fs * DECORATION_THICKNESS);
        const x = item.x + run.x;
        if (u) sink.fillRect(x, baseline + fs * UNDERLINE_AT, run.width, thickness, c);
        if (s) sink.fillRect(x, baseline - fs * STRIKE_AT, run.width, thickness, c);
      }
    }
  }
}
