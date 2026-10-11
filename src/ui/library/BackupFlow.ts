import { dateStamp } from '../../core/utils/format';
import { pickFile } from '../../core/utils/files';
import type { FileSaver } from '../../features/files/FileSaver';
import type { I18n } from '../../i18n/I18n';
import type { LibraryService } from '../../services/LibraryService';
import { BackupError, type BackupService } from '../../storage/BackupService';
import type { DialogFactory } from '../dialogs/DialogFactory';
import type { Toast } from '../dialogs/Toast';

export interface BackupFlowDeps {
  i18n: I18n;
  backup: BackupService;
  library: LibraryService;
  files: FileSaver;
  dialogs: DialogFactory;
  toast: Toast;
  /** Writes pending edits before a backup is collected. */
  flush: () => Promise<void>;
  /** Redraws the shelf after a restore. */
  onRestored: () => void;
  /** A backup file was handed to the browser (`auto` for the automatic one). */
  onSaved: (bytes: number, auto: boolean) => void;
}

/** The user-facing steps of saving and restoring a backup. */
export class BackupFlow {
  constructor(private readonly deps: BackupFlowDeps) {}

  /** The backup the user asked for (a tap, so the download is never blocked). */
  async save(): Promise<void> {
    const { i18n, toast } = this.deps;
    toast.show(i18n.t('collecting'), 0);
    const blob = await this.build();
    if (!blob) return;
    await this.deps.files.save(`krispekt-${dateStamp()}.json`, blob);
    this.deps.onSaved(blob.size, false);
  }

  /**
   * The automatic backup: the same file as {@link save}, named `krispekt-backup-YYYY-MM-DD.json`.
   * The page cannot tell whether the browser kept the download, so the shelf also offers a
   * one-tap save afterwards.
   */
  async saveAuto(): Promise<void> {
    const blob = await this.build();
    if (!blob) return;
    await this.deps.files.save(`krispekt-backup-${dateStamp()}.json`, blob);
    this.deps.toast.show(this.deps.i18n.t('autoBackupDone'), 4000);
    this.deps.onSaved(blob.size, true);
  }

  /** Writes pending edits, then collects the backup; null (with a toast) if that fails. */
  private async build(): Promise<Blob | null> {
    try {
      await this.deps.flush();
      return await this.deps.backup.createBackup();
    } catch {
      this.deps.toast.show(this.deps.i18n.t('backupFail'));
      return null;
    }
  }

  /** Picks a file, validates all of it, asks for confirmation, then restores in one transaction. */
  async restore(): Promise<void> {
    const { i18n, toast, backup, library } = this.deps;
    const file = await pickFile('application/json,.json');
    if (!file) return;
    let doc;
    try {
      doc = await backup.readFile(file);
    } catch (error) {
      toast.show(
        error instanceof BackupError && error.reason === 'too-large'
          ? i18n.t('fileTooBig')
          : i18n.t('notBackup'),
      );
      return;
    }
    const text = i18n.t('restoreText', {
      s: i18n.plural(doc.subjects.length, 'subj'),
      n: i18n.plural(doc.notebooks.length, 'nb'),
    });
    if (!(await this.deps.dialogs.confirm(i18n.t('restoreQ'), text, i18n.t('restore'), false))) return;
    toast.show(i18n.t('restoring'), 0);
    try {
      await backup.restore(doc);
      await library.load();
      this.deps.onRestored();
      toast.show(i18n.t('restored'));
    } catch {
      toast.show(i18n.t('restoreFail'));
    }
  }
}
