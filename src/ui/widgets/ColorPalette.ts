import { el, replaceChildren } from '../../core/utils/dom';
import { ColorLists } from '../../domain/ColorLists';
import type { I18n } from '../../i18n/I18n';

/** Custom colours: the recent list, the system picker and the hex field. */
export interface CustomColorOptions {
  recent: readonly string[];
  /** A custom colour was confirmed; returns the updated recent list to show. */
  commit(color: string): readonly string[];
}

export interface ColorPaletteOptions {
  colors: readonly string[];
  /** Translated names, in the order of `colors`. */
  names: readonly string[];
  current: string;
  onPick(color: string): void;
  /** Omit for the compact grid (lasso recolour). */
  custom?: CustomColorOptions;
}

/** The colour picked when the current colour cannot seed the system picker. */
const PICKER_FALLBACK = '#1E40AF';

/**
 * A palette: a grid of named swatches and, optionally, a "Recent" row of custom colours plus
 * the system colour picker and a `#RRGGBB` field. Every swatch has a translated aria-label.
 */
export class ColorPalette {
  readonly node: HTMLDivElement;
  private current: string;
  private readonly recentRow = el('div', { class: 'palette__recent' });
  private picker: HTMLInputElement | null = null;
  private hex: HTMLInputElement | null = null;

  constructor(
    private readonly i18n: I18n,
    private readonly opts: ColorPaletteOptions,
  ) {
    this.current = opts.current;
    const grid = el('div', {
      class: 'palette__grid',
      attrs: { role: 'group', 'aria-label': i18n.t('color') },
    });
    opts.colors.forEach((c) => grid.append(this.swatch(c)));
    this.node = el('div', { class: 'palette' + (opts.custom ? '' : ' palette--compact') }, grid);
    if (opts.custom) this.node.append(...this.customSection(opts.custom));
    this.mark();
  }

  /** "Blue" for palette colours, "Colour #RRGGBB" for anything else. */
  static label(i18n: I18n, colors: readonly string[], names: readonly string[], color: string): string {
    const index = colors.findIndex((c) => c.toLowerCase() === color.toLowerCase());
    return names[index] ?? i18n.t('colorN', { c: color.toUpperCase() });
  }

  private swatch(color: string): HTMLButtonElement {
    const label = ColorPalette.label(this.i18n, this.opts.colors, this.opts.names, color);
    return el('button', {
      class: 'swatch',
      attrs: { type: 'button', 'data-c': color, 'aria-label': label, title: label, 'aria-pressed': 'false' },
      style: { '--dot-color': color },
      on: { click: () => this.pick(color) },
    });
  }

  private customSection(custom: CustomColorOptions): HTMLElement[] {
    const t = this.i18n;
    this.renderRecent(custom.recent);
    const picker = el('input', {
      class: 'palette__picker-input',
      attrs: { type: 'color', value: this.pickerValue(), 'aria-label': t.t('customColor') },
    });
    picker.addEventListener('input', () => this.pick(picker.value.toUpperCase()));
    picker.addEventListener('change', () => this.commit(picker.value.toUpperCase(), true));
    const hex = el('input', {
      class: 'input palette__hex',
      attrs: {
        type: 'text',
        inputmode: 'text',
        maxlength: 7,
        spellcheck: 'false',
        autocomplete: 'off',
        placeholder: t.t('hexPh'),
        'aria-label': t.t('hexColor'),
        value: this.current.toUpperCase(),
      },
    });
    hex.addEventListener('input', () => this.onHexInput(hex, false));
    hex.addEventListener('change', () => this.onHexInput(hex, true));
    this.picker = picker;
    this.hex = hex;
    return [
      el('span', { class: 'field__label' }, t.t('recentColors')),
      this.recentRow,
      el(
        'div',
        { class: 'palette__custom' },
        el('label', { class: 'palette__picker', attrs: { title: t.t('customColor') } }, picker),
        hex,
      ),
    ];
  }

  private renderRecent(recent: readonly string[]): void {
    const nodes = recent.map((c) => this.swatch(c));
    replaceChildren(
      this.recentRow,
      ...(nodes.length ? nodes : [el('span', { class: 'palette__empty' }, this.i18n.t('noRecent'))]),
    );
    this.mark();
  }

  /** Applies valid hex input live; on change (Enter or leaving the field) it is also remembered. */
  private onHexInput(input: HTMLInputElement, confirmed: boolean): void {
    const color = ColorLists.parseHex(input.value);
    const invalid = color === null && (confirmed || input.value.trim().length >= 7);
    input.classList.toggle('palette__hex--invalid', invalid);
    input.setAttribute('aria-invalid', String(invalid));
    if (!color) return;
    if (confirmed) this.commit(color, false);
    else this.pick(color, false);
  }

  private commit(color: string, syncHex: boolean): void {
    this.pick(color, syncHex);
    if (this.opts.custom) this.renderRecent(this.opts.custom.commit(color));
  }

  private pick(color: string, syncHex = true): void {
    this.current = color;
    this.mark();
    if (this.picker) this.picker.value = this.pickerValue();
    if (syncHex && this.hex) {
      this.hex.value = color.toUpperCase();
      this.hex.classList.remove('palette__hex--invalid');
      this.hex.setAttribute('aria-invalid', 'false');
    }
    this.opts.onPick(color);
  }

  private pickerValue(): string {
    return (ColorLists.parseHex(this.current) ?? PICKER_FALLBACK).toLowerCase();
  }

  /** Highlights every swatch of the current colour (case-insensitive). */
  private mark(): void {
    const current = this.current.toLowerCase();
    for (const swatch of this.node.querySelectorAll<HTMLElement>('.swatch')) {
      const on = (swatch.dataset.c ?? '').toLowerCase() === current;
      swatch.classList.toggle('swatch--active', on);
      swatch.setAttribute('aria-pressed', String(on));
    }
  }
}
