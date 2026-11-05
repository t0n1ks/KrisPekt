import { LONG_PRESS_MS } from '../../core/constants';
import type { Point } from '../../core/types';
import { PageGrid, type PageGridShape } from '../../domain/PageGrid';
import { PageOrder } from '../../domain/PageOrder';

export interface PageDragDeps {
  /** The scrolling list of thumbnails. */
  list: HTMLElement;
  /** The bar showing where the page would land. */
  indicator: HTMLElement;
  enabled: () => boolean;
  /** The index of the page whose thumbnail contains this element, or null. */
  indexOf: (target: Element) => number | null;
  /** The grid as it is laid out now. */
  grid: () => PageGridShape;
  /** A new element that looks like a page's thumbnail, to follow the pointer. */
  ghost: (index: number) => HTMLElement;
  /** A page was dropped so that it ends up at index `to`. */
  onDrop: (from: number, to: number) => void;
  /** A long press ended without moving: the page's context menu. */
  onHold: (index: number) => void;
}

interface Press {
  id: number;
  type: string;
  index: number;
  start: Point;
  timer: ReturnType<typeof setTimeout> | undefined;
}

interface Drag {
  ghost: HTMLElement;
  grid: PageGridShape;
  gap: number;
  at: Point;
  moved: boolean;
  frame: number;
}

/** A finger or stylus moving further than this before the long press is scrolling. */
const PRESS_SLOP_PX = 10;
/** A mouse moving further than this picks the page up at once. */
const MOUSE_DRAG_PX = 6;
/** Near this distance from the list's top or bottom the list scrolls by itself. */
const EDGE_PX = 64;
const MAX_SCROLL_PER_FRAME = 14;

/**
 * Reordering thumbnails by dragging. A finger or stylus picks a page up with a long press, because
 * a plain swipe scrolls the list; a mouse picks it up by moving. Dropping outside the list or
 * pressing Escape cancels.
 *
 * Once a touch has started, `touch-action` can no longer stop the browser from scrolling, and
 * a browser that scrolls cancels the pointer. So while dragging, a non-passive `touchmove` listener
 * calls `preventDefault`; that is the only way to keep the pointer events coming.
 */
export class PageDragController {
  private press: Press | null = null;
  private drag: Drag | null = null;
  private swallowClick = false;
  private readonly listeners: [string, EventListener, AddEventListenerOptions?][] = [
    ['pointerdown', (e) => this.onDown(e as PointerEvent)],
    ['pointermove', (e) => this.onMove(e as PointerEvent)],
    ['pointerup', (e) => this.onUp(e as PointerEvent)],
    ['pointercancel', () => this.cancel()],
    ['touchmove', (e) => this.drag && e.preventDefault(), { passive: false }],
    ['contextmenu', (e) => this.press && e.preventDefault()],
    ['click', (e) => this.onClick(e), { capture: true }],
  ];

  constructor(private readonly deps: PageDragDeps) {
    for (const [type, fn, opts] of this.listeners) deps.list.addEventListener(type, fn, opts);
  }

  /** Whether a page is being dragged. */
  get active(): boolean {
    return this.drag !== null;
  }

  /** Drops nothing: the press or drag ends and the page stays where it was. */
  cancel(): void {
    this.endPress();
    const drag = this.drag;
    if (!drag) return;
    this.drag = null;
    cancelAnimationFrame(drag.frame);
    drag.ghost.remove();
    this.deps.indicator.hidden = true;
    this.deps.list.classList.remove('pages-panel__list--dragging');
  }

  /** Removes every listener. */
  destroy(): void {
    this.cancel();
    for (const [type, fn, opts] of this.listeners) this.deps.list.removeEventListener(type, fn, opts);
  }

  private onDown(e: PointerEvent): void {
    this.swallowClick = false;
    if (this.press || this.drag || !this.deps.enabled()) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const index = e.target instanceof Element ? this.deps.indexOf(e.target) : null;
    if (index === null) return;
    const start = { x: e.clientX, y: e.clientY };
    this.press = { id: e.pointerId, type: e.pointerType, index, start, timer: undefined };
    if (e.pointerType !== 'mouse') {
      this.press.timer = setTimeout(() => this.pickUp(start), LONG_PRESS_MS);
    }
  }

