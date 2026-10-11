import { el } from '../../core/utils/dom';

export interface SegmentOption<T extends string> {
  v: T;
  label: string;
  /** Optional icon shown above the label (large variant). */
  icon?: Node;
}

/** A segmented control: a group of mutually exclusive buttons. */
export class Segmented<T extends string> {
  readonly node: HTMLDivElement;
  private readonly buttons: HTMLButtonElement[];

  /** @param large full-width buttons with an icon above the label */
  constructor(options: readonly SegmentOption<T>[], value: T, onChange: (value: T) => void, large = false) {
    this.node = el('div', {
      class: 'segmented' + (large ? ' segmented--large' : ''),
      attrs: { role: 'group' },
    });
    this.buttons = options.map((o) =>
      el(
        'button',
        {
          class: 'segmented__button',
          attrs: { type: 'button', 'data-v': o.v, 'aria-pressed': 'false' },
          on: {
            click: () => {
              this.set(o.v);
              onChange(o.v);
            },
          },
        },
        o.icon ?? null,
        large ? el('span', { class: 'segmented__label' }, o.label) : o.label,
      ),
    );
    this.node.append(...this.buttons);
    this.set(value);
  }

  /** Marks `value` as selected without firing onChange. */
  set(value: T): void {
    for (const b of this.buttons) {
      const on = b.dataset.v === value;
      b.classList.toggle('segmented__button--active', on);
      b.setAttribute('aria-pressed', String(on));
    }
  }
}
