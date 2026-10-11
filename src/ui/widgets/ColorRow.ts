import { el } from '../../core/utils/dom';
import type { I18n } from '../../i18n/I18n';
import { COLOR_PATTERN } from '../../storage/validation/guards';

/** A row of colour dots, optionally with a custom colour picker at the end. */
export class ColorRow {
  readonly node: HTMLDivElement;
  private current: string;

  constructor(
    i18n: I18n,
    colors: readonly string[],
    current: string,
    private readonly onPick: (color: string) => void,
    custom = true,
  ) {
    this.current = current;
    this.node = el('div', { class: 'color-row' });
    for (const c of colors) {
      this.node.append(
        el('button', {
          class: 'color-dot',
          attrs: { type: 'button', 'data-c': c, 'aria-label': i18n.t('colorN', { c }) },
          style: { '--dot-color': c },
          on: { click: () => this.pick(c) },
        }),
      );
    }
    if (custom) this.node.append(this.customPicker(i18n));
    this.set(current);
  }

  private customPicker(i18n: I18n): HTMLLabelElement {
    const input = el('input', {
      class: 'color-row__custom-input',
      attrs: {
        type: 'color',
        value: COLOR_PATTERN.test(this.current) ? this.current : '#1E40AF',
        'aria-label': i18n.t('customColor'),
      },
    });
    input.addEventListener('input', () => this.pick(input.value));
    return el('label', { class: 'color-row__custom', attrs: { title: i18n.t('customColor') } }, input);
  }

  private pick(color: string): void {
    this.set(color);
    this.onPick(color);
  }

  /** Highlights the dot matching `color` (case-insensitive). */
  set(color: string): void {
    this.current = color;
    for (const dot of this.node.querySelectorAll<HTMLElement>('.color-dot')) {
      dot.classList.toggle('color-dot--active', (dot.dataset.c ?? '').toLowerCase() === color.toLowerCase());
    }
  }
}
