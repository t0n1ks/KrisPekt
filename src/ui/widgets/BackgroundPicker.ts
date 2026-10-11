import { BACKGROUNDS } from '../../core/constants';
import type { Background } from '../../core/types';
import { el } from '../../core/utils/dom';
import type { I18n } from '../../i18n/I18n';

/** Chips with a tiny paper preview for each background. */
export class BackgroundPicker {
  readonly node: HTMLDivElement;

  constructor(i18n: I18n, value: Background, onChange: (bg: Background) => void) {
    this.node = el('div', { class: 'chips' });
    for (const bg of BACKGROUNDS) {
      this.node.append(
        el(
          'button',
          {
            class: 'chip',
            attrs: { type: 'button', 'data-k': bg },
            on: {
              click: () => {
                this.set(bg);
                onChange(bg);
              },
            },
          },
          el('span', { class: 'paper paper--' + bg }),
          i18n.t(`bg_${bg}`),
        ),
      );
    }
    this.set(value);
  }

  set(value: Background): void {
    for (const chip of this.node.querySelectorAll<HTMLElement>('.chip')) {
      chip.classList.toggle('chip--active', chip.dataset.k === value);
    }
  }
}
