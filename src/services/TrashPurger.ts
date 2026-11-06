import { TRASH_PURGE_INTERVAL_MS } from '../core/constants';
import type { LibraryService } from './LibraryService';
import type { TabPresence } from './TabPresence';

export interface TrashPurgerDeps {
  library: Pick<LibraryService, 'purgeExpired'>;
  tabs: Pick<TabPresence, 'othersOpen'>;
  now: () => number;
  /** Items were removed: the shelf's figures changed. */
  onPurged: () => void;
  onError: (error: unknown) => void;
}

/**
 * Removes items that have been in the Trash for 30 days: on start and then hourly, since a tablet
 * can leave the app open for days. It waits while another tab is open, as that tab's undo steps may
 * still need the files.
 */
export class TrashPurger {
  private timer: ReturnType<typeof setInterval> | undefined;
  private running = false;

  constructor(private readonly deps: TrashPurgerDeps) {}

  /** Purges now and keeps doing so. */
  start(): void {
    void this.run();
    this.timer = setInterval(() => void this.run(), TRASH_PURGE_INTERVAL_MS);
  }

  stop(): void {
    clearInterval(this.timer);
  }

  /** One round. Never throws. */
  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      if (await this.deps.tabs.othersOpen()) return;
      if ((await this.deps.library.purgeExpired(this.deps.now())) > 0) this.deps.onPurged();
    } catch (error) {
      this.deps.onError(error);
    } finally {
      this.running = false;
    }
  }
}
