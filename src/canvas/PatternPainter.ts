import { MM, PAPER } from '../core/constants';
import type { Background } from '../core/types';
import type { DrawSink } from './draw/DrawSink';

/** Where pattern rectangles go: any drawing backend. */
type RectSink = Pick<DrawSink<never>, 'fillRect'>;

/** 5 mm grid / dot pitch. */
const STEP = 5 * MM;
/** 8 mm ruled line pitch. */
const LINE_STEP = 8 * MM;

/**
 * Emits page backgrounds as filled rectangles: grid, grid with a right margin, ruled lines
 * with a left margin, and dots. Fine patterns are skipped when they would be denser than ~3
 * screen px. Lines are 1 device px wide whatever the zoom (`lw = 1 / scale`); vector export
 * passes a fixed scale, which sets its hairline width.
 */
export class PatternPainter {
  /** Draws `bg` on a page of `pw`×`ph` world px at canvas scale `sc`. */
  draw(sink: RectSink, bg: Background, pw: number, ph: number, sc: number): void {
    const lw = 1 / sc;
    if (bg === 'grid' || bg === 'gridm') this.grid(sink, bg === 'gridm', pw, ph, sc, lw);
    else if (bg === 'lines') this.lines(sink, pw, ph, sc, lw);
    else if (bg === 'dots') this.dots(sink, pw, ph, sc);
  }

  private grid(sink: RectSink, margin: boolean, pw: number, ph: number, sc: number, lw: number): void {
    if (STEP * sc >= 2.6) {
      for (let x = STEP; x < pw - 0.5; x += STEP) sink.fillRect(x - lw / 2, 0, lw, ph, PAPER.grid);
      for (let y = STEP; y < ph - 0.5; y += STEP) sink.fillRect(0, y - lw / 2, pw, lw, PAPER.grid);
    }
    if (margin) {
      sink.fillRect(pw - 20 * MM - lw * 0.7, 0, Math.max(lw * 1.4, 0.8), ph, PAPER.gridMargin);
    }
  }

  private lines(sink: RectSink, pw: number, ph: number, sc: number, lw: number): void {
    if (LINE_STEP * sc >= 3) {
      for (let y = 22 * MM; y < ph - 6 * MM; y += LINE_STEP)
        sink.fillRect(0, y - lw / 2, pw, lw, PAPER.lines);
    }
    sink.fillRect(25 * MM, 0, Math.max(lw * 1.3, 0.8), ph, PAPER.linesMargin);
  }

  private dots(sink: RectSink, pw: number, ph: number, sc: number): void {
    if (STEP * sc < 3) return;
    const r = Math.max(0.28 * MM, 1.1 / sc);
    for (let y = STEP; y < ph; y += STEP) {
      for (let x = STEP; x < pw; x += STEP) sink.fillRect(x - r, y - r, r * 2, r * 2, PAPER.dots);
    }
  }
}
