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
}

/** The user-facing steps of saving and restoring a backup. */
export class BackupFlow {
  constructor(private readonly deps: BackupFlowDeps) {}

  async save(): Promise<void> {
    const { i18n, toast } = this.deps;
    await this.deps.flush();
    toast.show(i18n.t('collecting'), 0);
    try {
      const blob = await this.deps.backup.createBackup();
      await this.deps.files.save(`krispekt-${dateStamp()}.json`, blob);
    } catch {
      toast.show(i18n.t('backupFail'));
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
