import { SAVE_DELAY_NOTEBOOK_MS, SAVE_DELAY_PAGE_MS } from '../core/constants';
import type { Notebook, Page } from '../core/types';
import type { PageRepository } from './PageRepository';

/**
 * Debounced persistence of the open notebook. Edits mark pages dirty; after a short pause
 * (700 ms for pages, 300 ms for notebook metadata) everything dirty is written in one
 * transaction. A failed write keeps everything dirty so the next flush retries it.
 */
export class SaveQueue {
  private readonly dirtyPages = new Set<Page>();
  private readonly deletedPages = new Set<string>();
  private notebookDirty = false;
  private notebook: Notebook | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly pages: PageRepository,
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
    this.deletedPages.delete(page.id);
    this.dirtyPages.add(page);
    this.notebookDirty = true;
    this.schedule(SAVE_DELAY_PAGE_MS);
  }

  /** Queues only the notebook metadata (page order, view, base size…). */
  markNotebookDirty(): void {
    this.notebookDirty = true;
    this.schedule(SAVE_DELAY_NOTEBOOK_MS);
  }

  /** Queues a page's removal; it is deleted in the same transaction as the new page order. */
  markPageDeleted(page: Page): void {
    this.dirtyPages.delete(page);
    this.deletedPages.add(page.id);
    this.notebookDirty = true;
    this.schedule(SAVE_DELAY_NOTEBOOK_MS);
  }

  /** Writes everything pending now. With `force`, the notebook is written even if nothing is dirty. */
  async flush(force = false): Promise<void> {
    clearTimeout(this.timer);
    const pages = [...this.dirtyPages];
    const deleted = [...this.deletedPages];
    this.dirtyPages.clear();
    this.deletedPages.clear();
    const nb = this.notebook;
    const changed = pages.length > 0 || deleted.length > 0 || this.notebookDirty;
    if (!changed && !force) return;
    this.notebookDirty = false;
    try {
      if (nb && changed) nb.updatedAt = Date.now();
      await this.pages.commit(nb, pages, deleted);
      if (changed) this.onSaved();
    } catch (error) {
      for (const p of pages) this.dirtyPages.add(p);
      for (const id of deleted) if (!this.isDirtyId(id)) this.deletedPages.add(id);
      this.notebookDirty = changed;
      this.onError(error);
    }
  }

  /** A page brought back while its deletion was being written must not be deleted on retry. */
  private isDirtyId(id: string): boolean {
    return [...this.dirtyPages].some((p) => p.id === id);
  }

  private schedule(delay: number): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), delay);
  }
}
