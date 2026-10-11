import { PEN_COLORS } from '../../core/constants';
import { byId, el, replaceChildren } from '../../core/utils/dom';
import { clamp } from '../../core/utils/math';
import type { I18n } from '../../i18n/I18n';
import type { Menu } from '../dialogs/Menu';
import { icon, type IconName } from '../icons';
import { ColorPalette } from '../widgets/ColorPalette';

export interface SelectionBarHandlers {
  recolor(color: string): void;
  duplicate(): void;
  remove(): void;
  deselect(): void;
}

/** Floating actions above (or below) the selection: colour, duplicate, delete, deselect. */
export class SelectionBar {
  private readonly node = byId('selbar');

  constructor(
    private readonly i18n: I18n,
    private readonly menu: Menu,
    private readonly handlers: SelectionBarHandlers,
  ) {}

  get visible(): boolean {
    return !this.node.hidden;
  }

  /** Builds the buttons (in the current language) and shows the bar. */
  show(): void {
    const t = this.i18n;
    const colorButton = this.button('palette', t.t('color'), () => this.openColors(colorButton));
    replaceChildren(
      this.node,
      colorButton,
      this.button('copy', t.t('duplicate'), () => this.handlers.duplicate()),
      this.button('trash', t.t('delete'), () => this.handlers.remove(), true),
      this.button('close', t.t('deselect'), () => this.handlers.deselect()),
    );
    this.node.hidden = false;
  }

  hide(): void {
    this.node.hidden = true;
  }

  /** Places the bar 16 px above the selection box, or below it if there is no room. */
  position(box: { x: number; y: number; w: number; h: number }, viewWidth: number, viewHeight: number): void {
    if (this.node.hidden) return;
    const bw = this.node.offsetWidth || 170;
    const bh = this.node.offsetHeight || 48;
    const x = clamp(box.x + box.w / 2 - bw / 2, 8, viewWidth - bw - 8);
    let y = box.y - bh - 16;
    if (y < 8) y = Math.min(viewHeight - bh - 8, box.y + box.h + 22);
    this.node.style.left = x + 'px';
    this.node.style.top = y + 'px';
  }

  /** The full pen palette as a compact grid; picking a colour recolours and closes it. */
  private openColors(anchor: HTMLElement): void {
    const palette = new ColorPalette(this.i18n, {
      colors: PEN_COLORS,
      names: this.i18n.list('penColorNames'),
      current: '',
      onPick: (c) => {
        this.menu.close();
        this.handlers.recolor(c);
      },
    });
    this.menu.showContent(anchor, palette.node, this.i18n.t('color'));
  }

  private button(name: IconName, label: string, onClick: () => void, danger = false): HTMLButtonElement {
    return el(
      'button',
      {
        class: 'icon-btn selection-bar__button' + (danger ? ' icon-btn--danger' : ''),
        attrs: { type: 'button', 'aria-label': label, title: label },
        on: { click: onClick },
      },
      icon(name, 20),
    );
  }
}
