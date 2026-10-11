import { SAVE_DELAY_NOTEBOOK_MS, SAVE_DELAY_PAGE_MS } from '../core/constants';
import type { Notebook, Page } from '../core/types';
import type { NotebookRepository } from './NotebookRepository';
import type { PageRepository } from './PageRepository';

/**
 * Debounced persistence of the open notebook. Edits mark pages dirty; after a short pause
 * (700 ms for pages, 300 ms for notebook metadata) everything dirty is written in one go.
 * A failed write keeps the pages dirty so the next flush retries them.
 */
export class SaveQueue {
  private readonly dirtyPages = new Set<Page>();
  private notebookDirty = false;
  private notebook: Notebook | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly pages: PageRepository,
    private readonly notebooks: NotebookRepository,
    private readonly onError: (error: unknown) => void,
    /** Content was written (pages or notebook metadata changed); not called for forced no-op flushes. */
    private readonly onSaved: () => void = () => undefined,
  ) {}

  /** Sets the notebook whose metadata is written on flush (null when the editor is closed). */
  setNotebook(nb: Notebook | null): void {
    this.notebook = nb;
  }

  /** Queues a page (and its notebook) for saving. */
  markPageDirty(page: Page): void {
    this.dirtyPages.add(page);
    this.notebookDirty = true;
    this.schedule(SAVE_DELAY_PAGE_MS);
  }

  /** Queues only the notebook metadata (page order, view, base size…). */
  markNotebookDirty(): void {
    this.notebookDirty = true;
    this.schedule(SAVE_DELAY_NOTEBOOK_MS);
  }

  /** Drops a page from the queue, e.g. because it was deleted. */
  forget(page: Page): void {
    this.dirtyPages.delete(page);
  }

  /** Writes everything pending now. With `force`, the notebook is written even if nothing is dirty. */
  async flush(force = false): Promise<void> {
    clearTimeout(this.timer);
    const pages = [...this.dirtyPages];
    this.dirtyPages.clear();
    const nb = this.notebook;
    const changed = pages.length > 0 || this.notebookDirty;
    if (!changed && !force) return;
    this.notebookDirty = false;
    try {
      if (pages.length) await this.pages.save(...pages);
      if (nb) {
        if (changed) nb.updatedAt = Date.now();
        await this.notebooks.save(nb);
      }
      if (changed) this.onSaved();
    } catch (error) {
      for (const p of pages) this.dirtyPages.add(p);
      this.onError(error);
    }
  }

  private schedule(delay: number): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), delay);
  }
}
