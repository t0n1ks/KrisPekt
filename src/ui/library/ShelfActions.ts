import type { AutoBackupInterval, Language, Notebook, Subject } from '../../core/types';
import type { I18n } from '../../i18n/I18n';
import type { LibraryService } from '../../services/LibraryService';
import type { DialogFactory } from '../dialogs/DialogFactory';
import type { NotebookDialog } from '../dialogs/NotebookDialog';
import type { StorageInfoDialog } from '../dialogs/StorageInfoDialog';
import type { SubjectDialog } from '../dialogs/SubjectDialog';
import type { Toast } from '../dialogs/Toast';
import type { BackupFlow } from './BackupFlow';
import type { LibraryActions } from './LibraryActions';

export interface ShelfActionsDeps {
  i18n: I18n;
  library: LibraryService;
  dialogs: DialogFactory;
  toast: Toast;
  subjectDialog: SubjectDialog;
  notebookDialog: NotebookDialog;
  storageInfo: StorageInfoDialog;
  backup: BackupFlow;
  persistent: () => boolean;
  openNotebook: (nb: Notebook) => void;
  exportPdf: (nb: Notebook) => void;
  setLanguage: (language: Language) => void;
  setAutoBackup: (interval: AutoBackupInterval) => void;
  rerender: () => void;
  onError: (error: unknown) => void;
}

/** Implements the shelf's actions with dialogs and the library service. */
export class ShelfActions implements LibraryActions {
  constructor(private readonly deps: ShelfActionsDeps) {}

  openNotebook(nb: Notebook): void {
    this.deps.openNotebook(nb);
  }

  exportPdf(nb: Notebook): void {
    this.deps.exportPdf(nb);
  }

  newSubject(): void {
    this.deps.subjectDialog.open(null);
  }

  editSubject(subject: Subject): void {
    this.deps.subjectDialog.open(subject);
  }

  newNotebook(subjectId?: string): void {
    this.deps.notebookDialog.open(null, subjectId);
  }

  editNotebook(nb: Notebook): void {
    this.deps.notebookDialog.open(nb);
  }

  async deleteSubject(subject: Subject): Promise<void> {
    const { i18n, library } = this.deps;
    const count = library.notebooksOf(subject.id).length;
    const text = count
      ? i18n.t('delSubjText', { s: subject.name, n: i18n.plural(count, 'nb') })
      : i18n.t('delSubjEmpty', { s: subject.name });
    if (!(await this.deps.dialogs.confirm(i18n.t('delSubjQ'), text))) return;
    try {
      await library.deleteSubject(subject);
    } catch (error) {
      this.deps.onError(error);
    }
    this.deps.rerender();
  }

  async deleteNotebook(nb: Notebook): Promise<void> {
    const { i18n, library } = this.deps;
    if (!(await this.deps.dialogs.confirm(i18n.t('delNbQ'), i18n.t('delNbText', { t: nb.title })))) return;
    try {
      await library.deleteNotebook(nb);
      this.deps.toast.show(i18n.t('nbDeleted'));
    } catch (error) {
      this.deps.onError(error);
    }
    this.deps.rerender();
  }

  saveBackup(): void {
    void this.deps.backup.save();
  }

  restoreBackup(): void {
    void this.deps.backup.restore();
  }

  showStorageInfo(): void {
    this.deps.storageInfo.open(this.deps.persistent());
  }

  setLanguage(language: Language): void {
    this.deps.setLanguage(language);
  }

  setAutoBackup(interval: AutoBackupInterval): void {
    this.deps.setAutoBackup(interval);
  }

  moveSubject(subject: Subject, delta: -1 | 1): void {
    void this.persistOrder(() => this.deps.library.moveSubject(subject, delta));
  }

  reorderSubjects(ids: readonly string[]): void {
    void this.persistOrder(() => this.deps.library.reorderSubjects(ids));
  }

  moveNotebook(nb: Notebook, delta: -1 | 1): void {
    void this.persistOrder(() => this.deps.library.moveNotebook(nb, delta));
  }

  /** Saves a new order at once and redraws the shelf (also after a failed write). */
  private async persistOrder(write: () => Promise<void>): Promise<void> {
    try {
      await write();
    } catch (error) {
      this.deps.onError(error);
    }
    this.deps.rerender();
  }
}
