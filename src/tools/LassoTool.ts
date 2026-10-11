import { PAPER } from '../core/constants';
import type { Page, Point, ToolKind } from '../core/types';
import { el } from '../core/utils/dom';
import type { LiveLayer } from '../canvas/LiveLayer';
import { StrokeGeometry } from '../canvas/StrokeGeometry';
import { Tool } from './Tool';

type LassoOperation =
  | { kind: 'path'; page: Page; points: number[] }
  | { kind: 'move'; start: Point }
  | { kind: 'scale'; start: Point };

/** A lasso needs at least 4 points (8 numbers) to enclose anything. */
const MIN_LASSO_VALUES = 8;

/**
 * Lasso: draw a loop to select items, drag the selection to move it, drag the round handle
 * to resize it. The transform is previewed on the live layer and applied on release.
 */
export class LassoTool extends Tool {
  readonly kind: ToolKind = 'lasso';
  private op: LassoOperation | null = null;

  override get cursorClass(): string {
    return 'stage__canvas--crosshair';
  }

  /** Fingers may always drag an existing selection, even when finger drawing is off. */
  override acceptsTouchAt(pt: Point): boolean {
    return this.ctx.selection.hit(pt) !== null;
  }

  onPointerDown(e: PointerEvent, pt: Point): void {
    const { selection, camera, layout } = this.ctx;
    const hit = selection.hit(pt);
    if (hit) {
      this.startOperation(e);
      this.op = { kind: hit === 'handle' ? 'scale' : 'move', start: pt };
      return;
    }
    selection.clear();
    const w = camera.toWorld(pt.x, pt.y);
    const page = layout.pageAt(w.x, w.y);
    if (!page) return;
    this.startOperation(e);
    const local = layout.toPage(page, w);
    this.op = { kind: 'path', page, points: [local.x, local.y] };
  }

  override onPointerMove(e: PointerEvent): void {
    const op = this.op;
    if (!op) return;
    const { camera, layout, selection } = this.ctx;
    const pt = camera.toLocal(e.clientX, e.clientY);
    if (op.kind === 'path') {
      const local = layout.toPage(op.page, camera.toWorld(pt.x, pt.y));
      op.points.push(local.x, local.y);
    } else if (op.kind === 'move') {
      selection.setOffset((pt.x - op.start.x) / camera.z, (pt.y - op.start.y) / camera.z);
    } else {
      selection.setScaleFromDrag(pt.x - op.start.x, pt.y - op.start.y);
    }
    this.ctx.requestLive();
    if (op.kind !== 'path') this.ctx.requestRender();
  }

  override onPointerUp(): void {
    const op = this.op;
    this.op = null;
    this.endOperation();
    if (!op) return;
    if (op.kind === 'path') {
      if (op.points.length >= MIN_LASSO_VALUES) this.selectInside(op.page, op.points);
    } else this.ctx.selection.apply();
    this.ctx.requestLive();
    this.ctx.requestRender();
  }

  override onPointerCancel(): void {
    if (this.op && this.op.kind !== 'path') this.ctx.selection.resetTransform();
    this.op = null;
    this.endOperation();
    this.ctx.requestLive();
  }

  /** A second finger finishes a move/resize but cancels a lasso loop. */
  override onInterrupt(): void {
    if (this.op && this.op.kind !== 'path') this.onPointerUp();
    else this.onPointerCancel();
  }

  private selectInside(page: Page, poly: number[]): void {
    const ids = new Set<string>();
    for (const st of page.strokes) if (StrokeGeometry.insideLasso(st, poly)) ids.add(st.id);
    for (const t of page.texts) {
      const b = this.ctx.texts.box(t);
      if (StrokeGeometry.pointInPolygon((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, poly)) ids.add(t.id);
    }
    for (const im of page.images) {
      if (StrokeGeometry.pointInPolygon(im.x + im.w / 2, im.y + im.h / 2, poly)) ids.add(im.id);
    }
    this.ctx.selection.set(page, ids);
  }

  /** The dashed lasso loop being drawn. */
  override renderOverlay(ctx: CanvasRenderingContext2D, live: LiveLayer): void {
    const op = this.op;
    if (op?.kind !== 'path' || op.points.length <= 2) return;
    live.usePageSpace(ctx, op.page);
    const pts = op.points;
    ctx.beginPath();
    ctx.moveTo(pts[0] ?? 0, pts[1] ?? 0);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i] ?? 0, pts[i + 1] ?? 0);
    ctx.closePath();
    ctx.fillStyle = PAPER.lassoFill;
    ctx.fill();
    const unit = live.dpr / live.scale;
    ctx.setLineDash([6 * unit, 5 * unit]);
    ctx.lineWidth = 1.5 * unit;
    ctx.strokeStyle = PAPER.ui;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  createOptionsPanel(): HTMLElement {
    const { i18n } = this.ctx;
    return el(
      'div',
      { class: 'popover__content' },
      el('h3', { class: 'popover__title' }, i18n.t('lasso')),
      el('p', { class: 'hint' }, i18n.t('lassoHint')),
    );
  }
}
