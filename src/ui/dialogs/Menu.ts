import { el } from '../../core/utils/dom';
import { PopoverPlacement, type ViewBox } from '../../domain/PopoverPlacement';
import { icon, type IconName } from '../icons';
import { LongPress } from '../widgets/LongPress';
import type { PopoverHandle, PopoverManager } from './PopoverManager';

export interface MenuItem {
  label: string;
  onClick: () => void;
  icon?: IconName;
  danger?: boolean;
  /** Shows a check column; true draws the check mark. */
  check?: boolean;
  /** A colour dot before the label (used by the recolour menu). */
  swatch?: string;
  /** Shown greyed out; it cannot be tapped. */
  disabled?: boolean;
  /** A long press (or right click) runs this instead of `onClick`; used for hidden extras. */
  onLongPress?: () => void;
}

/** `'-'` draws a separator. */
export type MenuEntry = MenuItem | '-';

/** What is left of the screen; an on-screen keyboard covers the page without resizing it. */
function visibleArea(): ViewBox {
  const view = window.visualViewport;
  return {
    left: view?.offsetLeft ?? 0,
    top: view?.offsetTop ?? 0,
    width: view?.width ?? innerWidth,
    height: view?.height ?? innerHeight,
  };
}

/**
 * Dropdown menus anchored to a button. Pressing that button again closes the menu; see
 * {@link PopoverManager} for the rest of what closes it. All of a menu stays on the screen: it
 * flips and shifts, scrolls when it is long, and on a narrow screen a large one is a bottom sheet.
 */
export class Menu {
  private node: HTMLDivElement | null = null;
  private anchor: Element | null = null;
  private readonly handle: PopoverHandle = {
    contains: (target) => this.node?.contains(target) ?? false,
    isTrigger: (target) => this.anchor?.contains(target) ?? false,
    close: () => this.close(),
  };
  private readonly reposition = (): void => this.place();

  constructor(private readonly popovers: PopoverManager) {}

  /** Opens a menu at `anchor`, or closes it if that is where the open one came from. */
  show(anchor: Element, entries: readonly MenuEntry[]): void {
    const menu = el('div', { class: 'menu', attrs: { role: 'menu' } });
    for (const entry of entries)
      menu.append(entry === '-' ? el('hr', { class: 'menu__sep' }) : this.item(entry));
    this.open(anchor, menu);
  }

  /** Opens arbitrary content (such as a colour grid) in a menu card anchored like {@link show}. */
  showContent(anchor: Element, content: HTMLElement, label: string): void {
    this.open(
      anchor,
      el('div', { class: 'menu menu--content', attrs: { role: 'dialog', 'aria-label': label } }, content),
    );
  }

  private open(anchor: Element, menu: HTMLDivElement): void {
    if (this.node && this.anchor === anchor) {
      this.close();
      return;
    }
    this.close();
    document.body.append(menu);
    // Pressing a menu does not take the focus away from a text box, or the keyboard would close.
    menu.addEventListener('mousedown', (e) => {
      if (!(e.target instanceof HTMLInputElement)) e.preventDefault();
    });
    this.ignoreStrayTaps(menu);
    this.node = menu;
    this.anchor = anchor;
    this.place();
    this.popovers.opened(this.handle);
    window.visualViewport?.addEventListener('resize', this.reposition);
    window.visualViewport?.addEventListener('scroll', this.reposition);
    window.addEventListener('resize', this.reposition);
  }

  /** Measures with the room the menu may have, then puts it where all of it can be seen. */
  private place(): void {
    const { node: menu, anchor } = this;
    if (!menu || !anchor) return;
    const view = visibleArea();
    menu.classList.remove('menu--sheet');
    menu.style.width = '';
    menu.style.maxHeight = PopoverPlacement.maxHeight(view) + 'px';
    const content = menu.classList.contains('menu--content');
    const sheet = PopoverPlacement.isSheet(menu.offsetHeight, view, content);
    if (sheet) {
      menu.classList.add('menu--sheet');
      menu.style.width = view.width + 'px';
    }
    const size = { w: menu.offsetWidth, h: menu.offsetHeight };
    const at = sheet
      ? PopoverPlacement.sheet(size.h, view)
      : PopoverPlacement.anchored(anchor.getBoundingClientRect(), size, view);
    menu.style.left = at.x + 'px';
    menu.style.top = at.y + 'px';
  }

  /**
   * A long press can open a menu under the finger, and lifting the finger then makes the browser
   * send a click to whatever is there. Only a press that began on the menu counts as a choice, or
   * an item, even Delete, could run by itself. A click from the keyboard has detail 0.
   */
  private ignoreStrayTaps(menu: HTMLElement): void {
    let pressed = false;
    menu.addEventListener('pointerdown', () => (pressed = true), true);
    menu.addEventListener(
      'click',
      (e) => {
        if (pressed || e.detail === 0) return;
        e.preventDefault();
        e.stopPropagation();
      },
      true,
    );
  }

  /** Whether a menu is open. */
  get isOpen(): boolean {
    return this.node !== null;
  }

  close(): void {
    if (!this.node) return;
    this.node.remove();
    this.node = null;
    this.anchor = null;
    this.popovers.closed(this.handle);
    window.visualViewport?.removeEventListener('resize', this.reposition);
    window.visualViewport?.removeEventListener('scroll', this.reposition);
    window.removeEventListener('resize', this.reposition);
  }

  private item(entry: MenuItem): HTMLButtonElement {
    const button = el('button', {
      class: 'menu__item' + (entry.danger ? ' menu__item--danger' : ''),
      attrs: { type: 'button', role: 'menuitem', disabled: entry.disabled },
      on: {
        click: () => {
          this.close();
          entry.onClick();
        },
      },
    });
    const onLongPress = entry.onLongPress;
    if (onLongPress) {
      LongPress.attach(button, () => {
        this.close();
        onLongPress();
      });
    }
    if (entry.swatch) {
      button.append(
        el('span', { class: 'color-dot color-dot--small', style: { '--dot-color': entry.swatch } }),
      );
    }
    if (entry.icon) button.append(el('span', null, icon(entry.icon, 19)));
    button.append(el('span', null, entry.label));
    if (entry.check !== undefined) {
      button.append(el('span', { class: 'menu__check' }, entry.check ? icon('check', 18) : null));
    }
    return button;
  }
}
