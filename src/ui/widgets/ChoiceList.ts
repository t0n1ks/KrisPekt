import { el } from '../../core/utils/dom';

export interface Choice<T extends string> {
  v: T;
  label: string;
  /** A second, smaller line under the label. */
  hint?: string;
}

/**
 * A vertical list of mutually exclusive choices, each with an optional hint line. Works like a
 * radio group but with large touch targets that fit phone screens.
 */
export class ChoiceList<T extends string> {
  readonly node: HTMLDivElement;
  private readonly buttons: HTMLButtonElement[];

  constructor(choices: readonly Choice<T>[], value: T, onChange: (value: T) => void, label = '') {
    this.node = el('div', { class: 'choice-list', attrs: { role: 'radiogroup', 'aria-label': label } });
    this.buttons = choices.map((c) =>
      el(
        'button',
        {
          class: 'choice-list__item',
          attrs: { type: 'button', role: 'radio', 'data-v': c.v, 'aria-checked': 'false' },
          on: {
            click: () => {
              this.set(c.v);
              onChange(c.v);
            },
          },
        },
        el('span', { class: 'choice-list__mark' }),
        el(
          'span',
          { class: 'choice-list__text' },
          el('span', { class: 'choice-list__label' }, c.label),
          c.hint ? el('span', { class: 'choice-list__hint' }, c.hint) : null,
        ),
      ),
    );
    this.node.append(...this.buttons);
    this.set(value);
  }

  /** Marks `value` as selected without firing onChange. */
  set(value: T): void {
    for (const b of this.buttons) {
      const on = b.dataset.v === value;
      b.classList.toggle('choice-list__item--active', on);
      b.setAttribute('aria-checked', String(on));
    }
  }
}
