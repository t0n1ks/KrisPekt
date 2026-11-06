import type { Download, Page } from '@playwright/test';

/**
 * The next download that is not an automatic backup. A backup may start at any moment after a
 * notebook was opened, so the first download of all is not always the one a test asked for.
 */
export function exportDownload(page: Page): Promise<Download> {
  return page.waitForEvent('download', {
    predicate: (download) => !/^krispekt-backup-/.test(download.suggestedFilename()),
  });
}
