import { TOOLBAR_CHROME_WIDTH, TOOLBAR_GAP, TOOLBAR_ITEM_WIDTH } from '../../core/constants';
import type { ToolbarPrefs } from '../../core/types';
import { byId, el, replaceChildren } from '../../core/utils/dom';
import { LassoHandToggle } from '../../domain/LassoHandToggle';
import { ToolbarLayout } from '../../domain/ToolbarLayout';
import { ToolbarOverflow, type OverflowItem, type OverflowResult } from '../../domain/ToolbarOverflow';
import type { I18n } from '../../i18n/I18n';
import type { Menu } from '../dialogs/Menu';
import { icon } from '../icons';
import { LongPress } from '../widgets/LongPress';
import type { ToolbarItemFactory, ToolbarState } from './ToolbarItemFactory';

/**
 * The floating toolbar, with its items placed by the Priority+ rule: what does not fit goes into
 * the More popover, as a grid with labels. Only the width of the stage is observed; items have
 * fixed widths, so nothing is measured and a resize reads no layout.
 */
export class ToolTray {
  private readonly node = byId('tray');
  private readonly observer: ResizeObserver;
  private state: ToolbarState | null = null;
  private layout: ToolbarPrefs | null = null;
  private width = 0;
  private placed: OverflowResult = { bar: [], overflow: [] };
  private readonly moreButton: HTMLButtonElement;

  constructor(
    private readonly i18n: I18n,
    private readonly menu: Menu,
    private readonly items: ToolbarItemFactory,
    private readonly customize: () => void,
  ) {
    this.moreButton = el(
      'button',
      {
        class: 'tool-tray__button tool-tray__more',
        attrs: { id: 'btnTrayMore', type: 'button', 'aria-haspopup': 'dialog' },
        on: { click: () => this.openMore() },
      },
      icon('apps'),
    );
    const stage = this.node.parentElement ?? document.body;
    this.observer = new ResizeObserver((entries) => {
      const width = entries[entries.length - 1]?.contentRect.width ?? 0;
      if (!width || width === this.width) return;
      this.width = width;
      this.arrange(false);
    });
    this.observer.observe(stage);
    // Long-pressing the bar itself, between the buttons, is a way into customise mode.
    LongPress.attach(
      this.node,
      () => this.customize(),
      undefined,
      (e) => e.target === this.node,
    );
  }

  /** Shows the items for a state and a layout. */
  render(state: ToolbarState, layout: ToolbarPrefs): void {
    this.state = state;
    this.layout = layout;
    this.node.setAttribute('aria-label', this.i18n.t('tools'));
    const more = this.i18n.t('toolbarMore');
    this.moreButton.setAttribute('aria-label', more);
    this.moreButton.title = more;
    if (!this.width) this.width = this.node.parentElement?.clientWidth ?? 0;
    this.arrange(true);
  }

  /** Undo and redo change often, and rebuilding the bar would take the focus off them. */
  setUndoState(canUndo: boolean, canRedo: boolean): void {
    if (this.state) this.state = { ...this.state, canUndo, canRedo };
    this.node.querySelectorAll<HTMLButtonElement>('#btnUndo, #btnRedo').forEach((button) => {
      button.disabled = !(button.id === 'btnUndo' ? canUndo : canRedo);
    });
  }

  /** The button of an item on the bar, used as a popover's anchor. */
  buttonFor(item: string): HTMLButtonElement | null {
    return this.node.querySelector<HTMLButtonElement>(`button[data-item="${CSS.escape(item)}"]`);
  }

  /** Bounding box, used to place the options popover above or below the tray. */
  rect(): DOMRect {
    return this.node.getBoundingClientRect();
  }

  /** Stops observing. */
  destroy(): void {
    this.observer.disconnect();
  }

  /** Works out what fits, and rebuilds the bar if asked to or if that changed. */
  private arrange(rebuild: boolean): void {
    const { state, layout } = this;
    if (!state || !layout) return;
    const available = this.width - TOOLBAR_CHROME_WIDTH;
    const result = ToolbarOverflow.compute(
      this.overflowItems(state, layout),
      available,
      TOOLBAR_ITEM_WIDTH,
      TOOLBAR_GAP,
    );
    const changed =
      result.bar.join() !== this.placed.bar.join() || result.overflow.join() !== this.placed.overflow.join();
    this.placed = result;
    if (!rebuild && !changed) return;
    if (changed && this.menu.isOpen) this.menu.close();
    const focused = document.activeElement;
    const focusedItem =
      focused instanceof HTMLElement && this.node.contains(focused) ? focused.dataset.item : undefined;
    const nodes = result.bar.flatMap((item) => this.items.create(item, state) ?? []);
    replaceChildren(this.node, ...nodes, this.moreButton);
    if (focusedItem) this.buttonFor(focusedItem)?.focus();
  }

  private overflowItems(state: ToolbarState, layout: ToolbarPrefs): OverflowItem[] {
    const hidden = new Set(layout.hidden);
    const inUse = LassoHandToggle.itemOnBar(state.activeItem, hidden);
    return layout.order
      .filter((id) => !hidden.has(id) || id === inUse)
      .filter((id) => id !== 'colors' || state.prefs.favs.length > 0)
      .map((id) => ({
        id,
        width: id === 'colors' ? state.prefs.favs.length * TOOLBAR_ITEM_WIDTH : TOOLBAR_ITEM_WIDTH,
        priority: ToolbarLayout.priority(id),
        always: id === 'undo' || id === 'redo' || id === inUse,
      }));
  }

  /** The grid of what did not fit, with a way into customise mode below it. */
  private openMore(): void {
    const { state } = this;
    if (!state) return;
    const cells = this.placed.overflow.flatMap((item) => {
      const node = this.items.create(item, state);
      if (!node) return [];
      return el(
        'div',
        { class: 'toolbar-grid__cell' + (item === 'colors' ? ' toolbar-grid__cell--wide' : '') },
        node,
        el('span', { class: 'toolbar-grid__label' }, this.items.label(item, state)),
      );
    });
    const customize = el(
      'button',
      {
        class: 'btn toolbar-grid__customize',
        attrs: { type: 'button', id: 'btnCustomizeToolbar' },
        on: {
          click: () => {
            this.menu.close();
            this.customize();
          },
        },
      },
      icon('sliders', 18),
      el('span', null, this.i18n.t('customizeToolbar')),
    );
    const grid = el('div', { class: 'toolbar-grid', attrs: { role: 'group' } }, ...cells);
    // A tap on an item does its job and the popover goes away. The item is a fresh node on the bar.
    grid.addEventListener('click', () => this.menu.close(), true);
    const hint = cells.length ? null : el('p', { class: 'hint' }, this.i18n.t('toolbarAllVisible'));
    this.menu.showContent(
      this.moreButton,
      el('div', { class: 'toolbar-more' }, hint, grid, customize),
      this.i18n.t('toolbarMore'),
    );
  }
}
