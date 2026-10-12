import type { EventBus } from '../../app/EventBus';
import { el } from '../../core/utils/dom';
import { clamp } from '../../core/utils/math';
import { icon, type IconName } from '../icons';
import { LongPress } from '../widgets/LongPress';

export interface MenuItem {
  label: string;
  onClick: () => void;
  icon?: IconName;
  danger?: boolean;
  /** Shows a check column; true draws the check mark. */
  check?: boolean;
  /** A colour dot before the label (used by the recolour menu). */
  swatch?: string;
  /** A long press (or right click) runs this instead of `onClick`; used for hidden extras. */
  onLongPress?: () => void;
}

/** `'-'` draws a separator. */
export type MenuEntry = MenuItem | '-';

/**
 * Dropdown menus anchored to a button. Only one is open at a time; a pointer-down outside
 * closes it.
 */
export class Menu {
  private node: HTMLDivElement | null = null;
  private readonly outside = (e: PointerEvent): void => {
    if (this.node && !this.node.contains(e.target as Node)) this.close();
  };

  constructor(private readonly bus: EventBus) {
    // Any other menu or sheet opening closes this one.
    bus.on('menu-opened', () => this.close());
  }

  /** Opens a menu below (or above, if there is no room) `anchor`, right-aligned with it. */
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
    this.close();
    this.bus.emit('menu-opened', undefined);
    document.body.append(menu);
    const r = anchor.getBoundingClientRect();
    const mw = menu.offsetWidth;
    const mh = menu.offsetHeight;
    const x = clamp(r.right - mw, 8, innerWidth - mw - 8);
    let y = r.bottom + 6;
    if (y + mh > innerHeight - 8) y = Math.max(8, r.top - mh - 6);
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    this.node = menu;
    // Defer so the click that opened the menu does not close it.
    setTimeout(() => document.addEventListener('pointerdown', this.outside, true), 0);
  }

  close(): void {
    if (!this.node) return;
    this.node.remove();
    this.node = null;
    document.removeEventListener('pointerdown', this.outside, true);
  }

  private item(entry: MenuItem): HTMLButtonElement {
    const button = el('button', {
      class: 'menu__item' + (entry.danger ? ' menu__item--danger' : ''),
      attrs: { type: 'button', role: 'menuitem' },
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
