import { PAGE_UNDO_WINDOW_MS } from '../core/constants';
import type { Page } from '../core/types';
import type { RemovedItem } from '../domain/PageOrder';
import type { I18n } from '../i18n/I18n';
import type { BlobSweeper } from '../services/BlobSweeper';
import { PageRepository } from '../storage/PageRepository';
import type { SaveQueue } from '../storage/SaveQueue';
import type { EditorSession } from './EditorSession';
import type { PageOperations } from './PageOperations';
import type { UndoController } from './UndoController';

/** What is shown after a deletion: a message with one action, which goes away by itself. */
export interface UndoPrompt {
  show(prompt: {
    message: string;
    action: string;
    ms: number;
    onAction: () => void;
    onExpire: () => void;
  }): void;
  hide(): void;
}

export interface PageDeletionDeps {
  session: EditorSession;
  pageOps: Pick<PageOperations, 'keepingView'>;
  undo: Pick<UndoController, 'dropPage'>;
  cache: { delete(pageId: string): void };
  saveQueue: Pick<SaveQueue, 'markPageDeleted' | 'markPageDirty' | 'flush'>;
  sweeper: Pick<BlobSweeper, 'markDue' | 'run'>;
  i18n: I18n;
  prompt: UndoPrompt;
  toast: (message: string) => void;
  confirm: (title: string, text: string) => Promise<boolean>;
  /** Finishes text editing and clears the selection (before structural changes). */
  settle: () => void;
  onPagesChanged: () => void;
}

/**
 * Deleting pages, with a short window to undo.
 *
 * The page records go at once, in the same transaction as the new page order, so closing the app
 * can never leave half a deletion. Until the window ends the pages stay in memory, and only then
 * are their images and PDF backgrounds removed. If the app closes during the window, the
 * sweeper's "due" flag makes the next start remove them. The last page cannot be deleted.
 */
export class PageDeletion {
  private pending: RemovedItem<Page>[] | null = null;

  constructor(private readonly deps: PageDeletionDeps) {}

  /** Asks for confirmation and deletes. Returns whether pages were deleted. */
  async request(pages: readonly Page[]): Promise<boolean> {
    const { session, i18n } = this.deps;
    this.deps.settle();
    if (pages.length >= session.pages.length) {
      this.deps.toast(i18n.t('keepOne'));
      return false;
    }
    const count = i18n.plural(pages.length, 'pg');
    const title = i18n.t(pages.length === 1 ? 'delPageQ' : 'delPagesQ');
    const ok = await this.deps.confirm(title, i18n.t('delPagesText', { x: count }));
    if (!ok) return false;
    const present = pages.filter((page) => session.has(page));
    if (!present.length || present.length >= session.pages.length) return false;
    this.remove(present);
    return true;
  }

  private remove(pages: readonly Page[]): void {
    const { session, i18n, saveQueue } = this.deps;
    this.finish();
    this.deps.settle();
    this.deps.sweeper.markDue();
    this.deps.pageOps.keepingView(() => {
      this.pending = session.removeMany(pages);
    });
    for (const page of pages) {
      saveQueue.markPageDeleted(page);
      this.deps.cache.delete(page.id);
      this.deps.undo.dropPage(page.id);
    }
    void saveQueue.flush();
    this.deps.onPagesChanged();
    this.deps.prompt.show({
      message: i18n.t('pagesDeleted', { x: i18n.plural(pages.length, 'pg') }),
      action: i18n.t('undo'),
      ms: PAGE_UNDO_WINDOW_MS,
      onAction: () => this.undoLast(),
      onExpire: () => this.finish(),
    });
  }

  /** Brings the last deleted pages back, with their content, to their original positions. */
  undoLast(): void {
    const removed = this.pending;
    if (!removed) return;
    this.pending = null;
    this.deps.prompt.hide();
    this.deps.settle();
    this.deps.pageOps.keepingView(() => this.deps.session.restoreRemoved(removed));
    void this.deps.saveQueue.flush();
    this.deps.onPagesChanged();
  }

  /** Ends the undo window now and cleans up. Called when it expires and when leaving the editor. */
  finish(): void {
    if (!this.pending) return;
    this.pending = null;
    this.deps.prompt.hide();
    void this.deps.sweeper.run();
  }

  /** Blobs of the pages that Undo could still bring back. */
  pendingBlobIds(): Set<string> {
    return PageRepository.blobIds((this.pending ?? []).map((removed) => removed.item));
  }
}
