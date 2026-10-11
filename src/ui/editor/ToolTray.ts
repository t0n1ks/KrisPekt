import { PEN_COLORS } from '../../core/constants';
import type { Preferences, ToolKind } from '../../core/types';
import { byId, el, replaceChildren } from '../../core/utils/dom';
import type { I18n } from '../../i18n/I18n';
import { icon, type IconName } from '../icons';
import { BRUSH_LABELS } from '../labels';
import { ColorPalette } from '../widgets/ColorPalette';
import { LongPress } from '../widgets/LongPress';

const TOOLS: readonly { k: ToolKind; icon: IconName }[] = [
  { k: 'pen', icon: 'ballpoint' },
  { k: 'hl', icon: 'marker' },
  { k: 'eraser', icon: 'eraser' },
  { k: 'lasso', icon: 'lasso' },
  { k: 'text', icon: 'text' },
];

export interface ToolTrayHandlers {
  /** A tool button was tapped (the button is the anchor for its options popover). */
  tool(kind: ToolKind, button: HTMLButtonElement): void;
  /** A tool button was long-pressed: open its options. */
  toolOptions(kind: ToolKind): void;
  /** A pinned pen colour was tapped. */
  swatch(color: string): void;
  /** A pinned pen colour was long-pressed: open its replace/remove menu. */
  swatchMenu(index: number, button: HTMLButtonElement): void;
  ruler(): void;
}

/** The floating tray: tools, pinned pen colours and the ruler toggle. */
export class ToolTray {
  private readonly node = byId('tray');

  constructor(
    private readonly i18n: I18n,
    private readonly handlers: ToolTrayHandlers,
  ) {}

  /** Rebuilds the tray for the current tool, brush, eraser mode, colours and ruler state. */
  render(active: ToolKind, prefs: Preferences, rulerOn: boolean): void {
    const t = this.i18n;
    this.node.setAttribute('aria-label', t.t('tools'));
    const nodes: Node[] = TOOLS.map((tool) => this.toolButton(tool.k, tool.icon, active, prefs));
    nodes.push(el('span', { class: 'tool-tray__sep' }));
    const pen = prefs.brushes[prefs.brush];
    prefs.favs.forEach((color, index) => {
      const on = active === 'pen' && pen.c.toLowerCase() === color.toLowerCase();
      nodes.push(this.swatch(color, index, on));
    });
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

  /** The button of a tool in the current tray, used as the popover anchor. */
  buttonFor(kind: ToolKind): HTMLButtonElement | null {
    return this.node.querySelector<HTMLButtonElement>(`[data-tool="${kind}"]`);
  }

  private swatch(color: string, index: number, on: boolean): HTMLButtonElement {
    const name = ColorPalette.label(this.i18n, PEN_COLORS, this.i18n.list('penColorNames'), color);
    const button = el(
      'button',
      {
        class: 'tool-tray__swatch' + (on ? ' tool-tray__swatch--active' : ''),
        attrs: { type: 'button', 'aria-label': this.i18n.t('penColor', { c: name }), title: name },
        style: { '--swatch-color': color },
        on: { click: () => this.handlers.swatch(color) },
      },
      el('i', { class: 'tool-tray__swatch-dot' }),
    );
    LongPress.attach(button, () => this.handlers.swatchMenu(index, button));
    return button;
  }

  private toolButton(
    kind: ToolKind,
    iconName: IconName,
    active: ToolKind,
    prefs: Preferences,
  ): HTMLButtonElement {
    const on = kind === active;
    const label = this.label(kind, prefs);
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
      icon(kind === 'pen' ? prefs.brush : iconName),
    );
    const dot = kind === 'pen' ? prefs.brushes[prefs.brush].c : kind === 'hl' ? prefs.hl.c : null;
    if (dot) button.append(el('span', { class: 'tool-tray__dot', style: { '--dot-color': dot } }));
    if (kind === 'eraser') {
      const mode = prefs.er.mode === 'part' ? 'dot' : 'line';
      button.append(el('span', { class: `tool-tray__badge tool-tray__badge--${mode}` }));
    }
    button.addEventListener('click', () => this.handlers.tool(kind, button));
    LongPress.attach(button, () => this.handlers.toolOptions(kind));
    return button;
  }

  /** "Pen · Fountain pen", "Eraser · Pixel eraser", or just the tool name. */
  private label(kind: ToolKind, prefs: Preferences): string {
    const t = this.i18n;
    if (kind === 'pen') return t.t('toolMode', { tool: t.t('pen'), mode: t.t(BRUSH_LABELS[prefs.brush]) });
    if (kind === 'eraser') {
      const mode = t.t(prefs.er.mode === 'part' ? 'erasePart' : 'eraseWhole');
      return t.t('toolMode', { tool: t.t('eraser'), mode });
    }
    return t.t(kind);
  }

  /** Bounding box, used to place the options popover above or below the tray. */
  rect(): DOMRect {
    return this.node.getBoundingClientRect();
  }
}
