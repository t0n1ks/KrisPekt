import { PEN_COLORS, TEXT_SIZES } from '../../core/constants';
import type { TextStyle } from '../../core/types';
import { byId, el, replaceChildren } from '../../core/utils/dom';
import { clamp } from '../../core/utils/math';
import type { ParagraphPatch, StylePatch } from '../../domain/RichText';
import type { TextKey } from '../../i18n/I18n';
import type { I18n } from '../../i18n/I18n';
import type { Menu, MenuEntry } from '../dialogs/Menu';
import { icon, type IconName } from '../icons';
import { ColorPalette } from '../widgets/ColorPalette';

/** What the bar shows: the style of the selected text. */
export interface FormatState {
  style: TextStyle;
  /** The size to show when the selection has several. */
  size: number;
  align: 'left' | 'center' | 'right';
  list: 'bullet' | 'number' | null;
  /** The selected text carries a link. */
  link: boolean;
  canUndo: boolean;
  canRedo: boolean;
}

export interface TextFormatHandlers {
  format(patch: StylePatch): void;
  paragraph(patch: ParagraphPatch): void;
  /** Changes the font size by this many steps. */
  stepSize(delta: number): void;
  /** Adds, changes or removes the link of the selected text. */
  link(): void;
  undo(): void;
  redo(): void;
  remove(): void;
  done(): void;
  /** Recent custom colours. */
  recentColors(): readonly string[];
  /** A custom colour was confirmed; returns the updated list. */
  commitColor(color: string): readonly string[];
}

interface BarButton {
  key: string;
  label: TextKey;
  icon: IconName;
  run: () => void;
  pressed?: (state: FormatState) => boolean;
  danger?: boolean;
  /** Stays on the bar when it is narrow; everything else goes into the overflow menu. */
  core?: boolean;
  disabled?: (state: FormatState) => boolean;
}

/** Below this viewport width the bar shows the core buttons and an overflow menu. */
const COMPACT_WIDTH = 760;
const EDGE = 8;
/** Room between the bar and the box, past the move grip above it. */
const GAP_ABOVE = 54;
const GAP_BELOW = 30;

/**
 * The formatting bar near a text box. It never takes the focus (so the on-screen keyboard stays
 * open) and it is placed inside the visual viewport, the part of the screen the keyboard leaves
 * free. On a narrow screen most buttons collapse into an overflow menu.
 */
export class TextFormatBar {
  private readonly node = byId('textBar');
  private state: FormatState | null = null;
  private compact: boolean | null = null;
  private readonly buttons = new Map<string, { button: HTMLButtonElement; spec: BarButton }>();
  private readonly sizeLabel = el('button', {
    class: 'text-bar__size',
    attrs: { type: 'button' },
    on: { click: () => this.openSizes() },
  });
  private readonly colorDot = el('span', { class: 'text-bar__dot' });
  private readonly specs: readonly BarButton[];

  constructor(
    private readonly i18n: I18n,
    private readonly menu: Menu,
    private readonly handlers: TextFormatHandlers,
  ) {
    this.node.addEventListener('mousedown', (e) => {
      e.preventDefault();
    });
    this.specs = this.buildSpecs();
  }

  get visible(): boolean {
    return !this.node.hidden;
  }

  /** Whether an element belongs to the bar or a menu it opened, so focus there keeps editing. */
  owns(target: EventTarget | null): boolean {
    return target instanceof Element && target.closest('.text-bar, .menu') !== null;
  }

  /** Shows the bar with a state. */
  show(state: FormatState): void {
    this.state = state;
    this.node.hidden = false;
    this.layout();
    this.refresh();
  }

  hide(): void {
    this.node.hidden = true;
    this.state = null;
    this.menu.close();
  }

  /** Rebuilds, for translated labels. */
  applyLanguage(): void {
    this.compact = null;
    if (this.visible) this.layout();
    this.refresh();
  }

