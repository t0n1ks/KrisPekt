import { HL_COLORS, PEN_COLORS } from '../../core/constants';
import type { Preferences, ToolKind, ToolPreset, ToolSettings } from '../../core/types';
import { el } from '../../core/utils/dom';
import { ToolbarLayout } from '../../domain/ToolbarLayout';
import { ToolPresets } from '../../domain/ToolPresets';
import type { I18n } from '../../i18n/I18n';
import { icon, type IconName } from '../icons';
import { BRUSH_LABELS } from '../labels';
import { ColorPalette } from '../widgets/ColorPalette';
import { LongPress } from '../widgets/LongPress';

/** What the toolbar's items show. */
export interface ToolbarState {
  /** The item of the tool or preset in use. */
  activeItem: string;
  /** The working settings. */
  prefs: Preferences;
  /** The base tools' own settings; a preset in use does not change these. */
  base: ToolSettings;
  presets: readonly ToolPreset[];
  rulerOn: boolean;
  canUndo: boolean;
  canRedo: boolean;
}

export interface ToolbarItemHandlers {
  /** A base tool was tapped (the button is the anchor for its options popover). */
  tool(kind: ToolKind, button: HTMLButtonElement): void;
  /** A base tool was long-pressed: open its options. */
  toolOptions(kind: ToolKind): void;
  preset(id: string, button: HTMLButtonElement): void;
  presetMenu(id: string, button: HTMLButtonElement): void;
  /** A pinned pen colour was tapped. */
  swatch(color: string): void;
  /** A pinned pen colour was long-pressed: open its replace/remove menu. */
  swatchMenu(index: number, button: HTMLButtonElement): void;
  ruler(): void;
  image(): void;
  /** The attachment menu: a PDF file or a link. */
  attach(): void;
  undo(): void;
  redo(): void;
}

const TOOL_ICONS: Record<ToolKind, IconName> = {
  pen: 'ballpoint',
  hl: 'marker',
  eraser: 'eraser',
  lasso: 'lasso',
  text: 'text',
};

/** Builds the toolbar's items, the same ones on the bar, in the More grid and in customise mode. */
export class ToolbarItemFactory {
  constructor(
    private readonly i18n: I18n,
    private readonly handlers: ToolbarItemHandlers,
  ) {}

  /** The item's node, or null if there is no such item (or nothing to show, as with no colours). */
  create(item: string, state: ToolbarState): HTMLElement | null {
    const tool = ToolbarLayout.toolOf(item);
    if (tool) return this.toolButton(tool, state);
    const presetId = ToolbarLayout.presetIdOf(item);
    if (presetId) {
      const preset = state.presets.find((p) => p.id === presetId);
      return preset ? this.presetButton(preset, state) : null;
    }
    switch (item) {
      case 'colors':
        return this.colors(state);
      case 'ruler':
        return this.ruler(state.rulerOn);
      case 'image':
        return this.action(item, 'image', this.i18n.t('insertPhoto'), () => this.handlers.image());
      case 'attach':
        return this.action(item, 'paperclip', this.i18n.t('insertAttachment'), () => this.handlers.attach());
      case 'undo':
        return this.undoRedo(item, 'btnUndo', state.canUndo, () => this.handlers.undo());
      case 'redo':
        return this.undoRedo(item, 'btnRedo', state.canRedo, () => this.handlers.redo());
      default:
        return null;
    }
  }

  /** A short icon-only picture of an item, for customise mode. */
  iconOf(item: string, state: ToolbarState): IconName {
    const tool = ToolbarLayout.toolOf(item);
    if (tool) return tool === 'pen' ? state.base.brush : TOOL_ICONS[tool];
    const preset = state.presets.find((p) => p.id === ToolbarLayout.presetIdOf(item));
    if (preset) return ToolbarItemFactory.presetIcon(preset);
    const names: Record<string, IconName> = {
      colors: 'palette',
      ruler: 'ruler',
      image: 'image',
      attach: 'paperclip',
      undo: 'undo',
      redo: 'redo',
    };
    return names[item] ?? 'more';
  }

  /** What an item is called, for its aria-label, tooltip and the labels of grids and lists. */
  label(item: string, state: ToolbarState): string {
    const t = this.i18n;
    const tool = ToolbarLayout.toolOf(item);
    if (tool) return this.toolLabel(tool, state.base);
    const preset = state.presets.find((p) => p.id === ToolbarLayout.presetIdOf(item));
    if (preset) return this.presetLabel(preset);
    if (item === 'colors') return t.t('toolbarColors');
    if (item === 'image') return t.t('insertPhoto');
    if (item === 'attach') return t.t('insertAttachment');
    if (item === 'ruler' || item === 'undo' || item === 'redo') return t.t(item);
    return item;
  }

  private static presetIcon(preset: ToolPreset): IconName {
    return preset.tool === 'pen' ? preset.brush : TOOL_ICONS[preset.tool];
  }

