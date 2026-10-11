import { MM, PAPER } from '../core/constants';
import type { Background } from '../core/types';

/** 5 mm grid / dot pitch. */
const STEP = 5 * MM;
/** 8 mm ruled line pitch. */
const LINE_STEP = 8 * MM;

/**
 * Draws page backgrounds: grid, grid with a right margin, ruled lines with a left margin,
 * and dots. Fine patterns are skipped when they would be denser than ~3 screen px.
 * Lines are 1 device px wide whatever the zoom (`lw = 1 / scale`).
 */
export class PatternPainter {
  /** Draws `bg` on a page of `pw`×`ph` world px at canvas scale `sc`. */
  draw(ctx: CanvasRenderingContext2D, bg: Background, pw: number, ph: number, sc: number): void {
    const lw = 1 / sc;
    if (bg === 'grid' || bg === 'gridm') this.grid(ctx, bg === 'gridm', pw, ph, sc, lw);
    else if (bg === 'lines') this.lines(ctx, pw, ph, sc, lw);
    else if (bg === 'dots') this.dots(ctx, pw, ph, sc);
  }

  private grid(
    ctx: CanvasRenderingContext2D,
    margin: boolean,
    pw: number,
    ph: number,
    sc: number,
    lw: number,
  ): void {
    if (STEP * sc >= 2.6) {
      ctx.fillStyle = PAPER.grid;
      for (let x = STEP; x < pw - 0.5; x += STEP) ctx.fillRect(x - lw / 2, 0, lw, ph);
      for (let y = STEP; y < ph - 0.5; y += STEP) ctx.fillRect(0, y - lw / 2, pw, lw);
    }
    if (margin) {
      ctx.fillStyle = PAPER.gridMargin;
      ctx.fillRect(pw - 20 * MM - lw * 0.7, 0, Math.max(lw * 1.4, 0.8), ph);
    }
  }

  private lines(ctx: CanvasRenderingContext2D, pw: number, ph: number, sc: number, lw: number): void {
    if (LINE_STEP * sc >= 3) {
      ctx.fillStyle = PAPER.lines;
      for (let y = 22 * MM; y < ph - 6 * MM; y += LINE_STEP) ctx.fillRect(0, y - lw / 2, pw, lw);
    }
    ctx.fillStyle = PAPER.linesMargin;
    ctx.fillRect(25 * MM, 0, Math.max(lw * 1.3, 0.8), ph);
  }

  private dots(ctx: CanvasRenderingContext2D, pw: number, ph: number, sc: number): void {
    if (STEP * sc < 3) return;
    ctx.fillStyle = PAPER.dots;
    const r = Math.max(0.28 * MM, 1.1 / sc);
    for (let y = STEP; y < ph; y += STEP) {
      for (let x = STEP; x < pw; x += STEP) ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
  }
}
