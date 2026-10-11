import { byId, el, replaceChildren } from '../../core/utils/dom';
import type { I18n } from '../../i18n/I18n';
import type { LibraryService } from '../../services/LibraryService';
import type { Menu } from '../dialogs/Menu';
import { icon } from '../icons';
import { languageMenu, languageShort } from '../widgets/languageMenu';
import type { LibraryActions } from './LibraryActions';
import { SubjectSection } from './SubjectSection';

export interface LibraryViewDeps {
  i18n: I18n;
  library: LibraryService;
  menu: Menu;
  actions: LibraryActions;
}

/** The shelf screen: header, search, storage warning and subject sections. */
export class LibraryView {
  private readonly root = byId('library');
  private readonly list = byId('libList');
  private readonly subtitle = byId('libSub');
  private readonly search = byId<HTMLInputElement>('q');
  private readonly addSubject = byId<HTMLButtonElement>('btnAddSubject');
  private readonly addNotebook = byId<HTMLButtonElement>('btnAddNb');
  private readonly langButton = byId<HTMLButtonElement>('btnLang');
  private readonly moreButton = byId<HTMLButtonElement>('btnLibMore');
  private query = '';
  private readonly cleanup: (() => void)[] = [];

  constructor(private readonly deps: LibraryViewDeps) {
    byId('searchIc').append(icon('search', 19));
    this.moreButton.append(icon('more'));
    const { actions, menu } = deps;
    this.listen(this.addSubject, 'click', () => actions.newSubject());
    this.listen(this.addNotebook, 'click', () => actions.newNotebook());
    this.listen(this.langButton, 'click', () =>
      menu.show(
        this.langButton,
        languageMenu(deps.i18n.language, (l) => actions.setLanguage(l)),
      ),
    );
    this.listen(this.moreButton, 'click', () => menu.show(this.moreButton, this.moreEntries()));
    this.listen(this.search, 'input', () => {
      this.query = this.search.value;
      this.render();
    });
  }

  private listen(target: HTMLElement, type: string, handler: () => void): void {
    target.addEventListener(type, handler);
    this.cleanup.push(() => target.removeEventListener(type, handler));
  }

  private moreEntries() {
    const { i18n, actions } = this.deps;
    return [
      { label: i18n.t('saveBackup'), icon: 'download' as const, onClick: () => actions.saveBackup() },
      { label: i18n.t('restoreBackup'), icon: 'upload' as const, onClick: () => actions.restoreBackup() },
      '-' as const,
      { label: i18n.t('whereStored'), icon: 'info' as const, onClick: () => actions.showStorageInfo() },
    ];
  }

  show(): void {
    this.root.hidden = false;
    this.render();
  }

  hide(): void {
    this.root.hidden = true;
  }

  /** Shows the "storage blocked" warning bar. */
  showStorageWarning(): void {
    replaceChildren(
      byId('libWarn'),
      el('div', { class: 'warnbar', attrs: { role: 'alert' } }, this.deps.i18n.t('storageBar')),
    );
  }

  /** Re-applies translated static labels (after a language change). */
  applyLanguage(hasWarning: boolean): void {
    const t = this.deps.i18n;
    this.root.setAttribute('aria-label', t.t('libAria'));
    this.moreButton.setAttribute('aria-label', t.t('more'));
    this.search.placeholder = t.t('searchPh');
    this.langButton.setAttribute('aria-label', t.t('language'));
    replaceChildren(this.addSubject, icon('folder', 19), el('span', null, t.t('subject')));
    replaceChildren(this.addNotebook, icon('plus', 19), el('span', null, t.t('notebook')));
    replaceChildren(this.langButton, icon('globe', 17), el('span', null, languageShort(t.language)));
    if (hasWarning) this.showStorageWarning();
  }

  /** Rebuilds the shelf for the current data and search query. */
  render(): void {
    const { i18n, library } = this.deps;
    const subjects = library.sortedSubjects();
    this.subtitle.textContent = subjects.length
      ? i18n.plural(subjects.length, 'subj') + ' · ' + i18n.plural(library.notebooks.length, 'nb')
      : i18n.t('libSubEmpty');
    if (!subjects.length) {
      replaceChildren(this.list, this.emptyState());
      return;
    }
    const q = this.query.trim().toLowerCase();
    const nodes: Node[] = [];
    for (const subject of subjects) {
      const all = library.notebooksOf(subject.id);
      const subjectMatches = !q || subject.name.toLowerCase().includes(q);
      const shown = all.filter((n) => subjectMatches || n.title.toLowerCase().includes(q));
      if (q && !shown.length) continue;
      nodes.push(
        new SubjectSection(subject, shown, all.length, !!q, i18n, this.deps.menu, this.deps.actions).node,
      );
    }
    if (q && !nodes.length) {
      nodes.push(el('p', { class: 'hint library__no-results' }, i18n.t('noResults', { q: this.query })));
    }
    if (!q) nodes.push(this.footer());
    replaceChildren(this.list, ...nodes);
  }

  private emptyState(): HTMLElement {
    const { i18n, actions } = this.deps;
    return el(
      'div',
      { class: 'library-empty' },
      el('h2', { class: 'library-empty__title' }, i18n.t('emptyTitle')),
      el('p', { class: 'library-empty__text' }, i18n.t('emptyText')),
      el(
        'button',
        { class: 'btn btn--primary', attrs: { type: 'button' }, on: { click: () => actions.newSubject() } },
        el('span', null, icon('plus', 20)),
        i18n.t('newSubject'),
      ),
    );
  }

  private footer(): HTMLElement {
    const { i18n, actions } = this.deps;
    return el(
      'div',
      { class: 'library__foot' },
      el(
        'button',
        { class: 'btn', attrs: { type: 'button' }, on: { click: () => actions.newSubject() } },
        el('span', null, icon('plus', 20)),
        i18n.t('newSubject'),
      ),
    );
  }

  /** Removes the listeners this view added to the shell. */
  destroy(): void {
    for (const off of this.cleanup.splice(0)) off();
  }
}
