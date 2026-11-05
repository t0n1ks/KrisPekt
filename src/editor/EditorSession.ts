import type { Notebook, Page } from '../core/types';
import { clamp } from '../core/utils/math';
import { PageOrder, type RemovedItem } from '../domain/PageOrder';

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
    this.insertAt(after ? this.pages.indexOf(after) + 1 : this.pages.length, pages);
  }

  /** Inserts pages at a position and updates the notebook's page order. */
  insertAt(index: number, pages: Page[]): void {
    this.pages.splice(index, 0, ...pages);
    for (const p of pages) {
      this.byId.set(p.id, p);
      this.bump(p);
      this.onDirty(p);
    }
    this.syncOrder();
  }

  /** Removes pages, updates the order and returns where they were, for {@link restoreRemoved}. */
  removeMany(pages: readonly Page[]): RemovedItem<Page>[] {
    const { kept, removed } = PageOrder.without(this.pages, new Set(pages));
    this.pages = kept;
    for (const { item } of removed) this.byId.delete(item.id);
    this.syncOrder();
    return removed;
  }

  /** Puts removed pages back at their positions and queues them for saving. */
  restoreRemoved(removed: readonly RemovedItem<Page>[]): void {
    this.pages = PageOrder.restored(this.pages, removed);
    for (const { item } of removed) {
      this.byId.set(item.id, item);
      this.bump(item);
      this.onDirty(item);
    }
    this.syncOrder();
  }

  /** Moves a page to an index. Returns false if that changes nothing. */
  moveTo(page: Page, index: number): boolean {
    const from = this.pages.indexOf(page);
    if (from < 0) return false;
    const to = clamp(index, 0, this.pages.length - 1);
    if (from === to) return false;
    this.pages = PageOrder.moved(this.pages, from, to);
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
