import { BRUSH_KINDS } from '../../core/constants';
import type { ToolbarPrefs } from '../../core/types';
import { el, replaceChildren } from '../../core/utils/dom';
import { ToolbarLayout } from '../../domain/ToolbarLayout';
import { ToolPresets, type PinnableTool } from '../../domain/ToolPresets';
import type { I18n } from '../../i18n/I18n';
import type { Menu, MenuEntry } from '../dialogs/Menu';
import { icon, type IconName } from '../icons';
import { BRUSH_LABELS } from '../labels';
import type { ToolbarItemFactory, ToolbarState } from './ToolbarItemFactory';

export interface ToolbarCustomizerHandlers {
  state(): ToolbarState;
  layout(): ToolbarPrefs;
  /** The layout changed: save it at once. */
  setLayout(layout: ToolbarPrefs): void;
  reset(): void;
  /** Adds a preset; false when the toolbar already has the maximum. */
  addPreset(tool: PinnableTool, brush?: (typeof BRUSH_KINDS)[number]): void;
}

interface RowDrag {
  id: number;
  item: string;
  row: HTMLElement;
  startY: number;
  /** Where the middle of every row is, in the list's own coordinates. */
  middles: number[];
  /** The index the dragged item would land on. */
  target: number;
}

/** Near the list's edges a drag scrolls it by this much at a time. */
const EDGE_ZONE = 36;
const EDGE_STEP = 14;

/**
 * Customise mode: a card over the stage, with one row per toolbar item. Rows move by dragging
 * their grip or with the Move left and Move right buttons, and the eye shows or hides an item.
 * Every change is saved at once and the bar behind the card shows it.
 */
export class ToolbarCustomizer {
  private node: HTMLElement | null = null;
  private list: HTMLElement | null = null;
  private drag: RowDrag | null = null;

  constructor(
    private readonly stage: HTMLElement,
    private readonly i18n: I18n,
    private readonly menu: Menu,
    private readonly items: ToolbarItemFactory,
    private readonly handlers: ToolbarCustomizerHandlers,
  ) {}

  get isOpen(): boolean {
    return this.node !== null;
  }

  /** Opens the card, or does nothing if it is open. */
  open(): void {
    if (this.node) return;
    const t = this.i18n;
    this.list = el('div', { class: 'toolbar-custom__list', attrs: { role: 'list' } });
    const done = this.footerButton(t.t('done'), () => this.close(), 'btn btn--primary toolbar-custom__done');
    const add = this.footerButton(t.t('toolbarAdd'), () => undefined, 'btn toolbar-custom__add');
    add.prepend(icon('plus', 18));
    add.addEventListener('click', () => this.menu.show(add, this.addEntries()));
    const reset = this.footerButton(
      t.t('toolbarReset'),
      () => this.handlers.reset(),
      'btn toolbar-custom__reset',
    );
    this.node = el(
      'div',
      { class: 'toolbar-custom', attrs: { id: 'toolbarCustom' } },
      el(
        'div',
        { class: 'toolbar-custom__card', attrs: { role: 'dialog', 'aria-label': t.t('customizeToolbar') } },
        el('h3', { class: 'popover__title' }, t.t('customizeToolbar')),
        el('p', { class: 'hint' }, t.t('toolbarHint')),
        this.list,
        el('div', { class: 'toolbar-custom__foot' }, add, reset, done),
      ),
    );
    this.stage.append(this.node);
    this.update();
    done.focus();
  }

  /** Closes the card; everything is already saved. */
  close(): void {
    this.node?.remove();
    this.node = null;
    this.list = null;
    this.drag = null;
  }

  /** Shows the current layout, with the focus staying on the same control of the same row. */
  update(): void {
    const { list } = this;
    if (!list || this.drag) return;
    const focused = document.activeElement;
    const control =
      focused instanceof HTMLElement && list.contains(focused) ? focused.dataset.control : undefined;
    const item =
      focused instanceof HTMLElement ? focused.closest<HTMLElement>('[data-row]')?.dataset.row : undefined;
    const top = list.scrollTop;
    const layout = this.handlers.layout();
    replaceChildren(list, ...layout.order.map((id, index) => this.row(id, index, layout)));
    list.scrollTop = top;
    if (control && item) {
      list
        .querySelector<HTMLElement>(`[data-row="${CSS.escape(item)}"] [data-control="${control}"]`)
        ?.focus();
    }
  }

  private footerButton(label: string, run: () => void, cls: string): HTMLButtonElement {
    return el('button', { class: cls, attrs: { type: 'button' }, on: { click: run } }, label);
  }

  private addEntries(): MenuEntry[] {
    const { i18n, handlers } = this;
    const brushes = BRUSH_KINDS.map((brush) => ({
      label: i18n.t(BRUSH_LABELS[brush]),
      icon: brush,
      onClick: () => handlers.addPreset('pen', brush),
    }));
    const others = (['hl', 'eraser', 'text'] as const).map((tool) => ({
      label: i18n.t(tool),
      icon: this.items.iconOf(tool, handlers.state()),
      onClick: () => handlers.addPreset(tool),
    }));
    return ToolPresets.canAdd(handlers.state().presets)
      ? [...brushes, ...others]
      : [{ label: i18n.t('presetLimit'), disabled: true, onClick: () => undefined }];
  }

