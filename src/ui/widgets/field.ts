import { el } from '../../core/utils/dom';

/** A labelled form field: an uppercase caption above a control. */
export function field(label: string, control: Node): HTMLDivElement {
  return el('div', { class: 'field' }, el('span', { class: 'field__label' }, label), control);
}
