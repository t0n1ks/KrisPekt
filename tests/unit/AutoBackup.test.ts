import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTO_BACKUP_DELAY_MS, DAY_MS, LARGE_BACKUP_BYTES } from '../../src/core/constants';
import type { AutoBackupInterval } from '../../src/core/types';
import { formatRelativeDay } from '../../src/core/utils/format';
import { AutoBackupPolicy, type BackupState } from '../../src/domain/AutoBackupPolicy';
import { I18n } from '../../src/i18n/I18n';
import { AutoBackupScheduler } from '../../src/services/AutoBackupScheduler';

const NOW = Date.UTC(2026, 9, 11, 12);

/** Last backup `days` ago, a change one hour ago. */
function state(days: number, overrides: Partial<BackupState> = {}): BackupState {
  return {
    autoBackup: '3days',
    lastBackupAt: NOW - days * DAY_MS,
    lastBackupBytes: 1000,
    lastChangeAt: NOW - 3600_000,
    ...overrides,
  };
}

describe('AutoBackupPolicy', () => {
  it.each<[AutoBackupInterval, number, number]>([
    ['daily', 0.9, 1],
    ['3days', 2.9, 3],
    ['weekly', 6.9, 7],
  ])('%s: not due at %s days, due at %s days', (autoBackup, early, due) => {
    expect(AutoBackupPolicy.isDue(state(early, { autoBackup }), NOW)).toBe(false);
    expect(AutoBackupPolicy.isDue(state(due, { autoBackup }), NOW)).toBe(true);
  });

  it('never runs when switched off', () => {
    expect(AutoBackupPolicy.isDue(state(100, { autoBackup: 'off' }), NOW)).toBe(false);
  });

  it('does not back up when nothing changed since the last backup', () => {
    const s = state(10, { lastChangeAt: NOW - 11 * DAY_MS });
    expect(AutoBackupPolicy.isDue(s, NOW)).toBe(false);
  });

  it('backs up when there was never a backup but there are changes', () => {
    expect(AutoBackupPolicy.isDue(state(0, { lastBackupAt: 0 }), NOW)).toBe(true);
    expect(AutoBackupPolicy.isDue(state(0, { lastBackupAt: 0, lastChangeAt: 0 }), NOW)).toBe(false);
  });

  it('saves backups over 50 MB at most weekly', () => {
    const large = { lastBackupBytes: LARGE_BACKUP_BYTES + 1 };
    expect(AutoBackupPolicy.isDue(state(1, { autoBackup: 'daily', ...large }), NOW)).toBe(false);
    expect(AutoBackupPolicy.isDue(state(5, { ...large }), NOW)).toBe(false);
    expect(AutoBackupPolicy.isDue(state(7, { ...large }), NOW)).toBe(true);
    expect(
      AutoBackupPolicy.isDue(state(1, { autoBackup: 'daily', lastBackupBytes: LARGE_BACKUP_BYTES }), NOW),
    ).toBe(true);
  });

  it('marks the status stale after 7 days with unsaved changes', () => {
    expect(AutoBackupPolicy.isStale(state(8), NOW)).toBe(true);
    expect(AutoBackupPolicy.isStale(state(6), NOW)).toBe(false);
    expect(AutoBackupPolicy.isStale(state(8, { lastChangeAt: NOW - 9 * DAY_MS }), NOW)).toBe(false);
    expect(AutoBackupPolicy.isStale(state(0, { lastBackupAt: 0 }), NOW)).toBe(true);
  });
});

describe('AutoBackupScheduler', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function scheduler(s: BackupState, dialogOpen = () => false) {
    const run = vi.fn(async () => undefined);
    const sched = new AutoBackupScheduler({ state: () => s, now: () => NOW, dialogOpen, run });
    return { sched, run };
  }

  it('runs about 2 s after the app opens, not at once', async () => {
    const { sched, run } = scheduler(state(4));
    sched.appOpened();
    await vi.advanceTimersByTimeAsync(AUTO_BACKUP_DELAY_MS - 100);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('starts at most one automatic download per session', async () => {
    const { sched, run } = scheduler(state(4));
    sched.appOpened();
    await vi.advanceTimersByTimeAsync(3000);
    sched.appResumed(2 * 3600_000);
    sched.appOpened();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await sched.check()).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('waits while a dialog is open', async () => {
    let open = true;
    const { sched, run } = scheduler(state(4), () => open);
    sched.appOpened();
    await vi.advanceTimersByTimeAsync(6000);
    expect(run).not.toHaveBeenCalled();
    open = false;
    await vi.advanceTimersByTimeAsync(3500);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('checks again only after more than an hour in the background', async () => {
    const s = state(1);
    const { sched, run } = scheduler(s);
    sched.appOpened();
    await vi.advanceTimersByTimeAsync(3000);
    expect(run).not.toHaveBeenCalled();
    s.lastBackupAt = NOW - 4 * DAY_MS;
    sched.appResumed(10 * 60_000);
    await vi.advanceTimersByTimeAsync(3000);
    expect(run).not.toHaveBeenCalled();
    sched.appResumed(61 * 60_000);
    await vi.advanceTimersByTimeAsync(3000);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('does nothing when nothing is due', async () => {
    const { sched, run } = scheduler(state(4, { autoBackup: 'off' }));
    sched.appOpened();
    await vi.advanceTimersByTimeAsync(5000);
    expect(run).not.toHaveBeenCalled();
    expect(sched.done).toBe(false);
  });
});

describe('formatRelativeDay', () => {
  const now = new Date(2026, 9, 11, 15, 0);
  const daysAgo = (d: number): number => new Date(2026, 9, 11 - d, 10, 0).getTime();

  it.each([
    ['ru', 'сегодня', 'вчера', '3 дня назад'],
    ['uk', 'сьогодні', 'учора', '3 дні тому'],
    ['de', 'heute', 'gestern', 'vor 3 Tagen'],
    ['en', 'today', 'yesterday', '3 days ago'],
  ] as const)('%s', (lang, today, yesterday, three) => {
    const i18n = new I18n(lang);
    expect(formatRelativeDay(daysAgo(0), i18n, now)).toBe(today);
    expect(formatRelativeDay(daysAgo(1), i18n, now)).toBe(yesterday);
    expect(formatRelativeDay(daysAgo(3), i18n, now)).toBe(three);
  });

  it('uses months for older dates and treats the future as today', () => {
    const en = new I18n('en');
    expect(formatRelativeDay(daysAgo(61), en, now)).toBe('2 months ago');
    expect(formatRelativeDay(now.getTime() + DAY_MS, en, now)).toBe('today');
  });
});
