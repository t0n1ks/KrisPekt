import { MM, PAPER } from '../core/constants';
import type { EraserMode, Point, Stroke, ToolKind } from '../core/types';
import { el } from '../core/utils/dom';
import type { LiveLayer } from '../canvas/LiveLayer';
import { StrokeGeometry } from '../canvas/StrokeGeometry';
import { EraserModes } from '../domain/EraserModes';
import { icon } from '../ui/icons';
import { Segmented } from '../ui/widgets/Segmented';
import { Tool } from './Tool';

/**
 * Eraser with two modes: the pixel eraser cuts away the part of strokes under the cursor, the
 * stroke eraser removes whole strokes it touches. Both use each brush's real ink width. Each
 * page touched during one drag gets a single undo step.
 */
export class EraserTool extends Tool {
  readonly kind: ToolKind = 'eraser';
  private cursor: Point | null = null;
  private touchedPages = new Set<string>();

  onPointerDown(e: PointerEvent, pt: Point): void {
    this.startOperation(e);
    this.touchedPages = new Set();
    this.cursor = pt;
    this.eraseAt(pt);
    this.ctx.requestLive();
  }

  override onPointerMove(e: PointerEvent): void {
    const { camera } = this.ctx;
    const events = e.getCoalescedEvents?.() ?? [];
    for (const ev of events.length ? events : [e]) this.eraseAt(camera.toLocal(ev.clientX, ev.clientY));
    this.cursor = camera.toLocal(e.clientX, e.clientY);
    this.ctx.requestLive();
  }

  override onPointerUp(): void {
    this.stop();
  }

  override onPointerCancel(): void {
    this.stop();
  }

  /** A second finger ends the erase (what was erased stays erased). */
  override onInterrupt(): void {
    this.stop();
  }

  private stop(): void {
    this.cursor = null;
    this.endOperation();
    this.ctx.requestLive();
  }

  /** Erases around a stage point on every page within reach. */
  private eraseAt(pt: Point): void {
    const { camera, layout, session, prefs } = this.ctx;
    const w = camera.toWorld(pt.x, pt.y);
    const r = prefs.er.r / camera.z;
    for (const page of session.pages) {
      const o = layout.pos(page);
      if (w.x < o.x - r || w.x > o.x + page.w * MM + r || w.y < o.y - r || w.y > o.y + page.h * MM + r)
        continue;
      const kept = this.eraseStrokes(page.strokes, w.x - o.x, w.y - o.y, r, prefs.er.mode);
      if (!kept) continue;
      if (!this.touchedPages.has(page.id)) {
        this.touchedPages.add(page.id);
        this.ctx.recordUndo(page);
      }
      page.strokes = kept;
      session.touch(page);
    }
  }

  /** The strokes that remain after erasing at (x, y), or null if nothing changed. */
  private eraseStrokes(
    strokes: Stroke[],
    x: number,
    y: number,
    r: number,
    mode: EraserMode,
  ): Stroke[] | null {
    let out: Stroke[] | null = null;
    for (let i = 0; i < strokes.length; i++) {
      const st = strokes[i];
      if (!st) continue;
      const b = this.ctx.geometry.bbox(st);
      if (x < b.x0 - r || x > b.x1 + r || y < b.y0 - r || y > b.y1 + r) {
        out?.push(st);
        continue;
      }
      const brush = this.ctx.brushes.forStroke(st);
      if (mode === 'whole') {
        if (StrokeGeometry.hit(st, x, y, r, brush.maxHalfWidth(st.s))) out ??= strokes.slice(0, i);
        else out?.push(st);
        continue;
      }
      const margin = (pressure: number): number => brush.eraseMargin(st.s, pressure);
      const parts = StrokeGeometry.split(st, x, y, r, this.ctx.makeId, margin);
      if (parts) {
        out ??= strokes.slice(0, i);
        out.push(...parts);
      } else out?.push(st);
    }
    return out;
  }

  /** The eraser circle under the pointer. */
  override renderOverlay(ctx: CanvasRenderingContext2D, live: LiveLayer): void {
    if (!this.cursor) return;
    live.useScreenSpace(ctx);
    ctx.beginPath();
    ctx.arc(this.cursor.x, this.cursor.y, this.ctx.prefs.er.r, 0, Math.PI * 2);
    ctx.fillStyle = PAPER.eraserFill;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = PAPER.eraserRing;
    ctx.stroke();
  }

  /** Tapping the active eraser switches between the pixel and the stroke eraser. */
  override onActiveTap(): boolean {
    const { prefs, i18n } = this.ctx;
    prefs.er.mode = EraserModes.toggle(prefs.er.mode);
    this.ctx.savePrefs();
    this.ctx.refreshTray();
    this.ctx.toast(i18n.t(prefs.er.mode === 'part' ? 'erasePart' : 'eraseWhole'), 1400);
    return true;
  }

  createOptionsPanel(): HTMLElement {
    const { i18n, prefs } = this.ctx;
    const range = el('input', {
      attrs: {
        type: 'range',
        id: 'opt-er',
        min: '6',
        max: '60',
        step: '1',
        value: String(prefs.er.r),
        'aria-label': i18n.t('eraserSize'),
      },
    });
    range.addEventListener('input', () => {
      prefs.er.r = Number(range.value);
      this.ctx.savePrefs();
    });
    const mode = new Segmented<EraserMode>(
      [
        { v: 'part', label: i18n.t('erasePart'), icon: icon('eraserPixel', 26) },
        { v: 'whole', label: i18n.t('eraseWhole'), icon: icon('eraserStroke', 26) },
      ],
      prefs.er.mode,
      (v) => {
        prefs.er.mode = v;
        this.ctx.savePrefs();
        this.ctx.refreshTray();
      },
      true,
    );
    const clear = el(
      'button',
      { class: 'btn btn--danger', attrs: { type: 'button' }, on: { click: () => void this.clearPage() } },
      i18n.t('clearPage'),
    );
    return el(
      'div',
      { class: 'popover__content' },
      el('h3', { class: 'popover__title' }, i18n.t('eraser')),
      mode.node,
      el('p', { class: 'hint' }, i18n.t('eraserHint')),
      el('div', { class: 'field' }, el('span', { class: 'field__label' }, i18n.t('size')), range),
      clear,
    );
  }

  /** Clears the current page after confirmation (undoable). */
  private async clearPage(): Promise<void> {
    const { session, i18n } = this.ctx;
    const page = session.currentPage();
    if (!page) return;
    const ok = await this.ctx.confirm(
      i18n.t('clearQ'),
      i18n.t('clearText', { n: session.currentIndex + 1 }),
      i18n.t('clear'),
    );
    if (!ok) return;
    this.ctx.recordUndo(page);
    page.strokes = [];
    page.texts = [];
    page.images = [];
    session.touch(page);
  }
}
