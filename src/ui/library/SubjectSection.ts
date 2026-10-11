import type { Notebook, Subject } from '../../core/types';
import { el } from '../../core/utils/dom';
import { ColorLists } from '../../domain/ColorLists';
import type { I18n } from '../../i18n/I18n';
import type { Menu, MenuEntry } from '../dialogs/Menu';
import { icon } from '../icons';
import type { LibraryActions } from './LibraryActions';
import { NotebookCard } from './NotebookCard';

/** What one subject section shows. */
export interface SubjectSectionData {
  subject: Subject;
  /** Notebooks shown (filtered while searching), in shelf order. */
  shown: readonly Notebook[];
  /** All notebooks of the subject. */
  total: number;
  /** While searching, the shelf cannot be reordered. */
  searching: boolean;
  isFirst: boolean;
  isLast: boolean;
}

/**
 * One subject on the shelf: drag handle, coloured spine, name, notebook count, ⋯ menu and the
 * notebook covers. The section carries `data-subject-id` for {@link SubjectDragController}.
 */
export class SubjectSection {
  readonly node: HTMLElement;

  constructor(
    private readonly data: SubjectSectionData,
    private readonly i18n: I18n,
    private readonly menu: Menu,
    private readonly actions: LibraryActions,
  ) {
    const { subject, searching } = data;
    const more = el(
      'button',
      {
        class: 'icon-btn subject__more',
        attrs: { type: 'button', 'aria-label': i18n.t('subjActions', { n: subject.name }) },
      },
      icon('more'),
    );
    more.addEventListener('click', () => menu.show(more, this.menuEntries()));
    const light = ColorLists.isLight(subject.color);
    this.node = el(
      'section',
      { class: 'subject', attrs: { 'aria-label': subject.name, 'data-subject-id': subject.id } },
      el(
        'div',
        { class: 'subject__head' },
        searching ? null : this.handle(),
        el('span', {
          class: 'subject__spine' + (light ? ' subject__spine--light' : ''),
          style: { '--subject-color': subject.color },
        }),
        el('h2', { class: 'subject__name' }, subject.name),
        el('span', { class: 'subject__count' }, i18n.plural(data.total, 'nb')),
        more,
      ),
      this.shelf(),
    );
  }

  /** The drag handle; arrow keys move the subject too. */
  private handle(): HTMLButtonElement {
    const { subject } = this.data;
    const handle = el(
      'button',
      {
        class: 'icon-btn subject__handle',
        attrs: { type: 'button', 'aria-label': this.i18n.t('dragSubject', { n: subject.name }) },
      },
      icon('grip', 20),
    );
    handle.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowUp' && !this.data.isFirst) this.actions.moveSubject(subject, -1);
      else if (e.key === 'ArrowDown' && !this.data.isLast) this.actions.moveSubject(subject, 1);
      else return;
      e.preventDefault();
    });
    return handle;
  }

  private menuEntries(): MenuEntry[] {
    const { subject, searching, isFirst, isLast } = this.data;
    const { i18n, actions } = this;
    const moves: MenuEntry[] = [];
    if (!searching && !isFirst)
      moves.push({ label: i18n.t('up'), icon: 'up', onClick: () => actions.moveSubject(subject, -1) });
    if (!searching && !isLast)
      moves.push({ label: i18n.t('down'), icon: 'down', onClick: () => actions.moveSubject(subject, 1) });
    return [
      { label: i18n.t('newNotebook'), icon: 'plus', onClick: () => actions.newNotebook(subject.id) },
      { label: i18n.t('renameColor'), icon: 'edit', onClick: () => actions.editSubject(subject) },
      ...moves,
      '-',
      {
        label: i18n.t('deleteSubject'),
        icon: 'trash',
        danger: true,
        onClick: () => actions.deleteSubject(subject),
      },
    ];
  }

  private shelf(): HTMLElement {
    const { subject, shown, searching } = this.data;
    const { i18n, menu, actions } = this;
    const shelf = el('div', { class: 'shelf' });
    shown.forEach((nb, i) => {
      const position = { isFirst: i === 0, isLast: i === shown.length - 1, canMove: !searching };
      shelf.append(new NotebookCard(nb, subject, position, i18n, menu, actions).node);
    });
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
    return shelf;
  }
}
