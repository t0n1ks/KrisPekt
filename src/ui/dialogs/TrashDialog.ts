import { TRASH_DAYS } from '../../core/constants';
import type { Notebook, Subject } from '../../core/types';
import { el, replaceChildren } from '../../core/utils/dom';
import { formatDate, formatSize } from '../../core/utils/format';
import { TrashRules } from '../../domain/TrashRules';
import type { StorageReport } from '../../domain/StorageBreakdown';
import type { I18n } from '../../i18n/I18n';
import type { LibraryService } from '../../services/LibraryService';
import { icon } from '../icons';
import type { DialogFactory } from './DialogFactory';
import type { Sheet } from './Sheet';
import type { Toast } from './Toast';

export interface TrashDialogDeps {
  i18n: I18n;
  dialogs: DialogFactory;
  library: LibraryService;
  toast: Toast;
  now: () => number;
  /** What is stored now, for the sizes shown; rejects if that cannot be read. */
  measure: () => Promise<StorageReport>;
  /** The shelf changed. */
  onChanged: () => void;
  onError: (error: unknown) => void;
}

/** The Trash: what was deleted and how long it stays, with restoring and deleting for good. */
export class TrashDialog {
  private readonly body = el('div', { class: 'trash' });
  private sheet: Sheet | null = null;
  private trashBytes: number | null = null;
  private sizes = new Map<string, number>();

  constructor(private readonly deps: TrashDialogDeps) {}

  /** Opens the Trash. */
  open(): void {
    const { i18n, dialogs } = this.deps;
    this.render();
    this.sheet = dialogs.sheet({
      title: i18n.t('trash'),
      body: this.body,
      onClose: () => (this.sheet = null),
    });
    void this.refresh();
  }

  /** Re-reads the sizes, then draws the list again. */
  private async refresh(): Promise<void> {
    try {
      const report = await this.deps.measure();
      this.trashBytes = report.trash;
      this.sizes = new Map(report.trashedNotebooks.map((row) => [row.notebook.id, row.total]));
    } catch {
      this.trashBytes = null;
      this.sizes = new Map();
    }
    if (this.sheet) this.render();
  }

  private render(): void {
    const { i18n, library } = this.deps;
    const { subjects, notebooks } = library.trash();
    if (!subjects.length && !notebooks.length) {
      replaceChildren(this.body, el('p', { class: 'hint hint--large' }, i18n.t('trashEmpty')));
      return;
    }
    replaceChildren(
      this.body,
      el('p', { class: 'hint' }, i18n.t('trashHint', { days: TRASH_DAYS })),
      el(
        'ul',
        { class: 'trash__list' },
        ...subjects.map((subject) => this.subjectRow(subject)),
        ...notebooks.map((nb) => this.notebookRow(nb)),
      ),
      el(
        'button',
        {
          class: 'btn btn--danger trash__empty',
          attrs: { type: 'button' },
          on: { click: () => void this.emptyAll() },
        },
        i18n.t('trashEmptyAction'),
      ),
    );
  }

  private subjectRow(subject: Subject): HTMLElement {
    const { i18n, library } = this.deps;
    const inside = library.deletedWith(subject);
    const bytes = inside.reduce((all, nb) => all + (this.sizes.get(nb.id) ?? 0), 0);
    return this.row(
      subject.name,
      [
        i18n.t('trashKindSubject', { n: i18n.plural(inside.length, 'nb') }),
        ...this.facts(subject.deletedAt, bytes),
      ],
      () => this.restoreSubject(subject),
      () => this.deleteSubject(subject),
    );
  }

  private notebookRow(nb: Notebook): HTMLElement {
    const { i18n, library } = this.deps;
    const home = library.subject(nb.subjectId)?.name ?? '';
    return this.row(
      nb.title,
      [
        ...(home ? [i18n.t('trashKindNotebook', { s: home })] : []),
        ...this.facts(nb.deletedAt, this.sizes.get(nb.id)),
      ],
      () => this.restoreNotebook(nb),
      () => this.deleteNotebook(nb),
    );
  }

  /** "Deleted 3 Nov", "27 days left", and the size once it is known. */
  private facts(deletedAt: number | undefined, bytes: number | undefined): string[] {
    const { i18n, now } = this.deps;
    const at = deletedAt ?? now();
    const days = TrashRules.daysLeft(at, now());
    return [
      i18n.t('trashDeletedOn', { date: formatDate(at, i18n) }),
      days ? i18n.t('trashDaysLeft', { n: i18n.plural(days, 'day') }) : i18n.t('trashLastDay'),
      ...(bytes === undefined ? [] : [formatSize(bytes, i18n)]),
    ];
  }

  private row(
    title: string,
    facts: readonly string[],
    restore: () => Promise<void>,
    remove: () => Promise<void>,
  ): HTMLElement {
    const { i18n } = this.deps;
    return el(
      'li',
      { class: 'trash__row' },
      el(
        'div',
        { class: 'trash__text' },
        el('span', { class: 'trash__title' }, title),
        el('span', { class: 'trash__facts' }, facts.join(' · ')),
      ),
      el(
        'div',
        { class: 'trash__actions' },
        el(
          'button',
          { class: 'btn', attrs: { type: 'button' }, on: { click: () => void this.act(restore) } },
          i18n.t('trashRestore'),
        ),
        el(
          'button',
          {
            class: 'icon-btn',
            attrs: { type: 'button', 'aria-label': i18n.t('trashDeleteForever') },
            on: { click: () => void this.act(remove) },
          },
          icon('trash', 20),
        ),
      ),
    );
  }

  /** Runs an action, and shows the result whichever way it went. */
  private async act(action: () => Promise<void>): Promise<void> {
    try {
      await action();
    } catch (error) {
      this.deps.onError(error);
    }
    this.deps.onChanged();
    this.render();
    void this.refresh();
  }

  private async restoreSubject(subject: Subject): Promise<void> {
    await this.deps.library.restoreSubject(subject);
    this.deps.toast.show(this.deps.i18n.t('trashRestored', { t: subject.name }));
  }

  private async restoreNotebook(nb: Notebook): Promise<void> {
    const { i18n, library, toast } = this.deps;
    const withSubject = await library.restoreNotebook(nb, i18n.t('trashFoundSubject'));
    toast.show(
      withSubject
        ? i18n.t('trashRestoredWithSubject', { t: nb.title, s: withSubject.name })
        : i18n.t('trashRestored', { t: nb.title }),
      withSubject ? 6000 : undefined,
    );
  }

  private async deleteSubject(subject: Subject): Promise<void> {
    const { i18n, dialogs, library } = this.deps;
    const text = i18n.t('trashForeverSubject', { s: subject.name });
    if (await dialogs.confirm(i18n.t('trashForeverQ'), text)) await library.deleteSubjectForever(subject);
  }

  private async deleteNotebook(nb: Notebook): Promise<void> {
    const { i18n, dialogs, library } = this.deps;
    const text = i18n.t('trashForeverNotebook', { t: nb.title });
    if (await dialogs.confirm(i18n.t('trashForeverQ'), text)) await library.deleteNotebookForever(nb);
  }

  private async emptyAll(): Promise<void> {
    const { i18n, dialogs, library } = this.deps;
    const size = this.trashBytes === null ? '' : formatSize(this.trashBytes, i18n);
    const text = i18n.t(size ? 'trashEmptySized' : 'trashEmptyText', { size });
    if (!(await dialogs.confirm(i18n.t('trashEmptyQ'), text))) return;
    await this.act(() => library.emptyTrash());
  }
}
