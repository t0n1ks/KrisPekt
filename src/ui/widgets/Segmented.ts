import { el } from '../../core/utils/dom';

export interface SegmentOption<T extends string> {
  v: T;
  label: string;
}

/** A segmented control: a group of mutually exclusive buttons. */
export class Segmented<T extends string> {
  readonly node: HTMLDivElement;
  private readonly buttons: HTMLButtonElement[];

  constructor(options: readonly SegmentOption<T>[], value: T, onChange: (value: T) => void) {
    this.node = el('div', { class: 'segmented', attrs: { role: 'group' } });
    this.buttons = options.map((o) =>
      el(
        'button',
        {
          class: 'segmented__button',
          attrs: { type: 'button', 'data-v': o.v },
          on: {
            click: () => {
              this.set(o.v);
              onChange(o.v);
            },
          },
        },
        o.label,
      ),
    );
    this.node.append(...this.buttons);
    this.set(value);
  }

  /** Marks `value` as selected without firing onChange. */
  set(value: T): void {
    for (const b of this.buttons) b.classList.toggle('segmented__button--active', b.dataset.v === value);
  }
}
