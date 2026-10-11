import type { Notebook, Subject } from '../../core/types';
import { el } from '../../core/utils/dom';
import { formatDate } from '../../core/utils/format';
import type { I18n } from '../../i18n/I18n';
import type { Menu } from '../dialogs/Menu';
import { icon } from '../icons';
import type { LibraryActions } from './LibraryActions';

/** A notebook on the shelf: a school-notebook cover with a paper label, and a meta line with a ⋯ menu. */
export class NotebookCard {
  readonly node: HTMLDivElement;

  constructor(nb: Notebook, subject: Subject, i18n: I18n, menu: Menu, actions: LibraryActions) {
    const more = el(
      'button',
      {
        class: 'icon-btn notebook-card__more',
        attrs: { type: 'button', 'aria-label': i18n.t('nbActions', { n: nb.title }) },
      },
      icon('more', 20),
    );
    more.addEventListener('click', () =>
      menu.show(more, [
        { label: i18n.t('open'), icon: 'page', onClick: () => actions.openNotebook(nb) },
        { label: i18n.t('nbSettings'), icon: 'edit', onClick: () => actions.editNotebook(nb) },
        { label: i18n.t('savePdf'), icon: 'download', onClick: () => actions.exportPdf(nb) },
        '-',
        {
          label: i18n.t('deleteNotebook'),
          icon: 'trash',
          danger: true,
          onClick: () => actions.deleteNotebook(nb),
        },
      ]),
    );
    const cover = el(
      'button',
      {
        class: 'notebook-card__cover',
        attrs: { type: 'button', 'aria-label': i18n.t('openNb', { n: nb.title }) },
        style: { '--cover-color': nb.color },
        on: { click: () => actions.openNotebook(nb) },
      },
      el(
        'span',
        { class: 'notebook-card__label' },
        el('span', { class: 'notebook-card__kicker' }, i18n.t('notebook')),
        el('span', { class: 'notebook-card__title' }, nb.title),
        el('span', { class: 'notebook-card__subject' }, subject.name),
      ),
      nb.sample ? el('span', { class: 'notebook-card__badge' }, i18n.t('sample')) : null,
    );
    const meta = i18n.t('pagesShort', { n: nb.pageIds.length }) + ' · ' + formatDate(nb.updatedAt, i18n);
    this.node = el(
      'div',
      { class: 'notebook-card' },
      cover,
      el(
        'div',
        { class: 'notebook-card__meta' },
        el('span', { class: 'notebook-card__meta-text' }, meta),
        more,
      ),
    );
  }
}
