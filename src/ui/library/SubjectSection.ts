import type { Notebook, Subject } from '../../core/types';
import { el } from '../../core/utils/dom';
import type { I18n } from '../../i18n/I18n';
import type { Menu } from '../dialogs/Menu';
import { icon } from '../icons';
import type { LibraryActions } from './LibraryActions';
import { NotebookCard } from './NotebookCard';

/** One subject on the shelf: coloured spine, name, notebook count, ⋯ menu and the notebook covers. */
export class SubjectSection {
  readonly node: HTMLElement;

  constructor(
    subject: Subject,
    shown: readonly Notebook[],
    total: number,
    searching: boolean,
    i18n: I18n,
    menu: Menu,
    actions: LibraryActions,
  ) {
    const more = el(
      'button',
      {
        class: 'icon-btn subject__more',
        attrs: { type: 'button', 'aria-label': i18n.t('subjActions', { n: subject.name }) },
      },
      icon('more'),
    );
    more.addEventListener('click', () =>
      menu.show(more, [
        { label: i18n.t('newNotebook'), icon: 'plus', onClick: () => actions.newNotebook(subject.id) },
        { label: i18n.t('renameColor'), icon: 'edit', onClick: () => actions.editSubject(subject) },
        '-',
        {
          label: i18n.t('deleteSubject'),
          icon: 'trash',
          danger: true,
          onClick: () => actions.deleteSubject(subject),
        },
      ]),
    );
    const shelf = el('div', { class: 'shelf' });
    for (const nb of shown) shelf.append(new NotebookCard(nb, subject, i18n, menu, actions).node);
    if (!searching) {
      shelf.append(
        el(
          'button',
          {
            class: 'shelf__add',
            attrs: { type: 'button' },
            on: { click: () => actions.newNotebook(subject.id) },
          },
          el('span', null, icon('plus', 24)),
          i18n.t('newNotebook'),
        ),
      );
    }
    this.node = el(
      'section',
      { class: 'subject', attrs: { 'aria-label': subject.name } },
      el(
        'div',
        { class: 'subject__head' },
        el('span', { class: 'subject__spine', style: { '--subject-color': subject.color } }),
        el('h2', { class: 'subject__name' }, subject.name),
        el('span', { class: 'subject__count' }, i18n.plural(total, 'nb')),
        more,
      ),
      shelf,
    );
  }
}
