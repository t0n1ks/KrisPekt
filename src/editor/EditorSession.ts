import type { Notebook, Page } from '../core/types';
import { clamp } from '../core/utils/math';

/**
 * State of the open notebook: its pages in order, the current page index and a per-page
 * revision counter. Renderers key their caches on the revision, so any visual change to a
 * page must go through {@link bump} (or {@link touch} when it also needs saving).
 */
export class EditorSession {
  notebook: Notebook | null = null;
  pages: Page[] = [];
  currentIndex = 0;
  private byId = new Map<string, Page>();
  private revisions = new WeakMap<Page, number>();

  constructor(
    private readonly onChange: () => void,
    private readonly onDirty: (page: Page) => void,
    private readonly onNotebookDirty: () => void,
  ) {}

  /** Starts editing a notebook with its (already ordered) pages. */
  open(nb: Notebook, pages: Page[]): void {
    this.notebook = nb;
    this.setPages(pages);
    this.currentIndex = 0;
  }

  close(): void {
    this.notebook = null;
    this.setPages([]);
  }

  get isOpen(): boolean {
    return this.notebook !== null;
  }

  /** The open notebook; only call while {@link isOpen}. */
  get nb(): Notebook {
    if (!this.notebook) throw new Error('No notebook is open');
    return this.notebook;
  }

  find(id: string): Page | undefined {
    return this.byId.get(id);
  }

  has(page: Page): boolean {
    return this.byId.get(page.id) === page;
  }

  indexOf(page: Page): number {
    return this.pages.indexOf(page);
  }

  /** The page the view is centred on. */
  currentPage(): Page | undefined {
    return this.pages[clamp(this.currentIndex, 0, this.pages.length - 1)];
  }

  /** Revision counter of a page, part of its cache key. */
  revision(page: Page): number {
    return this.revisions.get(page) ?? 0;
  }

  /** Marks a page as visually changed (no save). */
  bump(page: Page): void {
    this.revisions.set(page, this.revision(page) + 1);
    this.onChange();
  }

  /** Marks a page as changed and queues it for saving. */
  touch(page: Page): void {
    page.updatedAt = Date.now();
    this.bump(page);
    this.onDirty(page);
  }

  /** Inserts pages after `after` (or at the end) and updates the notebook's page order. */
  insert(after: Page | null, pages: Page[]): void {
    const index = after ? this.pages.indexOf(after) + 1 : this.pages.length;
    this.pages.splice(index, 0, ...pages);
    for (const p of pages) {
      this.byId.set(p.id, p);
      this.bump(p);
      this.onDirty(p);
    }
    this.syncOrder();
  }

  /** Removes a page and updates the order. */
  remove(page: Page): void {
    const index = this.pages.indexOf(page);
    if (index < 0) return;
    this.pages.splice(index, 1);
    this.byId.delete(page.id);
    this.syncOrder();
  }

  /** Swaps a page with its neighbour (`dir` = -1 up, +1 down). Returns false at the ends. */
  move(page: Page, dir: -1 | 1): boolean {
    const i = this.pages.indexOf(page);
    const j = i + dir;
    const other = this.pages[j];
    if (i < 0 || !other) return false;
    this.pages[j] = page;
    this.pages[i] = other;
    this.syncOrder();
    return true;
  }

  private setPages(pages: Page[]): void {
    this.pages = pages;
    this.byId = new Map(pages.map((p) => [p.id, p]));
    for (const p of pages) this.revisions.set(p, this.revision(p) + 1);
  }

  private syncOrder(): void {
    if (!this.notebook) return;
    this.notebook.pageIds = this.pages.map((p) => p.id);
    this.onNotebookDirty();
  }
}
