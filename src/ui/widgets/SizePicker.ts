import { el } from '../../core/utils/dom';
import { toClampedNumber } from '../../core/utils/math';
import type { I18n } from '../../i18n/I18n';
import { PageSizes, SIZE_PRESETS } from '../../domain/PageSizes';
import { LIMITS } from '../../storage/validation/guards';
import { Segmented } from './Segmented';

type Orientation = 'p' | 'l';

/** Page size chooser: preset chips, portrait/landscape, and custom width × height in mm. */
export class SizePicker {
  readonly node: HTMLDivElement;
  private readonly chips: HTMLDivElement;
  private readonly orientation: Segmented<Orientation>;
  private readonly widthInput: HTMLInputElement;
  private readonly heightInput: HTMLInputElement;
  private size: { w: number; h: number };

  constructor(
    i18n: I18n,
    sizes: PageSizes,
    w: number,
    h: number,
    private readonly onChange: (w: number, h: number) => void,
  ) {
    this.size = { w, h };
    this.chips = el('div', { class: 'chips' });
    for (const preset of SIZE_PRESETS) {
      const pick = (): void => {
        // Keep the current orientation when switching presets (squares have none).
        const land = this.size.w > this.size.h && preset.w !== preset.h;
        this.emit(land ? preset.h : preset.w, land ? preset.w : preset.h);
      };
      this.chips.append(
        el(
          'button',
          { class: 'chip', attrs: { type: 'button', 'data-k': preset.k }, on: { click: pick } },
          sizes.name(preset.k),
        ),
      );
    }
    this.orientation = new Segmented<Orientation>(
      [
        { v: 'p', label: i18n.t('Portrait') },
        { v: 'l', label: i18n.t('Landscape') },
      ],
      'p',
      (v) => this.setOrientation(v === 'l'),
    );
    this.widthInput = this.numberInput(i18n.t('widthMm'));
    this.heightInput = this.numberInput(i18n.t('heightMm'));
    this.widthInput.addEventListener('change', () =>
      this.emit(this.parse(this.widthInput, this.size.w), this.size.h),
    );
    this.heightInput.addEventListener('change', () =>
      this.emit(this.size.w, this.parse(this.heightInput, this.size.h)),
    );
    const custom = el(
      'div',
      { class: 'size-picker__custom' },
      i18n.t('customSize'),
      this.widthInput,
      '×',
      this.heightInput,
      i18n.t('mm'),
    );
    this.node = el('div', { class: 'size-picker' }, this.chips, this.orientation.node, custom);
    this.sync();
  }

  private numberInput(label: string): HTMLInputElement {
    const [min, max] = LIMITS.pageMm;
    return el('input', {
      class: 'input size-picker__input',
      attrs: { type: 'number', min, max, step: '1', inputmode: 'numeric', 'aria-label': label },
    });
  }

  /** Reads a typed size, clamped to 40–1200 mm; invalid input keeps the old value. */
  private parse(input: HTMLInputElement, fallback: number): number {
    const value = Number(input.value);
    return value ? toClampedNumber(value, LIMITS.pageMm[0], LIMITS.pageMm[1], fallback) : fallback;
  }

  private setOrientation(landscape: boolean): void {
    const { w, h } = this.size;
    if (w > h !== landscape && w !== h) this.emit(h, w);
    else this.sync();
  }

  private emit(w: number, h: number): void {
    this.size = { w, h };
    this.sync();
    this.onChange(w, h);
  }

  /** Shows a size without firing onChange. */
  set(w: number, h: number): void {
    this.size = { w, h };
    this.sync();
  }

  /** Greys out and disables every control (locked pages). */
  disable(disabled: boolean): void {
    this.node.classList.toggle('size-picker--disabled', disabled);
    for (const control of this.node.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button,input')) {
      control.disabled = disabled;
    }
  }

  private sync(): void {
    const match = PageSizes.match(this.size.w, this.size.h);
    for (const chip of this.chips.querySelectorAll<HTMLElement>('.chip')) {
      chip.classList.toggle('chip--active', !!match && chip.dataset.k === match.k);
    }
    this.orientation.set(this.size.w > this.size.h ? 'l' : 'p');
    this.widthInput.value = String(Math.round(this.size.w));
    this.heightInput.value = String(Math.round(this.size.h));
  }
}
