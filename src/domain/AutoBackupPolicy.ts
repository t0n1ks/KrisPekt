import {
  AUTO_BACKUP_DAYS,
  BACKUP_STALE_DAYS,
  DAY_MS,
  LARGE_BACKUP_BYTES,
  LARGE_BACKUP_MIN_DAYS,
} from '../core/constants';
import type { Preferences } from '../core/types';

/** The preference fields the backup rules look at. */
export type BackupState = Pick<
  Preferences,
  'autoBackup' | 'lastBackupAt' | 'lastBackupBytes' | 'lastChangeAt'
>;

/** Pure rules for automatic backups and the shelf's backup status. */
export class AutoBackupPolicy {
  /** Whether the last backup was larger than 50 MB. */
  static isLarge(bytes: number): boolean {
    return bytes > LARGE_BACKUP_BYTES;
  }

  /**
   * Time between automatic backups, or null when they are off. Large backups (many imported
   * PDFs) are downloaded at most once a week, whatever the setting.
   */
  static intervalMs(state: BackupState): number | null {
    if (state.autoBackup === 'off') return null;
    const days = AUTO_BACKUP_DAYS[state.autoBackup];
    const effective = AutoBackupPolicy.isLarge(state.lastBackupBytes)
      ? Math.max(days, LARGE_BACKUP_MIN_DAYS)
      : days;
    return effective * DAY_MS;
  }

  /** Whether anything was written since the last backup. */
  static hasChanges(state: BackupState): boolean {
    return state.lastChangeAt > state.lastBackupAt;
  }

  /** An automatic backup is due when it is on, the interval has passed and something changed. */
  static isDue(state: BackupState, now: number): boolean {
    const interval = AutoBackupPolicy.intervalMs(state);
    if (interval === null || !AutoBackupPolicy.hasChanges(state)) return false;
    return now - state.lastBackupAt >= interval;
  }

  /** The status line turns amber: unsaved changes and no backup for more than a week (or never). */
  static isStale(state: BackupState, now: number): boolean {
    return AutoBackupPolicy.hasChanges(state) && now - state.lastBackupAt > BACKUP_STALE_DAYS * DAY_MS;
  }
}
