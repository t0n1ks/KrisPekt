import { el } from '../../core/utils/dom';
import { dateStamp } from '../../core/utils/format';
import { pickFile } from '../../core/utils/files';
import type { FileSaver } from '../../features/files/FileSaver';
import type { I18n, TextKey } from '../../i18n/I18n';
import type { LibraryService } from '../../services/LibraryService';
import { BackupError, type BackupService, type ReadBackup } from '../../storage/BackupService';
import type { DialogFactory } from '../dialogs/DialogFactory';
import type { Toast } from '../dialogs/Toast';
import { PercentLine } from './PercentLine';

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

const REASON_TEXT: Record<BackupError['reason'], TextKey> = {
  'too-large': 'fileTooBig',
  invalid: 'notBackup',
  damaged: 'backupDamaged',
  newer: 'backupNewer',
  'no-space': 'restoreNoSpace',
};

/** Android's picker greys out what these do not list, and ZIP goes by several names there. */
const BACKUP_FILE_TYPES = 'application/zip,application/x-zip-compressed,application/json,.zip,.json';

/** The user-facing steps of saving and restoring a backup. */
export class BackupFlow {
  private busy = false;

  constructor(private readonly deps: BackupFlowDeps) {}

  /** The backup the user asked for (a tap, so the download is never blocked). */
  async save(): Promise<void> {
    const blob = await this.build(true);
    if (!blob) return;
    await this.deps.files.save(BackupFlow.fileName(), blob);
    this.deps.onSaved(blob.size, false);
  }

  /**
   * The automatic backup: the same file as {@link save}. It works quietly, without the percentage,
   * as nobody asked for it. The page cannot tell whether the browser kept the download, so the
   * shelf also offers a one-tap save afterwards.
   */
  async saveAuto(): Promise<void> {
    const blob = await this.build(false);
    if (!blob) return;
    await this.deps.files.save(BackupFlow.fileName(), blob);
    this.deps.toast.show(this.deps.i18n.t('autoBackupDone'), 4000);
    this.deps.onSaved(blob.size, true);
  }

  private static fileName(): string {
    return `krispekt-backup-${dateStamp()}.zip`;
  }

  /** About how many bytes a backup would take now; null if that cannot be told. */
  async estimateBytes(): Promise<number | null> {
    try {
      return await this.deps.backup.estimateBytes();
    } catch {
      return null;
    }
  }

  /** Writes pending edits, then collects the backup; null (with a toast) if that fails. */
  private async build(showProgress: boolean): Promise<Blob | null> {
    const { i18n, toast } = this.deps;
    if (this.busy) return null;
    this.busy = true;
    const progress = new PercentLine((percent) => toast.show(i18n.t('collecting', { p: percent }), 0));
    try {
      if (showProgress) progress.report(0);
      await this.deps.flush();
      const { file, skipped } = await this.deps.backup.createBackup(
        showProgress ? (done) => progress.report(done) : undefined,
      );
      if (showProgress) toast.hide();
      if (skipped) toast.show(i18n.t('backupSkipped', { n: skipped }), 8000);
      return file;
    } catch (error) {
      const large = error instanceof BackupError && error.reason === 'too-large';
      toast.show(i18n.t(large ? 'backupOverLimit' : 'backupFail'), large ? 8000 : undefined);
      return null;
    } finally {
      this.busy = false;
    }
  }

  /** Picks a file, checks it, asks for confirmation, then restores it, all of it or nothing. */
  async restore(): Promise<void> {
    if (this.busy) return;
    const file = await pickFile(BACKUP_FILE_TYPES);
    if (!file) return;
    this.busy = true;
    try {
      const backup = await this.read(file);
      if (backup && (await this.confirm(backup))) await this.write(backup);
    } finally {
      this.busy = false;
    }
  }

  /** The backup, checked, or null with the reason shown. */
  private async read(file: File): Promise<ReadBackup | null> {
    const { i18n, toast, backup } = this.deps;
    const progress = new PercentLine((percent) => toast.show(i18n.t('restoreChecking', { p: percent }), 0));
    try {
      progress.report(0);
      const read = await backup.readFile(file, (done) => progress.report(done));
      toast.hide();
      return read;
    } catch (error) {
      toast.show(i18n.t(error instanceof BackupError ? REASON_TEXT[error.reason] : 'notBackup'), 8000);
      return null;
    }
  }

  private confirm(backup: ReadBackup): Promise<boolean> {
    const { i18n, dialogs } = this.deps;
    const onShelf = <T extends { deletedAt?: number }>(items: readonly T[]): number =>
      items.filter((item) => item.deletedAt === undefined).length;
    const text = i18n.t('restoreText', {
      s: i18n.plural(onShelf(backup.subjects), 'subj'),
      n: i18n.plural(onShelf(backup.notebooks), 'nb'),
    });
    return dialogs.confirm(i18n.t('restoreQ'), text, i18n.t('restore'), false);
  }

  /** Writes the backup behind a sheet that cannot be closed: the shelf is about to change under it. */
  private async write(backup: ReadBackup): Promise<void> {
    const { i18n, toast, dialogs } = this.deps;
    const bar = el('progress', { class: 'backup-progress', attrs: { max: '100', value: '0' } });
    const line = el('p', { class: 'hint' });
    const progress = new PercentLine((percent) => {
      bar.value = percent;
      line.textContent = i18n.t('restoring', { p: percent });
    });
    progress.report(0);
    const sheet = dialogs.sheet({
      title: i18n.t('restoreBackup'),
      body: el('div', null, line, bar),
      locked: true,
    });
    try {
      await this.deps.backup.restore(backup, (done) => progress.report(done));
      await this.deps.library.load();
      this.deps.onRestored();
      toast.show(i18n.t('restored'));
    } catch (error) {
      const known = error instanceof BackupError;
      toast.show(i18n.t(known ? REASON_TEXT[error.reason] : 'restoreFail'), 8000);
    } finally {
      sheet.close();
    }
  }
}
