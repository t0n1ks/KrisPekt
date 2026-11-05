import type { BlobRepository } from '../storage/BlobRepository';
import type { TabPresence } from './TabPresence';

export interface BlobSweeperDeps {
  blobs: Pick<BlobRepository, 'sweep'>;
  tabs: Pick<TabPresence, 'othersOpen'>;
  /** Blobs in use that stored pages do not reference: undo steps and pages awaiting Undo. */
  inUse: () => ReadonlySet<string>;
  /** Saves pending edits, so that stored pages show everything in use. */
  flush: () => Promise<void>;
  isDue: () => boolean;
  setDue: (due: boolean) => void;
  onError: (error: unknown) => void;
}

/**
 * Removes stored images and PDF backgrounds that no page references any more.
 *
 * "Due" is remembered across restarts and set before pages are deleted, so a cleanup interrupted
 * by closing the app runs on the next start. It stays due while another tab is open, or while a
 * blob is only spared for now (an undo step may bring it back).
 */
export class BlobSweeper {
  private running = false;

  constructor(private readonly deps: BlobSweeperDeps) {}

  /** Asks for a cleanup at the next {@link run}. */
  markDue(): void {
    this.deps.setDue(true);
  }

  /** Cleans up now if a cleanup is due. Never throws. */
  async run(): Promise<void> {
    if (this.running || !this.deps.isDue()) return;
    this.running = true;
    try {
      await this.deps.flush();
      if (await this.deps.tabs.othersOpen()) return;
      const { spared } = await this.deps.blobs.sweep(this.deps.inUse());
      this.deps.setDue(spared > 0);
    } catch (error) {
      this.deps.onError(error);
    } finally {
      this.running = false;
    }
  }
}
