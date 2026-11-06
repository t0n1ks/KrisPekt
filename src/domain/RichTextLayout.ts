import { PAPER, TEXT_FONT, TEXT_LINE_HEIGHT } from '../core/constants';
import type { Box, LinkTarget, TextParagraph, TextSpan } from '../core/types';
import { RichText } from './RichText';

/** Measures text; a canvas context in the app, a stub in tests. */
export interface TextMeasurer {
  font: string;
  measureText(text: string): {
    width: number;
    fontBoundingBoxAscent?: number;
    fontBoundingBoxDescent?: number;
  };
}

/** A run's style with the box's size and colour filled in. */
export interface ResolvedStyle {
  fs: number;
  c: string;
  b: boolean;
  i: boolean;
  u: boolean;
  s: boolean;
  link?: LinkTarget;
}

export interface LaidRun {
  text: string;
  /** From the box's left edge. */
  x: number;
  width: number;
  style: ResolvedStyle;
}

export interface LaidLine {
  /** The offset of the line's first character in the whole text. */
  start: number;
  /** From the box's top edge. */
  top: number;
  height: number;
  baseline: number;
  /** Left edge of the first run and right edge of the last, from the box's left edge. */
  left: number;
  right: number;
  runs: LaidRun[];
  marker: { text: string; style: ResolvedStyle } | null;
}

export interface LaidText {
  lines: LaidLine[];
  height: number;
}

/** One character as drawn. Its box covers the ink rather than the whole height of the line. */
export interface LaidGlyph extends Box {
  /** Characters [start, end) of the whole text: one drawn character can take several. */
  start: number;
  end: number;
  text: string;
  baseline: number;
  style: ResolvedStyle;
}

export interface BoxDefaults {
  fs: number;
  c: string;
  /** A table of contents: every line is a link, so a colour given to one has to show. */
  toc?: boolean | undefined;
}

/** The ink of a character above and below the baseline, per unit of font size. */
const GLYPH_ABOVE = 0.72;
const GLYPH_BELOW = 0.1;
/** Hanging indent of list paragraphs, per unit of font size. */
export const LIST_INDENT_EM = 1.5;
/** Onest's ascent and descent, per unit of font size; when the measurer cannot tell. */
const FALLBACK_ASCENT = 0.97;
const FALLBACK_DESCENT = 0.305;
/** Measured widths kept; a typed text only has so many distinct pieces. */
const WIDTH_CACHE_SIZE = 8000;
const WIDTH_SLACK = 0.01;

const DASHES = '–—';

/**
 * Lays out rich text: wraps paragraphs to a width and positions runs and baselines. It follows
 * the rules the browser uses for the editor (`white-space: pre-wrap; overflow-wrap: anywhere`),
 * so the editor, the canvas and every export break lines in the same places:
 *
 * - lines break after whitespace, hyphens, dashes, slashes, "?", "!" and "…";
 * - a word too long for a whole line breaks between characters;
 * - whitespace at the end of a line takes no room;
 * - a line is as tall as `TEXT_LINE_HEIGHT` times its largest font, with the same rounded font
 *   metrics a browser uses to place baselines.
 */
export class RichTextLayout {
  private readonly widths = new Map<string, number>();
  private readonly metrics = new Map<number, { above: number; below: number }>();

  constructor(private readonly measurer: TextMeasurer) {}

  /** The CSS font of a style. Italic is the browser's slanted Onest: Onest has no italic face. */
  static font(size: number, bold = false, italic = false): string {
    return `${italic ? 'italic ' : ''}${bold ? 700 : 400} ${size}px ${TEXT_FONT}`;
  }

  /** Forgets measurements; for when fonts finish loading. */
  reset(): void {
    this.widths.clear();
    this.metrics.clear();
  }

  /** Lays out paragraphs in a box of this width. */
  layout(paras: readonly TextParagraph[], width: number, base: BoxDefaults): LaidText {
    const numbers = RichText.listNumbers(paras);
    const lines: LaidLine[] = [];
    let top = 0;
    let offset = 0;
    paras.forEach((para, i) => {
      for (const line of this.layoutParagraph(para, numbers[i] ?? 0, width, base, top)) {
        lines.push({ ...line, start: line.start + offset });
        top += line.height;
      }
      offset += para.runs.reduce((sum, run) => sum + run.t.length, 0) + 1;
    });
    return { lines, height: top };
  }

  /**
   * The characters of laid-out text on the lines and runs that can touch a box, from the box's
   * top left corner. They are measured only here, because a long text has many that never can.
   */
  glyphs(laid: LaidText, near: Box): LaidGlyph[] {
    const out: LaidGlyph[] = [];
    for (const line of laid.lines) {
      let offset = line.start;
      for (const run of line.runs) {
        const runStart = offset;
        offset += run.text.length;
        if (line.top > near.y1 || line.top + line.height < near.y0) continue;
        if (run.x > near.x1 || run.x + run.width < near.x0) continue;
        out.push(...this.runGlyphs(run, runStart, line.baseline));
      }
    }
    return out;
  }

