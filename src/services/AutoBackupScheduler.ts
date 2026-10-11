import { AUTO_BACKUP_DELAY_MS, AUTO_BACKUP_RESUME_MS, AUTO_BACKUP_RETRY_MS } from '../core/constants';
import { AutoBackupPolicy, type BackupState } from '../domain/AutoBackupPolicy';

export interface AutoBackupSchedulerDeps {
  /** Current backup preferences. */
  state: () => BackupState;
  now: () => number;
  /** True while a dialog (sheet) is open: the download must not start then. */
  dialogOpen: () => boolean;
  /** Builds and downloads the backup. */
  run: () => Promise<void>;
}

/**
 * Decides when the automatic backup runs: a couple of seconds after the app opens, and again
 * when it comes back after more than an hour in the background. At most one automatic download
 * is started per session (a browser may block or question repeated downloads), and never while
 * a dialog is open; then it waits and checks again.
 */
export class AutoBackupScheduler {
  private started = false;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly deps: AutoBackupSchedulerDeps) {}

  /** The app was opened. */
  appOpened(): void {
    this.schedule(AUTO_BACKUP_DELAY_MS);
  }

  /** The app became visible again after `hiddenMs` in the background. */
  appResumed(hiddenMs: number): void {
    if (hiddenMs >= AUTO_BACKUP_RESUME_MS) this.schedule(AUTO_BACKUP_DELAY_MS);
  }

  /** Whether this session already started its automatic backup. */
  get done(): boolean {
    return this.started;
  }

  /** Runs the backup if it is due. Returns true if it started one. */
  async check(): Promise<boolean> {
    if (this.started || !AutoBackupPolicy.isDue(this.deps.state(), this.deps.now())) return false;
    if (this.deps.dialogOpen()) {
      this.schedule(AUTO_BACKUP_RETRY_MS);
      return false;
    }
    this.started = true;
    await this.deps.run();
    return true;
  }

  /** Stops a pending check. */
  cancel(): void {
    clearTimeout(this.timer);
  }

  private schedule(ms: number): void {
    if (this.started) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.check(), ms);
  }
}
