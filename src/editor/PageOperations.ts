import type { PageCache } from '../canvas/PageCache';
import type { Background, Page } from '../core/types';
import { PageSizePolicy } from '../domain/PageSizePolicy';
import type { PageSizes } from '../domain/PageSizes';
import type { I18n } from '../i18n/I18n';
import type { BlobRepository } from '../storage/BlobRepository';
import { PageRepository } from '../storage/PageRepository';
import type { SaveQueue } from '../storage/SaveQueue';
import type { EditorSession } from './EditorSession';
import type { UndoController } from './UndoController';
import type { Viewport } from './Viewport';

export interface PageOperationsDeps {
  session: EditorSession;
  viewport: Viewport;
  undo: UndoController;
  cache: PageCache;
  blobs: BlobRepository;
  pages: PageRepository;
  saveQueue: SaveQueue;
  i18n: I18n;
  sizes: PageSizes;
  makeId: () => string;
  toast: (message: string, ms?: number) => void;
  confirm: (title: string, text: string) => Promise<boolean>;
  /** Finishes text editing and clears the selection (before structural changes). */
  settle: () => void;
  /** Clears the selection if it is on this page. */
  forgetSelectionOn: (page: Page) => void;
  /** The page list changed (refresh the pages panel). */
  onPagesChanged: () => void;
  onError: (error: unknown) => void;
}

/** Adding, deleting, duplicating, moving, locking and resizing pages of the open notebook. */
export class PageOperations {
  constructor(private readonly deps: PageOperationsDeps) {}

  /** Adds a page after `after` (default: the current page), following the lock rules. */
  add(after?: Page): void {
    const { session, i18n, sizes } = this.deps;
    this.deps.settle();
    const ref = after ?? session.currentPage() ?? null;
    const page = PageSizePolicy.newPageAfter(session.nb, ref, this.deps.makeId);
    this.insert(ref, [page]);
    this.deps.viewport.scrollTo(page);
    const message = i18n.t('pageAdded', { i: session.indexOf(page) + 1, size: sizes.label(page.w, page.h) });
    this.deps.toast(message + (page.locked ? i18n.t('nbSizeSuffix') : ''), 1800);
  }

  /** Inserts pages (new, duplicated or imported) after a page. */
  insert(after: Page | null, pages: Page[]): void {
    const { session } = this.deps;
    for (const p of pages) PageSizePolicy.enforceLock(p, session.nb.base);
    session.insert(after, pages);
    this.deps.viewport.relayout();
    this.deps.onPagesChanged();
  }

  /** Locks or unlocks a page; locking snaps it to the notebook size. */
  setLocked(page: Page, locked: boolean): void {
    if (page.locked === locked) return;
    this.deps.undo.record(page);
    PageSizePolicy.setLocked(page, locked, this.deps.session.nb.base);
    this.afterResize(page);
  }

  /** Resizes an unlocked page. */
  resize(page: Page, w: number, h: number): void {
    if (page.locked) return;
    this.deps.undo.record(page);
    PageSizePolicy.resize(page, w, h);
    this.afterResize(page);
  }

  setBackground(page: Page, bg: Background): void {
    this.deps.undo.record(page);
    page.bg = bg;
    this.deps.session.touch(page);
  }

  /** Copies a page's background to every non-PDF page and makes it the notebook default. */
  applyBackgroundToAll(page: Page): void {
    const { session } = this.deps;
    if (page.bgBlob) return;
    for (const q of session.pages) {
      if (q.bgBlob || q.bg === page.bg) continue;
      this.deps.undo.record(q);
      q.bg = page.bg;
      session.touch(q);
    }
    session.nb.bg = page.bg;
    this.deps.saveQueue.markNotebookDirty();
    this.deps.toast(this.deps.i18n.t('bgApplied'));
  }

  /** Re-applies a changed notebook base size to locked pages. */
  applyBase(): void {
    const { session } = this.deps;
    for (const p of PageSizePolicy.applyBase(session.pages, session.nb.base)) session.touch(p);
    this.deps.viewport.relayout();
    this.deps.onPagesChanged();
  }

  /** Deletes a page after confirmation, with the images only it used. */
  async delete(page: Page): Promise<void> {
    const { session, i18n } = this.deps;
    if (session.pages.length <= 1) {
      this.deps.toast(i18n.t('keepOne'));
      return;
    }
    const ok = await this.deps.confirm(
      i18n.t('delPageQ'),
      i18n.t('delPageText', { n: session.indexOf(page) + 1 }),
    );
    if (!ok || !session.has(page)) return;
    this.deps.forgetSelectionOn(page);
    session.remove(page);
    this.deps.saveQueue.forget(page);
    this.deps.cache.delete(page.id);
    this.deps.undo.dropPage(page.id);
    this.deps.viewport.relayout();
    this.deps.onPagesChanged();
    await this.removeStored(page);
  }

  private async removeStored(page: Page): Promise<void> {
    const stillUsed = PageRepository.blobIds(this.deps.session.pages);
    const orphaned = [...PageRepository.blobIds([page])].filter((id) => !stillUsed.has(id));
    try {
      await this.deps.pages.deleteMany([page.id]);
      await this.deps.blobs.deleteMany(orphaned);
    } catch (error) {
      this.deps.onError(error);
    }
  }

  /** Inserts a copy of a page right after it. */
  duplicate(page: Page): void {
    const copy: Page = {
      ...PageRepository.toRecord(page),
      id: this.deps.makeId(),
      strokes: page.strokes.slice(),
      texts: page.texts.slice(),
      images: page.images.slice(),
      updatedAt: Date.now(),
    };
    this.insert(page, [copy]);
    this.deps.viewport.scrollTo(copy);
  }

  /** Moves a page up (-1) or down (+1). */
  move(page: Page, dir: -1 | 1): void {
    if (!this.deps.session.move(page, dir)) return;
    this.deps.viewport.relayout();
    this.deps.onPagesChanged();
  }

  private afterResize(page: Page): void {
    this.deps.viewport.relayout();
    this.deps.session.touch(page);
    this.deps.onPagesChanged();
  }
}
