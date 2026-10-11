import { DRAG_LONG_PRESS_MS } from '../../core/constants';
import { el } from '../../core/utils/dom';
import { ShelfOrder } from '../../domain/ShelfOrder';

export interface SubjectDragDeps {
  /** The element holding the `.subject` sections. */
  list: HTMLElement;
  /** The scrolling container (auto-scrolled near its edges). */
  scroller: HTMLElement;
  /** False while searching: then nothing can be dragged. */
  enabled: () => boolean;
  /** A drag ended with a new order (subject ids top to bottom). */
  onDrop: (ids: string[]) => void;
}

interface PendingPress {
  pointerId: number;
  handle: HTMLElement;
  x: number;
  y: number;
  timer: ReturnType<typeof setTimeout>;
}

interface DragState {
  pointerId: number;
  handle: HTMLElement;
  section: HTMLElement;
  placeholder: HTMLElement;
  /** Pointer distance from the section's top edge. */
  offsetY: number;
  /** Order before the drag, to tell whether anything changed. */
  before: string[];
  y: number;
  frame: number;
}

/** A touch that moves further than this before the long press is a scroll attempt, not a drag. */
const PRESS_SLOP = 8;
/** Auto-scroll starts this close to the scroller's top or bottom edge … */
const EDGE = 64;
/** … and scrolls at most this many px per frame. */
const MAX_SCROLL_STEP = 14;

/**
 * Drag and drop of subject sections by their handle (`.subject__handle`), with Pointer Events.
 * A mouse or pen drags at once; a finger first holds the handle for 300 ms. While dragging, the
 * section follows the pointer (fixed position), a placeholder shows where it will land, and
 * the shelf scrolls near its edges. Escape or a cancelled pointer restores the original order.
 */