  /**
   * Places the bar above or below a box given in client px, always inside the visual viewport,
   * which on Android is what the on-screen keyboard leaves of the screen.
   */
  place(box: { left: number; top: number; right: number; bottom: number }): void {
    if (this.node.hidden) return;
    this.layout();
    const view = TextFormatBar.viewport();
    const width = this.node.offsetWidth;
    const height = this.node.offsetHeight;
    let y = box.top - height - GAP_ABOVE;
    if (y < view.top + EDGE) y = box.bottom + GAP_BELOW;
    y = clamp(y, view.top + EDGE, Math.max(view.top + EDGE, view.top + view.height - height - EDGE));
    const x = clamp(
      (box.left + box.right - width) / 2,
      view.left + EDGE,
      Math.max(view.left + EDGE, view.left + view.width - width - EDGE),
    );
    this.node.style.left = x + 'px';
    this.node.style.top = y + 'px';
  }

  /** The bar's height, to keep the caret clear of it. */
  get height(): number {
    return this.node.offsetHeight;
  }

  private static viewport(): { left: number; top: number; width: number; height: number } {
    const v = window.visualViewport;
    return v
      ? { left: v.offsetLeft, top: v.offsetTop, width: v.width, height: v.height }
      : { left: 0, top: 0, width: innerWidth, height: innerHeight };
  }

  private buildSpecs(): BarButton[] {
    const h = this.handlers;
    const toggle = (flag: 'b' | 'i' | 'u' | 's') => () => h.format({ [flag]: !this.state?.style[flag] });
    const pressedFlag = (flag: 'b' | 'i' | 'u' | 's') => (s: FormatState) => s.style[flag] === true;
    const alignment = (value: 'left' | 'center' | 'right') => () =>
      h.paragraph({ align: value === 'left' ? null : value });
    const list = (value: 'bullet' | 'number') => () =>
      h.paragraph({ list: this.state?.list === value ? null : value });
    return [
      { key: 'undo', label: 'undo', icon: 'undo', run: () => h.undo(), disabled: (s) => !s.canUndo },
      { key: 'redo', label: 'redo', icon: 'redo', run: () => h.redo(), disabled: (s) => !s.canRedo },
      {
        key: 'bold',
        label: 'fmtBold',
        icon: 'bold',
        run: toggle('b'),
        pressed: pressedFlag('b'),
        core: true,
      },
      {
        key: 'italic',
        label: 'fmtItalic',
        icon: 'italic',
        run: toggle('i'),
        pressed: pressedFlag('i'),
        core: true,
      },
      {
        key: 'underline',
        label: 'fmtUnderline',
        icon: 'underline',
        run: toggle('u'),
        pressed: pressedFlag('u'),
      },
      { key: 'strike', label: 'fmtStrike', icon: 'strike', run: toggle('s'), pressed: pressedFlag('s') },
      {
        key: 'left',
        label: 'fmtAlignLeft',
        icon: 'alignLeft',
        run: alignment('left'),
        pressed: (s) => s.align === 'left',
      },
      {
        key: 'center',
        label: 'fmtAlignCenter',
        icon: 'alignCenter',
        run: alignment('center'),
        pressed: (s) => s.align === 'center',
      },
      {
        key: 'right',
        label: 'fmtAlignRight',
        icon: 'alignRight',
        run: alignment('right'),
        pressed: (s) => s.align === 'right',
      },
      {
        key: 'bullets',
        label: 'fmtBullets',
        icon: 'listBullet',
        run: list('bullet'),
        pressed: (s) => s.list === 'bullet',
      },
      {
        key: 'numbers',
        label: 'fmtNumbers',
        icon: 'listNumber',
        run: list('number'),
        pressed: (s) => s.list === 'number',
      },
      { key: 'link', label: 'fmtLink', icon: 'link', run: () => h.link(), pressed: (s) => s.link },
      { key: 'remove', label: 'delete', icon: 'trash', run: () => h.remove(), danger: true },
    ];
  }