  private toolButton(kind: ToolKind, state: ToolbarState): HTMLButtonElement {
    const on = state.activeItem === kind;
    const label = this.toolLabel(kind, state.base);
    const button = this.button(kind, label, on, kind === 'pen' ? state.base.brush : TOOL_ICONS[kind]);
    button.dataset.tool = kind;
    const dot =
      kind === 'pen' ? state.base.brushes[state.base.brush].c : kind === 'hl' ? state.base.hl.c : null;
    if (dot) button.append(el('span', { class: 'tool-tray__dot', style: { '--dot-color': dot } }));
    if (kind === 'eraser') button.append(ToolbarItemFactory.eraserBadge(state.base.er.mode));
    button.addEventListener('click', () => this.handlers.tool(kind, button));
    LongPress.attach(button, () => this.handlers.toolOptions(kind));
    return button;
  }

  private presetButton(preset: ToolPreset, state: ToolbarState): HTMLButtonElement {
    const item = ToolbarLayout.presetItem(preset.id);
    const name = ToolbarItemFactory.presetIcon(preset);
    const button = this.button(item, this.presetLabel(preset), state.activeItem === item, name);
    button.classList.add('tool-tray__button--preset');
    button.dataset.preset = preset.id;
    const color = ToolPresets.colorOf(preset);
    // The hint grows with the width the preset draws: from a hairline to a thick bar.
    const hint = 2 + Math.round(ToolPresets.widthHint(preset) * 4);
    button.append(
      el('span', {
        class: 'tool-tray__hint' + (color ? '' : ' tool-tray__hint--plain'),
        style: { '--hint-size': hint + 'px', ...(color ? { '--dot-color': color } : {}) },
      }),
    );
    if (preset.tool === 'eraser') button.append(ToolbarItemFactory.eraserBadge(preset.mode));
    button.addEventListener('click', () => this.handlers.preset(preset.id, button));
    LongPress.attach(button, () => this.handlers.presetMenu(preset.id, button));
    return button;
  }

  private static eraserBadge(mode: ToolSettings['er']['mode']): HTMLElement {
    return el('span', { class: `tool-tray__badge tool-tray__badge--${mode === 'part' ? 'dot' : 'line'}` });
  }

  private button(item: string, label: string, on: boolean, name: IconName): HTMLButtonElement {
    const button = el(
      'button',
      {
        class: 'tool-tray__button' + (on ? ' tool-tray__button--active' : ''),
        attrs: { type: 'button', 'aria-label': label, title: label, 'aria-pressed': String(on) },
      },
      icon(name),
    );
    button.dataset.item = item;
    return button;
  }

  private ruler(on: boolean): HTMLButtonElement {
    const button = this.button('ruler', this.i18n.t('ruler'), on, 'ruler');
    button.addEventListener('click', () => this.handlers.ruler());
    return button;
  }

  private action(item: string, name: IconName, label: string, run: () => void): HTMLButtonElement {
    const button = this.button(item, label, false, name);
    button.removeAttribute('aria-pressed');
    button.addEventListener('click', run);
    return button;
  }

  private undoRedo(item: 'undo' | 'redo', id: string, enabled: boolean, run: () => void): HTMLButtonElement {
    const button = this.action(item, item, this.i18n.t(item), run);
    button.id = id;
    button.disabled = !enabled;
    return button;
  }

  private colors(state: ToolbarState): HTMLElement | null {
    if (!state.prefs.favs.length) return null;
    const pen = state.prefs.brushes[state.prefs.brush];
    const swatches = state.prefs.favs.map((color, index) => {
      const on = pen.c.toLowerCase() === color.toLowerCase();
      return this.swatch(color, index, on && this.penInUse(state));
    });
    const group = el('div', { class: 'tool-tray__colors' }, ...swatches);
    group.dataset.item = 'colors';
    return group;
  }

  private penInUse(state: ToolbarState): boolean {
    if (state.activeItem === 'pen') return true;
    const preset = state.presets.find((p) => p.id === ToolbarLayout.presetIdOf(state.activeItem));
    return preset?.tool === 'pen';
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

  /** "Pen · Fountain pen", "Eraser · Pixel eraser", or just the tool name. */
  private toolLabel(kind: ToolKind, base: ToolSettings): string {
    const t = this.i18n;
    if (kind === 'pen') return t.t('toolMode', { tool: t.t('pen'), mode: t.t(BRUSH_LABELS[base.brush]) });
    if (kind === 'eraser') {
      const mode = t.t(base.er.mode === 'part' ? 'erasePart' : 'eraseWhole');
      return t.t('toolMode', { tool: t.t('eraser'), mode });
    }
    return t.t(kind);
  }

  /** "Fountain pen, Blue, 2.4": what makes this preset different from the others. */
  private presetLabel(preset: ToolPreset): string {
    const t = this.i18n;
    switch (preset.tool) {
      case 'pen':
        return [
          t.t(BRUSH_LABELS[preset.brush]),
          ColorPalette.label(t, PEN_COLORS, t.list('penColorNames'), preset.c),
          preset.s,
        ].join(', ');
      case 'hl':
        return [t.t('hl'), ColorPalette.label(t, HL_COLORS, t.list('hlColorNames'), preset.c), preset.s].join(
          ', ',
        );
      case 'eraser':
        return [t.t(preset.mode === 'part' ? 'erasePart' : 'eraseWhole'), preset.r].join(', ');
      case 'text':
        return [
          t.t('text'),
          ColorPalette.label(t, PEN_COLORS, t.list('penColorNames'), preset.c),
          preset.fs,
        ].join(', ');
    }
  }
}