  private row(item: string, index: number, layout: ToolbarPrefs): HTMLElement {
    const t = this.i18n;
    const state = this.handlers.state();
    const label = this.items.label(item, state);
    const hidden = layout.hidden.includes(item);
    const canHide = ToolbarLayout.canHide(layout, item, state.presets);
    const row = el(
      'div',
      {
        class: 'toolbar-custom__row' + (hidden ? ' toolbar-custom__row--hidden' : ''),
        attrs: { role: 'listitem' },
      },
      this.grip(item, label),
      el('span', { class: 'toolbar-custom__icon' }, icon(this.items.iconOf(item, state), 20)),
      el('span', { class: 'toolbar-custom__label' }, label),
      this.rowButton('left', 'left', t.t('moveItemLeft', { item: label }), index === 0, () =>
        this.moveBy(item, -1),
      ),
      this.rowButton(
        'right',
        'right',
        t.t('moveItemRight', { item: label }),
        index === layout.order.length - 1,
        () => this.moveBy(item, 1),
      ),
      this.rowButton(
        'eye',
        hidden ? 'eyeOff' : 'eye',
        t.t(hidden ? 'showItem' : 'hideItem', { item: label }),
        !hidden && !canHide,
        () => this.handlers.setLayout(ToolbarLayout.withHidden(this.handlers.layout(), item, !hidden)),
      ),
    );
    row.dataset.row = item;
    return row;
  }

  private rowButton(
    control: string,
    name: IconName,
    label: string,
    disabled: boolean,
    run: () => void,
  ): HTMLButtonElement {
    const button = el(
      'button',
      {
        class: 'icon-btn toolbar-custom__button',
        attrs: { type: 'button', 'aria-label': label, title: label, disabled },
        on: { click: run },
      },
      icon(name, 20),
    );
    button.dataset.control = control;
    return button;
  }

  private moveBy(item: string, delta: number): void {
    const layout = this.handlers.layout();
    const order = ToolbarLayout.moved(layout.order, item, layout.order.indexOf(item) + delta);
    this.handlers.setLayout({ ...layout, order });
  }

  private grip(item: string, label: string): HTMLElement {
    const grip = el(
      'span',
      {
        class: 'toolbar-custom__grip',
        attrs: { title: this.i18n.t('dragItem', { item: label }) },
      },
      icon('grip', 20),
    );
    grip.addEventListener('pointerdown', (e) => this.dragStart(e, item, grip));
    grip.addEventListener('pointermove', (e) => this.dragMove(e));
    grip.addEventListener('pointerup', (e) => this.dragEnd(e));
    grip.addEventListener('pointercancel', () => this.dragCancel());
    return grip;
  }

  private dragStart(e: PointerEvent, item: string, grip: HTMLElement): void {
    const { list } = this;
    const row = grip.closest<HTMLElement>('[data-row]');
    if (!list || !row || this.drag) return;
    e.preventDefault();
    grip.setPointerCapture(e.pointerId);
    const top = list.getBoundingClientRect().top - list.scrollTop;
    const middles = Array.from(list.children).map((child) => {
      const rect = child.getBoundingClientRect();
      return rect.top - top + rect.height / 2;
    });
    const target = this.handlers.layout().order.indexOf(item);
    this.drag = { id: e.pointerId, item, row, startY: e.clientY + list.scrollTop, middles, target };
    row.classList.add('toolbar-custom__row--dragging');
  }

  private dragMove(e: PointerEvent): void {
    const { drag, list } = this;
    if (!drag || !list || drag.id !== e.pointerId) return;
    const box = list.getBoundingClientRect();
    if (e.clientY < box.top + EDGE_ZONE) list.scrollTop -= EDGE_STEP;
    else if (e.clientY > box.bottom - EDGE_ZONE) list.scrollTop += EDGE_STEP;
    const y = e.clientY + list.scrollTop;
    drag.row.style.transform = `translateY(${y - drag.startY}px)`;
    const inList = y - box.top;
    const from = this.handlers.layout().order.indexOf(drag.item);
    // Every row whose middle the pointer has passed, not counting the dragged row itself.
    drag.target = drag.middles.filter((middle, index) => index !== from && middle < inList).length;
    Array.from(list.children).forEach((child, index) => {
      const after = index > from ? index - 1 : index;
      child.classList.toggle('toolbar-custom__row--drop', index !== from && after === drag.target);
    });
  }

  private dragEnd(e: PointerEvent): void {
    const { drag } = this;
    if (!drag || drag.id !== e.pointerId) return;
    this.drag = null;
    const layout = this.handlers.layout();
    const order = ToolbarLayout.moved(layout.order, drag.item, drag.target);
    this.handlers.setLayout({ ...layout, order });
    this.update();
  }

  private dragCancel(): void {
    this.drag = null;
    this.update();
  }
}