  /** Builds the bar for the current width, only when that decides a different layout. */
  private layout(): void {
    const compact = TextFormatBar.viewport().width < COMPACT_WIDTH;
    if (compact === this.compact) return;
    this.compact = compact;
    this.buttons.clear();
    const shown = compact ? this.specs.filter((spec) => spec.core) : this.specs;
    const color = this.iconButton('fmtColor', () => this.openColors(color));
    color.append(this.colorDot);
    const sizeDown = this.iconButton('fmtSizeDown', () => this.handlers.stepSize(-1), 'minus');
    const sizeUp = this.iconButton('fmtSizeUp', () => this.handlers.stepSize(1), 'plus');
    const done = this.iconButton('fmtDone', () => this.handlers.done(), 'check');
    replaceChildren(
      this.node,
      ...(compact ? [] : shown.slice(0, 2).map((spec) => this.specButton(spec))),
      sizeDown,
      this.sizeLabel,
      sizeUp,
      ...(compact ? shown : shown.slice(2)).map((spec) => this.specButton(spec)),
      color,
      ...(compact ? [this.overflowButton()] : []),
      done,
    );
    this.node.classList.toggle('text-bar--compact', compact);
    this.node.setAttribute('aria-label', this.i18n.t('fmtBar'));
    this.sizeLabel.setAttribute('aria-label', this.i18n.t('fmtSize'));
  }

  private refresh(): void {
    const state = this.state;
    if (!state) return;
    this.sizeLabel.textContent = String(Math.round(state.size));
    this.colorDot.style.setProperty('--dot-color', state.style.c ?? 'transparent');
    this.colorDot.classList.toggle('text-bar__dot--mixed', !state.style.c);
    for (const { button, spec } of this.buttons.values()) {
      if (spec.pressed) button.setAttribute('aria-pressed', String(spec.pressed(state)));
      button.disabled = spec.disabled?.(state) ?? false;
    }
  }

  private iconButton(label: TextKey, onClick: () => void, name: IconName = 'palette'): HTMLButtonElement {
    const text = this.i18n.t(label);
    return el(
      'button',
      {
        class: 'icon-btn text-bar__button',
        attrs: { type: 'button', 'aria-label': text, title: text },
        on: { click: onClick },
      },
      icon(name, 20),
    );
  }

  private specButton(spec: BarButton): HTMLButtonElement {
    const button = this.iconButton(spec.label, spec.run, spec.icon);
    if (spec.danger) button.classList.add('icon-btn--danger');
    this.buttons.set(spec.key, { button, spec });
    return button;
  }

  private overflowButton(): HTMLButtonElement {
    const button = this.iconButton('fmtMore', () => this.menu.show(button, this.overflowEntries()), 'more');
    return button;
  }

  private overflowEntries(): MenuEntry[] {
    const state = this.state;
    return this.specs
      .filter((spec) => !spec.core)
      .map((spec) => ({
        label: this.i18n.t(spec.label),
        icon: spec.icon,
        danger: spec.danger,
        disabled: state ? spec.disabled?.(state) : false,
        check: spec.pressed ? (state ? spec.pressed(state) : false) : undefined,
        onClick: spec.run,
      }));
  }

  private openSizes(): void {
    const current = this.state?.size;
    this.menu.show(
      this.sizeLabel,
      TEXT_SIZES.map((size) => ({
        label: String(size),
        check: size === current,
        onClick: () => this.handlers.format({ fs: size }),
      })),
    );
  }

  private openColors(anchor: HTMLElement): void {
    const palette = new ColorPalette(this.i18n, {
      colors: PEN_COLORS,
      names: this.i18n.list('penColorNames'),
      current: this.state?.style.c ?? '',
      onPick: (c) => this.handlers.format({ c }),
      custom: {
        recent: this.handlers.recentColors(),
        commit: (c) => this.handlers.commitColor(c),
      },
    });
    this.menu.showContent(anchor, palette.node, this.i18n.t('fmtColor'));
  }
}
