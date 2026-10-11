import { AUTO_BACKUP_INTERVALS } from '../../core/constants';
import type { AutoBackupInterval } from '../../core/types';
import { byId, el, replaceChildren } from '../../core/utils/dom';
import { formatDate, formatRelativeDay } from '../../core/utils/format';
import { AutoBackupPolicy, type BackupState } from '../../domain/AutoBackupPolicy';
import type { I18n, TextKey } from '../../i18n/I18n';
import type { LibraryService } from '../../services/LibraryService';
import type { Menu, MenuEntry } from '../dialogs/Menu';
import { icon } from '../icons';
import { languageMenu, languageShort } from '../widgets/languageMenu';
import type { LibraryActions } from './LibraryActions';
import { SubjectDragController } from './SubjectDragController';
import { SubjectSection } from './SubjectSection';

export interface LibraryViewDeps {
  i18n: I18n;
  library: LibraryService;
  menu: Menu;
  actions: LibraryActions;
  /** Backup preferences, for the status line and the "Auto backup" menu. */
  backupState: () => BackupState;
  now: () => number;
}

/** The banner shown after an automatic backup in this session. */
export interface AutoBackupNotice {
  at: number;
  /** The backup is over 50 MB, so automatic copies are made at most weekly. */
  bytes: number;
}

const INTERVAL_LABELS: Record<AutoBackupInterval, TextKey> = {
  daily: 'autoBackup_daily',
  '3days': 'autoBackup_3days',
  weekly: 'autoBackup_weekly',
  off: 'autoBackup_off',
};

/** The shelf screen: header, backup status, search, warnings and subject sections. */
export class LibraryView {
  private readonly root = byId('library');
  private readonly list = byId('libList');
  private readonly subtitle = byId('libSub');
  private readonly backupLine = byId('libBackup');
  private readonly banner = byId('libBanner');
  private notice: AutoBackupNotice | null = null;
  private readonly drag: SubjectDragController;
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
    this.drag = new SubjectDragController({
      list: this.list,
      scroller: this.root,
      enabled: () => !this.query.trim(),
      onDrop: (ids) => actions.reorderSubjects(ids),
    });
  }

  private listen(target: HTMLElement, type: string, handler: () => void): void {
    target.addEventListener(type, handler);
    this.cleanup.push(() => target.removeEventListener(type, handler));
  }

  private moreEntries(): MenuEntry[] {
    const { i18n, actions } = this.deps;
    const interval = this.deps.backupState().autoBackup;
    return [
      { label: i18n.t('saveBackup'), icon: 'download', onClick: () => actions.saveBackup() },
      { label: i18n.t('restoreBackup'), icon: 'upload', onClick: () => actions.restoreBackup() },
      {
        label: i18n.t('autoBackup') + ' · ' + i18n.t(INTERVAL_LABELS[interval]),
        icon: 'folder',
        onClick: () => this.deps.menu.show(this.moreButton, this.intervalEntries()),
      },
      '-',
      { label: i18n.t('whereStored'), icon: 'info', onClick: () => actions.showStorageInfo() },
    ];
  }

  /** The "Auto backup" choices, with a check on the current one. */
  private intervalEntries(): MenuEntry[] {
    const { i18n, actions } = this.deps;
    const current = this.deps.backupState().autoBackup;
    return AUTO_BACKUP_INTERVALS.map((v) => ({
      label: i18n.t(INTERVAL_LABELS[v]),
      check: v === current,
      onClick: () => actions.setAutoBackup(v),
    }));
  }

  /** Shows the banner after an automatic backup (until dismissed, for this session). */
  showAutoBackupNotice(notice: AutoBackupNotice): void {
    this.notice = notice;
    this.renderBanner();
  }

  private renderBanner(): void {
    const notice = this.notice;
    if (!notice) {
      replaceChildren(this.banner);
      return;
    }
    const { i18n, actions } = this.deps;
    const text = i18n.t('autoBackupBanner', { date: formatDate(notice.at, i18n) });
    const large = AutoBackupPolicy.isLarge(notice.bytes)
      ? i18n.t('autoBackupLarge', { mb: Math.round(notice.bytes / 1048576) })
      : null;
    const dismiss = (): void => {
      this.notice = null;
      this.renderBanner();
    };
    replaceChildren(
      this.banner,
      el(
        'div',
        { class: 'backup-banner', attrs: { role: 'status' } },
        el('p', { class: 'backup-banner__text' }, text, large ? el('br') : null, large),
        el(
          'div',
          { class: 'backup-banner__actions' },
          el(
            'button',
            {
              class: 'btn btn--primary',
              attrs: { type: 'button' },
              on: { click: () => actions.saveBackup() },
            },
            i18n.t('saveCopy'),
          ),
          el(
            'button',
            {
              class: 'icon-btn',
              attrs: { type: 'button', 'aria-label': i18n.t('dismiss') },
              on: { click: dismiss },
            },
            icon('close', 20),
          ),
        ),
      ),
    );
  }

  /** Updates the backup status line (after a backup). */
  refreshBackupStatus(): void {
    this.renderBackupStatus();
  }

  /** "Last backup: yesterday", amber when old and there are unsaved changes. */
  private renderBackupStatus(): void {
    const { i18n } = this.deps;
    const state = this.deps.backupState();
    const when = state.lastBackupAt ? formatRelativeDay(state.lastBackupAt, i18n) : i18n.t('backupNever');
    this.backupLine.textContent = i18n.t('lastBackup', { when });
    this.backupLine.classList.toggle(
      'library__backup--stale',
      AutoBackupPolicy.isStale(state, this.deps.now()),
    );
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
    this.renderBackupStatus();
    this.renderBanner();
    if (this.drag.active) return;
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
    subjects.forEach((subject, i) => {
      const all = library.notebooksOf(subject.id);
      const subjectMatches = !q || subject.name.toLowerCase().includes(q);
      const shown = all.filter((n) => subjectMatches || n.title.toLowerCase().includes(q));
      if (q && !shown.length) return;
      const data = {
        subject,
        shown,
        total: all.length,
        searching: !!q,
        isFirst: i === 0,
        isLast: i === subjects.length - 1,
      };
      nodes.push(new SubjectSection(data, i18n, this.deps.menu, this.deps.actions).node);
    });
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
    this.drag.destroy();
  }
}