  private runGlyphs(run: LaidRun, runStart: number, baseline: number): LaidGlyph[] {
    const out: LaidGlyph[] = [];
    let at = 0;
    for (const text of RichTextLayout.graphemes(run.text)) {
      const end = at + text.length;
      // Up to the end of each character, so that the widths include kerning with what is before.
      const left = this.widthOf(run.text.slice(0, at), run.style);
      const right = this.widthOf(run.text.slice(0, end), run.style);
      out.push({
        start: runStart + at,
        end: runStart + end,
        text,
        baseline,
        style: run.style,
        x0: run.x + left,
        x1: run.x + right,
        y0: baseline - run.style.fs * GLYPH_ABOVE,
        y1: baseline + run.style.fs * GLYPH_BELOW,
      });
      at = end;
    }
    return out;
  }

  /** How wide a box must be for no paragraph to wrap; trailing spaces count, to fit the caret. */
  naturalWidth(paras: readonly TextParagraph[], base: BoxDefaults): number {
    let widest = 0;
    for (const para of paras) {
      const styled = RichTextLayout.styled(para, base);
      let width = RichTextLayout.indent(styled);
      for (const run of styled) width += this.widthOf(run.t, run.style);
      widest = Math.max(widest, width);
    }
    return widest;
  }

  /** Where a line may end: offsets right after each break opportunity, ending at the length. */
  static breakPoints(text: string): number[] {
    const points: number[] = [];
    for (let i = 0; i < text.length - 1; i++) {
      if (RichTextLayout.breaksAfter(text, i)) points.push(i + 1);
    }
    points.push(text.length);
    return points;
  }

  private static breaksAfter(text: string, i: number): boolean {
    const here = text.charAt(i);
    const next = text.charAt(i + 1);
    if (/\s/.test(here)) return !/\s/.test(next);
    if (/\s/.test(next)) return false;
    const previous = i > 0 ? text.charAt(i - 1) : ' ';
    if (DASHES.includes(next) && !DASHES.includes(here)) return next === '—';
    if (here === '-') return !/\s/.test(previous) && !/\d/.test(next);
    if (DASHES.includes(here)) return !DASHES.includes(next);
    if (here === '/') return !/\d/.test(next);
    if ('?!…'.includes(here)) return /\p{L}|\d/u.test(next);
    return false;
  }

  private layoutParagraph(
    para: TextParagraph,
    number: number,
    width: number,
    base: BoxDefaults,
    startTop: number,
  ): LaidLine[] {
    const styled = RichTextLayout.styled(para, base);
    const indent = para.list ? RichTextLayout.indent(styled) : 0;
    const available = Math.max(1, width - indent);
    const text = styled.map((run) => run.t).join('');
    const ranges = this.wrap(text, styled, available);
    let top = startTop;
    return ranges.map(([from, to], index) => {
      const line = this.line(styled, text, from, to, para, indent, available, top);
      if (index === 0 && para.list) {
        const first = styled[0]?.style as ResolvedStyle;
        line.marker = {
          text: para.list === 'bullet' ? '•' : `${number}.`,
          style: { ...first, u: false, s: false },
        };
      }
      top += line.height;
      return line;
    });
  }

  private wrap(text: string, styled: readonly StyledRun[], available: number): [number, number][] {
    const points = RichTextLayout.breakPoints(text);
    const ranges: [number, number][] = [];
    let start = 0;
    let p = 0;
    if (!text) return [[0, 0]];
    while (start < text.length) {
      let end = start;
      while (p < points.length) {
        const point = points[p] as number;
        if (
          point > start &&
          this.widthBetween(styled, text, start, trimmedEnd(text, start, point)) > available + WIDTH_SLACK
        )
          break;
        if (point > start) end = point;
        p++;
      }
      if (end === start) end = this.fitCharacters(styled, text, start, points[p] ?? text.length, available);
      ranges.push([start, end]);
      start = end;
    }
    return ranges;
  }

  /** As many whole characters as fit (at least one) of a word too long for a line. */
  private fitCharacters(
    styled: readonly StyledRun[],
    text: string,
    start: number,
    limit: number,
    available: number,
  ): number {
    let end = start;
    for (const grapheme of RichTextLayout.graphemes(text.slice(start, limit))) {
      const next = end + grapheme.length;
      if (end > start && this.widthBetween(styled, text, start, next) > available + WIDTH_SLACK) break;
      end = next;
    }
    return end;
  }

