import { byId, el, replaceChildren } from '../../core/utils/dom';
import type { ResizeSide } from '../../domain/TextBoxRules';
import type { I18n } from '../../i18n/I18n';
import { icon } from '../icons';

/** What a pointer on the frame is doing. */
export type FrameDragKind = 'move' | ResizeSide;

export interface TextBoxFrameHandlers {
  /** A touch that is really the palm must not move anything. */
  isPalm(e: PointerEvent): boolean;
  dragStart(): void;
  /** Dragged by (dx, dy) client px since the start. */
  dragMove(kind: FrameDragKind, dx: number, dy: number): void;
  dragEnd(kind: FrameDragKind): void;
  dragCancel(): void;
  /** Pressed and released without moving. */
  tap(clientX: number, clientY: number): void;
}

interface Press {
  id: number;
  kind: FrameDragKind;
  x: number;
  y: number;
  moved: boolean;
}

/** A pointer that travels further than this is dragging, not tapping. */
const TAP_SLOP = 6;
const HANDLES: readonly { name: string; side: ResizeSide }[] = [
  { name: 'left', side: 'left' },
  { name: 'right', side: 'right' },
  { name: 'top-left', side: 'left' },
  { name: 'top-right', side: 'right' },
  { name: 'bottom-left', side: 'left' },
  { name: 'bottom-right', side: 'right' },
];

/**
 * The frame of a text box: a body and a move grip for moving, handles on the sides and corners
 * for changing the width. Its parts are not scaled with the page, so every handle keeps its 44 px
 * touch area at any zoom. While the box is being edited, the body lets pointers through to the
 * text. Mouse-down on the frame does not take the focus, so the keyboard stays open.
 */
export class TextBoxFrame {
  private readonly node = byId('textFrame');
  private press: Press | null = null;
  private readonly listeners: [string, EventListener][] = [
    ['pointerdown', (e) => this.onDown(e as PointerEvent)],
    ['pointermove', (e) => this.onMove(e as PointerEvent)],
    ['pointerup', (e) => this.onUp(e as PointerEvent)],
    ['pointercancel', () => this.onCancel()],
    ['mousedown', (e) => e.preventDefault()],
  ];

  constructor(
    private readonly i18n: I18n,
    private readonly handlers: TextBoxFrameHandlers,
  ) {
    for (const [type, fn] of this.listeners) this.node.addEventListener(type, fn);
    this.build();
  }

  /** Whether a drag is in progress. */
  get dragging(): boolean {
    return this.press !== null;
  }

  /** Shows the frame around a rectangle in stage px. */
  place(x: number, y: number, width: number, height: number, editing: boolean): void {
    const { node } = this;
    node.hidden = false;
    node.classList.toggle('text-frame--editing', editing);
    node.style.transform = `translate(${x}px, ${y}px)`;
    node.style.width = width + 'px';
    node.style.height = height + 'px';
  }

  hide(): void {
    this.press = null;
    this.node.hidden = true;
  }

  /** Rebuilds the parts, for their translated labels. */
  applyLanguage(): void {
    this.build();
  }

  /** Removes the listeners. */
  destroy(): void {
    for (const [type, fn] of this.listeners) this.node.removeEventListener(type, fn);
  }

  private build(): void {
    const t = this.i18n;
    replaceChildren(
      this.node,
      el('div', { class: 'text-frame__body', attrs: { 'data-drag': 'move' } }),
      el(
        'div',
        {
          class: 'text-frame__move',
          attrs: { 'data-drag': 'move', role: 'button', 'aria-label': t.t('textBoxMove') },
        },
        icon('grip', 18),
      ),
      ...['top', 'bottom', 'left-edge', 'right-edge'].map((edge) =>
        el('div', { class: `text-frame__edge text-frame__edge--${edge}`, attrs: { 'data-drag': 'move' } }),
      ),
      ...HANDLES.map(({ name, side }) =>
        el('div', {
          class: `text-frame__handle text-frame__handle--${name}`,
          attrs: { 'data-drag': side, role: 'button', 'aria-label': t.t('textBoxResize') },
        }),
      ),
    );
  }

  private onDown(e: PointerEvent): void {
    if (this.press || this.handlers.isPalm(e) || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const part = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-drag]') : null;
    const kind = part?.dataset.drag as FrameDragKind | undefined;
    if (!kind) return;
    e.preventDefault();
    this.node.setPointerCapture(e.pointerId);
    this.press = { id: e.pointerId, kind, x: e.clientX, y: e.clientY, moved: false };
  }

  private onMove(e: PointerEvent): void {
    const press = this.press;
    if (!press || press.id !== e.pointerId) return;
    const dx = e.clientX - press.x;
    const dy = e.clientY - press.y;
    if (!press.moved) {
      if (Math.hypot(dx, dy) <= TAP_SLOP) return;
      press.moved = true;
      this.handlers.dragStart();
    }
    this.handlers.dragMove(press.kind, dx, dy);
  }

  private onUp(e: PointerEvent): void {
    const press = this.press;
    if (!press || press.id !== e.pointerId) return;
    this.press = null;
    if (press.moved) this.handlers.dragEnd(press.kind);
    else this.handlers.tap(e.clientX, e.clientY);
  }

  private onCancel(): void {
    const press = this.press;
    this.press = null;
    if (press?.moved) this.handlers.dragCancel();
  }
}
