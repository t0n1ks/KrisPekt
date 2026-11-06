import { PAPER, TAP_SLOP_PX } from '../core/constants';
import type { Page, Point, ToolKind } from '../core/types';
import { el } from '../core/utils/dom';
import type { LiveLayer } from '../canvas/LiveLayer';
import { HandRules, type HandObject, type HandTarget } from '../domain/HandRules';
import { Tool } from './Tool';

type HandOperation =
  | { kind: 'pan'; start: Point; moved: boolean }
  | { kind: 'grab'; page: Page; id: string; start: Point }
  | { kind: 'move'; start: Point }
  | { kind: 'scale'; start: Point };

/**
 * For reading and arranging: scrolls the page, opens what is tapped (through the press targets,
 * before a press reaches this tool), and selects and moves text boxes, photos and cards, with the
 * selection and its frame as the lasso has them.
 *
 * It never draws or erases, and finger drawing makes no difference to it. The one exception is the
 * eraser end or button of a stylus, which erases with any tool while pressed (see `ToolManager`).
 */
export class HandTool extends Tool {
  readonly kind: ToolKind = 'hand';
  private op: HandOperation | null = null;
  private held: { page: Page; id: string } | null = null;

  override get cursorClass(): string {
    return 'stage__canvas--grab';
  }

  override get navigates(): boolean {
    return true;
  }

  override acceptsTouchAt(pt: Point): boolean {
    return this.ctx.selection.hit(pt) !== null;
  }

  override holdableAt(pt: Point): boolean {
    return HandRules.press('touch', this.targetAt(pt)) === 'hold';
  }

  /** Outlines the object a finger is about to pick up, so the hold can be seen to have worked. */
  override showHold(pt: Point | null): void {
    const found = pt && this.objectAt(pt);
    this.held = found ? { page: found.page, id: found.object.id } : null;
    this.ctx.requestLive();
  }

  onPointerDown(e: PointerEvent, pt: Point): void {
    this.startOperation(e);
    const press = HandRules.press(e.pointerType, this.targetAt(pt));
    const found = this.objectAt(pt);
    if (press === 'scale' || press === 'move') this.op = { kind: press, start: pt };
    else if (press !== 'pan' && found) {
      this.op = { kind: 'grab', page: found.page, id: found.object.id, start: pt };
    } else {
      this.op = { kind: 'pan', start: pt, moved: false };
      this.ctx.pan.begin(e.pointerId, pt);
    }
  }

  override onPointerMove(e: PointerEvent): void {
    const op = this.op;
    if (!op) return;
    const { camera, selection } = this.ctx;
    const pt = camera.toLocal(e.clientX, e.clientY);
    const dx = pt.x - op.start.x;
    const dy = pt.y - op.start.y;
    if (op.kind === 'pan') {
      op.moved ||= Math.hypot(dx, dy) > TAP_SLOP_PX;
      this.ctx.pan.move(e.pointerId, pt);
      return;
    }
    if (op.kind === 'grab') {
      if (Math.hypot(dx, dy) <= TAP_SLOP_PX) return;
      this.select(op.page, op.id);
      this.op = { kind: 'move', start: op.start };
    }
    if (op.kind === 'scale') selection.setScaleFromDrag(dx, dy);
    else selection.setOffset(dx / camera.z, dy / camera.z);
    this.ctx.requestLive();
    this.ctx.requestRender();
  }

  override onPointerUp(e: PointerEvent): void {
    this.finish(e.pointerId);
  }

  override onPointerCancel(): void {
    const op = this.op;
    if (op?.kind === 'pan') this.ctx.pan.stop();
    if (op?.kind === 'move' || op?.kind === 'scale') this.ctx.selection.resetTransform();
    this.op = null;
    this.endOperation();
    this.ctx.requestLive();
  }

  /** A second finger finishes a move or a resize; it is then the page's, for a pinch. */
  override onInterrupt(): void {
    const id = this.activePointer;
    if (id !== null && (this.op?.kind === 'move' || this.op?.kind === 'scale')) this.finish(id);
    else this.onPointerCancel();
  }

  /** A short tap of a finger that nothing else took. */
  override onTap(pt: Point): void {
    const target = this.targetAt(pt);
    const tap = HandRules.tap(target);
    if (tap === 'deselect') this.ctx.selection.clear();
    if (tap !== 'select') return;
    const found = this.objectAt(pt);
    if (found) this.select(found.page, found.object.id);
  }

  override renderOverlay(ctx: CanvasRenderingContext2D, live: LiveLayer): void {
    const held = this.held;
    if (!held) return;
    const box = this.ctx.selection.itemBox(held.page, held.id);
    if (!box) return;
    live.usePageSpace(ctx, held.page);
    const unit = live.dpr / live.scale;
    ctx.setLineDash([6 * unit, 4 * unit]);
    ctx.lineWidth = 1.5 * unit;
    ctx.strokeStyle = PAPER.ui;
    ctx.strokeRect(box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0);
    ctx.setLineDash([]);
  }

  createOptionsPanel(): HTMLElement {
    const { i18n } = this.ctx;
    return el(
      'div',
      { class: 'popover__content' },
      el('h3', { class: 'popover__title' }, i18n.t('hand')),
      el('p', { class: 'hint' }, i18n.t('handHint')),
    );
  }

  private finish(pointerId: number): void {
    const op = this.op;
    this.op = null;
    this.endOperation();
    if (!op) return;
    if (op.kind === 'pan') {
      this.ctx.pan.release(pointerId);
      if (!op.moved) this.ctx.selection.clear();
    } else if (op.kind === 'grab') this.select(op.page, op.id);
    else this.ctx.selection.apply();
    this.ctx.requestLive();
    this.ctx.requestRender();
  }

  private select(page: Page, id: string): void {
    this.held = null;
    this.ctx.selection.set(page, new Set([id]));
  }

  private targetAt(pt: Point): HandTarget {
    const hit = this.ctx.selection.hit(pt);
    if (hit === 'handle') return 'handle';
    if (hit === 'inside') return 'selection';
    return this.objectAt(pt) ? 'object' : 'empty';
  }

  private objectAt(pt: Point): { page: Page; object: HandObject } | null {
    const { camera, layout, texts } = this.ctx;
    const world = camera.toWorld(pt.x, pt.y);
    const page = layout.pageAt(world.x, world.y);
    if (!page) return null;
    const local = layout.toPage(page, world);
    const object = HandRules.objectAt(page, local.x, local.y, (item) => texts.contentBox(item));
    return object && { page, object };
  }
}