  private onMove(e: PointerEvent): void {
    const at = { x: e.clientX, y: e.clientY };
    if (this.drag && this.press?.id === e.pointerId) {
      this.follow(this.drag, this.press, at);
      return;
    }
    const press = this.press;
    if (!press || press.id !== e.pointerId) return;
    const travel = Math.hypot(at.x - press.start.x, at.y - press.start.y);
    if (press.type === 'mouse') {
      if (travel > MOUSE_DRAG_PX) this.pickUp(at);
    } else if (travel > PRESS_SLOP_PX) this.endPress();
  }

  private onUp(e: PointerEvent): void {
    const { press, drag } = this;
    if (!press || press.id !== e.pointerId) return;
    if (!drag) {
      this.endPress();
      return;
    }
    const inside = this.isInside({ x: e.clientX, y: e.clientY });
    const from = press.index;
    const { gap, moved } = drag;
    this.swallowClick = true;
    this.cancel();
    if (!moved) this.deps.onHold(from);
    else if (inside) {
      const to = PageOrder.indexForGap(from, gap);
      if (to !== from) this.deps.onDrop(from, to);
    }
  }

  /** The click that a browser may send after a drag must not open the page. */
  private onClick(e: Event): void {
    if (!this.swallowClick) return;
    this.swallowClick = false;
    e.preventDefault();
    e.stopPropagation();
  }

  private pickUp(at: Point): void {
    const press = this.press;
    if (!press) return;
    clearTimeout(press.timer);
    const { list } = this.deps;
    const grid = this.deps.grid();
    const ghost = this.deps.ghost(press.index);
    document.body.append(ghost);
    list.classList.add('pages-panel__list--dragging');
    try {
      list.setPointerCapture(press.id);
    } catch {
      /* the pointer may already be gone */
    }
    const moved = press.type === 'mouse';
    this.drag = { ghost, grid, gap: press.index, at, moved, frame: 0 };
    this.follow(this.drag, press, at);
    this.drag.frame = requestAnimationFrame(() => this.autoScroll());
  }

  private follow(drag: Drag, press: Press, at: Point): void {
    drag.at = at;
    if (Math.hypot(at.x - press.start.x, at.y - press.start.y) > PRESS_SLOP_PX) drag.moved = true;
    const rect = drag.ghost.getBoundingClientRect();
    drag.ghost.style.transform = `translate(${at.x - rect.width / 2}px, ${at.y - rect.height / 2}px)`;
    this.updateGap(drag);
  }

  private updateGap(drag: Drag): void {
    const { list, indicator } = this.deps;
    const box = list.getBoundingClientRect();
    const x = drag.at.x - box.left + list.scrollLeft;
    const y = drag.at.y - box.top + list.scrollTop;
    drag.gap = PageGrid.gapAt(drag.grid, x, y);
    const position = PageGrid.gapPosition(drag.grid, drag.gap);
    indicator.hidden = !drag.moved || !this.isInside(drag.at);
    indicator.style.transform = `translate(${position.x}px, ${position.y}px)`;
  }

  private autoScroll(): void {
    const drag = this.drag;
    if (!drag) return;
    const { list } = this.deps;
    const box = list.getBoundingClientRect();
    const fromTop = drag.at.y - box.top;
    const fromBottom = box.bottom - drag.at.y;
    let speed = 0;
    if (fromTop < EDGE_PX) speed = -MAX_SCROLL_PER_FRAME * (1 - Math.max(fromTop, 0) / EDGE_PX);
    else if (fromBottom < EDGE_PX) speed = MAX_SCROLL_PER_FRAME * (1 - Math.max(fromBottom, 0) / EDGE_PX);
    if (speed && this.isInside(drag.at)) {
      list.scrollTop += speed;
      this.updateGap(drag);
    }
    drag.frame = requestAnimationFrame(() => this.autoScroll());
  }

  private isInside(at: Point): boolean {
    const box = this.deps.list.getBoundingClientRect();
    return at.x >= box.left && at.x <= box.right && at.y >= box.top && at.y <= box.bottom;
  }

  private endPress(): void {
    if (this.press) clearTimeout(this.press.timer);
    this.press = null;
  }
}