  private static graphemes(text: string): string[] {
    if (typeof Intl.Segmenter !== 'function') return Array.from(text);
    return Array.from(
      new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text),
      (s) => s.segment,
    );
  }

  private line(
    styled: readonly StyledRun[],
    text: string,
    from: number,
    to: number,
    para: TextParagraph,
    indent: number,
    available: number,
    top: number,
  ): LaidLine {
    const shown = trimmedEnd(text, from, to);
    const pieces = RichTextLayout.slices(styled, from, Math.max(shown, from));
    const sizing = pieces.length ? pieces : RichTextLayout.emptyLineSizing(styled, from);
    let above = 0;
    let below = 0;
    for (const piece of sizing) {
      const m = this.lineMetrics(piece.style);
      above = Math.max(above, m.above);
      below = Math.max(below, m.below);
    }
    const contentWidth = pieces.reduce((sum, piece) => sum + this.widthOf(piece.t, piece.style), 0);
    const shift = RichTextLayout.alignShift(para, available, contentWidth);
    let x = indent + shift;
    const runs: LaidRun[] = pieces.map((piece) => {
      const width = this.widthOf(piece.t, piece.style);
      const run = { text: piece.t, x, width, style: piece.style };
      x += width;
      return run;
    });
    return {
      start: from,
      top,
      height: above + below,
      baseline: top + above,
      left: indent + shift,
      right: x,
      runs,
      marker: null,
    };
  }

  private static alignShift(para: TextParagraph, available: number, width: number): number {
    const free = Math.max(0, available - width);
    if (para.align === 'center') return free / 2;
    return para.align === 'right' ? free : 0;
  }

  /** A line with only spaces (or no text) is as tall as the run it is in. */
  private static emptyLineSizing(styled: readonly StyledRun[], from: number): StyledRun[] {
    let at = 0;
    for (const run of styled) {
      at += run.t.length;
      if (from <= at) return [run];
    }
    return styled.slice(0, 1);
  }

  private static slices(styled: readonly StyledRun[], from: number, to: number): StyledRun[] {
    const out: StyledRun[] = [];
    let at = 0;
    for (const run of styled) {
      const a = Math.max(from - at, 0);
      const b = Math.min(to - at, run.t.length);
      if (b > a) out.push({ t: run.t.slice(a, b), style: run.style });
      at += run.t.length;
    }
    return out;
  }

  private widthBetween(styled: readonly StyledRun[], _text: string, from: number, to: number): number {
    return RichTextLayout.slices(styled, from, to).reduce((sum, p) => sum + this.widthOf(p.t, p.style), 0);
  }

  private widthOf(text: string, style: ResolvedStyle): number {
    if (!text) return 0;
    const font = RichTextLayout.font(style.fs, style.b, style.i);
    const key = font + '|' + text;
    const cached = this.widths.get(key);
    if (cached !== undefined) return cached;
    this.measurer.font = font;
    const width = this.measurer.measureText(text).width;
    if (this.widths.size >= WIDTH_CACHE_SIZE) this.widths.clear();
    this.widths.set(key, width);
    return width;
  }

  /** Room above and below the baseline, as a browser computes it: rounded metrics, half-leading. */
  private lineMetrics(style: ResolvedStyle): { above: number; below: number } {
    const cached = this.metrics.get(style.fs);
    if (cached) return cached;
    this.measurer.font = RichTextLayout.font(style.fs);
    const m = this.measurer.measureText('H');
    const ascent = Math.round(m.fontBoundingBoxAscent ?? style.fs * FALLBACK_ASCENT);
    const descent = Math.round(m.fontBoundingBoxDescent ?? style.fs * FALLBACK_DESCENT);
    const leading = (style.fs * TEXT_LINE_HEIGHT - ascent - descent) / 2;
    const result = { above: ascent + leading, below: descent + leading };
    this.metrics.set(style.fs, result);
    return result;
  }

  private static indent(styled: readonly StyledRun[]): number {
    return styled[0]?.list ? styled[0].style.fs * LIST_INDENT_EM : 0;
  }

  /** A link looks like one, whatever colour the text around it has; only in contents can it differ. */
  static runColor(run: Pick<TextSpan, 'c' | 'link'>, base: BoxDefaults): string {
    if (run.link && !(base.toc && run.c)) return PAPER.link;
    return run.c ?? base.c;
  }

  private static styled(para: TextParagraph, base: BoxDefaults): StyledRun[] {
    const runs: readonly TextSpan[] = para.runs.length ? para.runs : [{ t: '' }];
    return runs.map((run) => ({
      t: run.t,
      list: para.list !== undefined,
      style: {
        fs: run.fs ?? base.fs,
        c: RichTextLayout.runColor(run, base),
        b: run.b === true,
        i: run.i === true,
        u: run.u === true || run.link !== undefined,
        s: run.s === true,
        ...(run.link ? { link: run.link } : {}),
      },
    }));
  }
}

interface StyledRun {
  t: string;
  style: ResolvedStyle;
  list?: boolean;
}

function trimmedEnd(text: string, from: number, to: number): number {
  let end = to;
  while (end > from && /\s/.test(text.charAt(end - 1))) end--;
  return end;
}
