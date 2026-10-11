import type { Preferences, ToolKind } from '../../core/types';
import { byId, el, replaceChildren } from '../../core/utils/dom';
import type { I18n } from '../../i18n/I18n';
import { icon, type IconName } from '../icons';

const TOOLS: readonly { k: ToolKind; icon: IconName }[] = [
  { k: 'pen', icon: 'pen' },
  { k: 'hl', icon: 'marker' },
  { k: 'eraser', icon: 'eraser' },
  { k: 'lasso', icon: 'lasso' },
  { k: 'text', icon: 'text' },
];

export interface ToolTrayHandlers {
  /** A tool button was pressed (the button is the anchor for its options popover). */
  tool(kind: ToolKind, button: HTMLButtonElement): void;
  /** A pinned pen colour was pressed. */
  swatch(color: string): void;
  ruler(): void;
}

/** The floating tray: tools, pinned pen colours and the ruler toggle. */
export class ToolTray {
  private readonly node = byId('tray');

  constructor(
    private readonly i18n: I18n,
    private readonly handlers: ToolTrayHandlers,
  ) {}

  /** Rebuilds the tray for the current tool, colours and ruler state. */
  render(active: ToolKind, prefs: Preferences, rulerOn: boolean): void {
    const t = this.i18n;
    this.node.setAttribute('aria-label', t.t('tools'));
    const nodes: Node[] = TOOLS.map((tool) => this.toolButton(tool.k, tool.icon, active, prefs));
    nodes.push(el('span', { class: 'tool-tray__sep' }));
    for (const color of prefs.favs) {
      const on = active === 'pen' && prefs.pen.c.toLowerCase() === color.toLowerCase();
      nodes.push(
        el(
          'button',
          {
            class: 'tool-tray__swatch' + (on ? ' tool-tray__swatch--active' : ''),
            attrs: { type: 'button', 'aria-label': t.t('penColor', { c: color }) },
            style: { '--swatch-color': color },
            on: { click: () => this.handlers.swatch(color) },
          },
          el('i', { class: 'tool-tray__swatch-dot' }),
        ),
      );
    }
    nodes.push(el('span', { class: 'tool-tray__sep' }));
    nodes.push(
      el(
        'button',
        {
          class: 'tool-tray__button' + (rulerOn ? ' tool-tray__button--active' : ''),
          attrs: {
            type: 'button',
            'aria-label': t.t('ruler'),
            title: t.t('ruler'),
            'aria-pressed': String(rulerOn),
          },
          on: { click: () => this.handlers.ruler() },
        },
        icon('ruler'),
      ),
    );
    replaceChildren(this.node, ...nodes);
  }

  private toolButton(
    kind: ToolKind,
    iconName: IconName,
    active: ToolKind,
    prefs: Preferences,
  ): HTMLButtonElement {
    const on = kind === active;
    const label = this.i18n.t(kind);
    const button = el(
      'button',
      {
        class: 'tool-tray__button' + (on ? ' tool-tray__button--active' : ''),
        attrs: {
          type: 'button',
          'data-tool': kind,
          'aria-label': label,
          title: label,
          'aria-pressed': String(on),
        },
      },
      icon(iconName),
    );
    const dot = kind === 'pen' ? prefs.pen.c : kind === 'hl' ? prefs.hl.c : null;
    if (dot) button.append(el('span', { class: 'tool-tray__dot', style: { '--dot-color': dot } }));
    button.addEventListener('click', () => this.handlers.tool(kind, button));
    return button;
  }

  /** Bounding box, used to place the options popover above or below the tray. */
  rect(): DOMRect {
    return this.node.getBoundingClientRect();
  }
}