export class SubjectDragController {
  private pending: PendingPress | null = null;
  private drag: DragState | null = null;
  private readonly onDown = (e: PointerEvent): void => this.pointerDown(e);
  private readonly onMove = (e: PointerEvent): void => this.pointerMove(e);
  private readonly onUp = (e: PointerEvent): void => this.finish(e.pointerId, true);
  private readonly onCancel = (e: PointerEvent): void => this.finish(e.pointerId, false);
  private readonly onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && (this.drag || this.pending)) {
      e.preventDefault();
      this.finish(this.drag?.pointerId ?? this.pending?.pointerId ?? -1, false);
    }
  };

  constructor(private readonly deps: SubjectDragDeps) {
    deps.list.addEventListener('pointerdown', this.onDown);
    document.addEventListener('keydown', this.onKey);
  }

  /** Whether a drag is in progress (the shelf must not be re-rendered meanwhile). */
  get active(): boolean {
    return this.drag !== null;
  }

  private pointerDown(e: PointerEvent): void {
    const handle = (e.target as Element | null)?.closest<HTMLElement>('.subject__handle');
    if (!handle || this.drag || this.pending || !this.deps.enabled()) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    this.listen(handle, e.pointerId);
    if (e.pointerType !== 'touch') {
      this.start(handle, e.pointerId, e.clientY);
      return;
    }
    // Touch: hold first, so a swipe that starts on the handle does not grab the subject.
    const timer = setTimeout(() => {
      const press = this.pending;
      this.pending = null;
      if (press) this.start(press.handle, press.pointerId, press.y);
    }, DRAG_LONG_PRESS_MS);
    this.pending = { pointerId: e.pointerId, handle, x: e.clientX, y: e.clientY, timer };
  }

  private listen(handle: HTMLElement, pointerId: number): void {
    try {
      handle.setPointerCapture(pointerId);
    } catch {
      /* the pointer may already be gone */
    }
    handle.addEventListener('pointermove', this.onMove);
    handle.addEventListener('pointerup', this.onUp);
    handle.addEventListener('pointercancel', this.onCancel);
    handle.addEventListener('lostpointercapture', this.onCancel);
  }

  private unlisten(handle: HTMLElement): void {
    handle.removeEventListener('pointermove', this.onMove);
    handle.removeEventListener('pointerup', this.onUp);
    handle.removeEventListener('pointercancel', this.onCancel);
    handle.removeEventListener('lostpointercapture', this.onCancel);
  }

  private start(handle: HTMLElement, pointerId: number, y: number): void {
    const section = handle.closest<HTMLElement>('.subject');
    if (!section) return;
    const rect = section.getBoundingClientRect();
    const placeholder = el('div', { class: 'subject-placeholder', attrs: { 'aria-hidden': 'true' } });
    placeholder.style.height = rect.height + 'px';
    section.before(placeholder);
    section.classList.add('subject--dragging');
    section.style.left = rect.left + 'px';
    section.style.top = rect.top + 'px';
    section.style.width = rect.width + 'px';
    this.deps.list.classList.add('library__list--dragging');
    this.drag = {
      pointerId,
      handle,
      section,
      placeholder,
      offsetY: y - rect.top,
      before: this.ids(),
      y,
      frame: requestAnimationFrame(() => this.tick()),
    };
  }

  private pointerMove(e: PointerEvent): void {
    const press = this.pending;
    if (press && e.pointerId === press.pointerId) {
      if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > PRESS_SLOP)
        this.finish(press.pointerId, false);
      return;
    }
    if (!this.drag || e.pointerId !== this.drag.pointerId) return;
    this.drag.y = e.clientY;
    this.place();
  }

  /** Moves the section with the pointer and the placeholder to where it would land. */
  private place(): void {
    const drag = this.drag;
    if (!drag) return;
    drag.section.style.top = drag.y - drag.offsetY + 'px';
    const others = this.sections().filter((s) => s !== drag.section);
    const centers = others.map((s) => {
      const r = s.getBoundingClientRect();
      return r.top + r.height / 2;
    });
    const index = ShelfOrder.dropIndex(centers, drag.y);
    const next = others[index];
    if (next) {
      if (next.previousElementSibling !== drag.placeholder) next.before(drag.placeholder);
    } else {
      const last = others[others.length - 1];
      if (last && last.nextElementSibling !== drag.placeholder) last.after(drag.placeholder);
    }
  }

  /** Auto-scrolls near the scroller's edges, every frame while dragging. */
  private tick(): void {
    const drag = this.drag;
    if (!drag) return;
    const box = this.deps.scroller.getBoundingClientRect();
    let step = 0;
    if (drag.y < box.top + EDGE) step = -MAX_SCROLL_STEP * (1 - Math.max(0, drag.y - box.top) / EDGE);
    else if (drag.y > box.bottom - EDGE)
      step = MAX_SCROLL_STEP * (1 - Math.max(0, box.bottom - drag.y) / EDGE);
    if (step) {
      this.deps.scroller.scrollTop += step;
      this.place();
    }
    drag.frame = requestAnimationFrame(() => this.tick());
  }

  /** Ends a press or drag; `commit` keeps the new order, otherwise the original one stays. */
  private finish(pointerId: number, commit: boolean): void {
    const press = this.pending;
    if (press && press.pointerId === pointerId) {
      clearTimeout(press.timer);
      this.pending = null;
      this.unlisten(press.handle);
    }
    const drag = this.drag;
    if (!drag || drag.pointerId !== pointerId) return;
    this.drag = null;
    cancelAnimationFrame(drag.frame);
    this.unlisten(drag.handle);
    for (const prop of ['left', 'top', 'width']) drag.section.style.removeProperty(prop);
    drag.section.classList.remove('subject--dragging');
    this.deps.list.classList.remove('library__list--dragging');
    if (commit) drag.placeholder.replaceWith(drag.section);
    else drag.placeholder.remove();
    const ids = this.ids();
    if (commit && ids.join() !== drag.before.join()) this.deps.onDrop(ids);
  }

  private sections(): HTMLElement[] {
    return [...this.deps.list.querySelectorAll<HTMLElement>(':scope > .subject')];
  }

  private ids(): string[] {
    return this.sections().map((s) => s.dataset.subjectId ?? '');
  }

  /** Removes every listener. */
  destroy(): void {
    if (this.drag) this.finish(this.drag.pointerId, false);
    if (this.pending) this.finish(this.pending.pointerId, false);
    this.deps.list.removeEventListener('pointerdown', this.onDown);
    document.removeEventListener('keydown', this.onKey);
  }
}
