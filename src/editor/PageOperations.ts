import type { Camera } from '../canvas/Camera';
import type { PageLayout } from '../canvas/PageLayout';
import type { Background, Page } from '../core/types';
import { ItemBindings } from '../domain/ItemBindings';
import { PageSizePolicy } from '../domain/PageSizePolicy';
import type { PageSizes } from '../domain/PageSizes';
import type { I18n } from '../i18n/I18n';
import { PageRepository } from '../storage/PageRepository';
import type { SaveQueue } from '../storage/SaveQueue';
import type { EditorSession } from './EditorSession';
import type { UndoController } from './UndoController';
import type { Viewport } from './Viewport';

export interface PageOperationsDeps {
  session: EditorSession;
  viewport: Viewport;
  camera: Camera;
  layout: PageLayout;
  undo: UndoController;
  saveQueue: SaveQueue;
  i18n: I18n;
  sizes: PageSizes;
  makeId: () => string;
  toast: (message: string, ms?: number) => void;
  /** Finishes text editing and clears the selection (before structural changes). */
  settle: () => void;
  /** The page list changed (refresh the pages panel). */
  onPagesChanged: () => void;
}

/**
 * Adding, duplicating, moving, locking and resizing pages of the open notebook. Changes to the
 * page list are saved right away, in one transaction. Undo steps name pages by id, not position,
 * so none of these changes can make a step target the wrong page.
 */
export class PageOperations {
  constructor(private readonly deps: PageOperationsDeps) {}

  /** Adds a page after `after` (default: the current page), following the lock rules. */
  add(after?: Page): void {
    const { session } = this.deps;
    this.deps.settle();
    const ref = after ?? session.currentPage() ?? null;
    const page = PageSizePolicy.newPageAfter(session.nb, ref, this.deps.makeId);
    this.insert(ref, [page]);
    this.deps.viewport.scrollTo(page);
    this.announce(page);
  }

  /** Adds a page just before `before`, following the page ahead of it (see {@link PageSizePolicy}). */
  addBefore(before: Page): void {
    const { session } = this.deps;
    this.deps.settle();
    const index = session.indexOf(before);
    if (index < 0) return;
    const page = PageSizePolicy.newPageAt(session.nb, session.pages, index, this.deps.makeId);
    session.insertAt(index, [page]);
    this.deps.viewport.relayout();
    this.deps.viewport.scrollTo(page);
    this.afterListChange();
    this.announce(page);
  }

  private announce(page: Page): void {
    const { session, i18n, sizes } = this.deps;
    const message = i18n.t('pageAdded', { i: session.indexOf(page) + 1, size: sizes.label(page.w, page.h) });
    this.deps.toast(message + (page.locked ? i18n.t('nbSizeSuffix') : ''), 1800);
  }

  /** Runs a change to the page list, keeping the current page where it is on screen. */
  keepingView(change: () => void): void {
    const { session, camera, layout, viewport } = this.deps;
    const page = session.currentPage();
    const offset = page ? camera.y - layout.pos(page).y : 0;
    change();
    layout.update(session.pages);
    if (page && session.has(page)) camera.y = layout.pos(page).y + offset;
    viewport.relayout();
  }

  private afterListChange(): void {
    void this.deps.saveQueue.flush();
    this.deps.onPagesChanged();
  }

  /** Inserts pages (new, duplicated or imported) after a page. */
  insert(after: Page | null, pages: Page[]): void {
    const { session } = this.deps;
    for (const p of pages) PageSizePolicy.enforceLock(p, session.nb.base);
    session.insert(after, pages);
    this.deps.viewport.relayout();
    this.afterListChange();
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

  /** Inserts a copy of a page right after it. */
  duplicate(page: Page): void {
    this.deps.settle();
    // Blobs are only removed once no page uses them, so the copy can share them with the original.
    // Items get ids of their own: a selection moved onto the copy must not end up with two items
    // of one id.
    const copies = new Map<string, string>();
    const fresh = <T extends { id: string }>(item: T): T => {
      const id = this.deps.makeId();
      copies.set(item.id, id);
      return { ...item, id };
    };
    const copy: Page = {
      ...PageRepository.toRecord(page),
      id: this.deps.makeId(),
      strokes: page.strokes.map(fresh),
      texts: page.texts.map(fresh),
      images: page.images.map(fresh),
      cards: page.cards.map(fresh),
      anchors: [],
      inkLinks: [],
      updatedAt: Date.now(),
    };
    // Anchors get new ids: links lead to the original, and a copy can be linked to on its own.
    copy.anchors = ItemBindings.copiedAnchors(page.anchors, copies, this.deps.makeId);
    copy.inkLinks = ItemBindings.copiedInkLinks(page.inkLinks, copies, this.deps.makeId);
    this.insert(page, [copy]);
    this.deps.viewport.scrollTo(copy);
  }

  /** Moves a page to an index, keeping the current page in view. */
  moveTo(page: Page, index: number): void {
    const { session } = this.deps;
    this.deps.settle();
    let moved = false;
    this.keepingView(() => {
      moved = session.moveTo(page, index);
    });
    if (moved) this.afterListChange();
  }

  private afterResize(page: Page): void {
    this.deps.viewport.relayout();
    this.deps.session.touch(page);
    this.deps.onPagesChanged();
  }
}
