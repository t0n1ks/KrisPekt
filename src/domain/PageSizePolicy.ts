import type { Notebook, Page, PageSize } from '../core/types';

/**
 * Page-size lock rules.
 *
 * The notebook's base size belongs to its first page. A locked page always has the base
 * size; locking a page snaps it back to the base size. An unlocked page keeps its own size
 * and may be resized. A new page copies the lock state of the page it follows.
 */
export class PageSizePolicy {
  /** Makes a locked page match the base size. */
  static enforceLock(page: Page, base: PageSize): void {
    if (!page.locked) return;
    page.w = base.w;
    page.h = base.h;
  }

  /** Sets the lock. Returns false if nothing changed. Locking resizes the page to the base. */
  static setLocked(page: Page, locked: boolean, base: PageSize): boolean {
    if (page.locked === locked) return false;
    page.locked = locked;
    PageSizePolicy.enforceLock(page, base);
    return true;
  }

  /** Resizes an unlocked page. Returns false for locked pages, which keep the base size. */
  static resize(page: Page, w: number, h: number): boolean {
    if (page.locked) return false;
    page.w = w;
    page.h = h;
    return true;
  }

  /** Applies a new base size to every locked page; returns the pages that changed. */
  static applyBase(pages: readonly Page[], base: PageSize): Page[] {
    const changed: Page[] = [];
    for (const page of pages) {
      if (!page.locked) continue;
      page.w = base.w;
      page.h = base.h;
      changed.push(page);
    }
    return changed;
  }

  /**
   * A new empty page to insert after `ref`.
   * - no reference: locked, base size, notebook background;
   * - locked reference: locked, base size;
   * - unlocked reference: unlocked, the reference page's own size.
   * The background is copied, except from PDF pages, which fall back to the notebook background.
   */
  static newPageAfter(nb: Notebook, ref: Page | null, makeId: () => string): Page {
    const locked = ref ? ref.locked : true;
    const size = !ref || locked ? nb.base : ref;
    return {
      id: makeId(),
      nbId: nb.id,
      w: size.w,
      h: size.h,
      locked,
      bg: !ref || ref.bgBlob ? nb.bg : ref.bg,
      bgBlob: null,
      strokes: [],
      texts: [],
      images: [],
      updatedAt: Date.now(),
    };
  }
}
