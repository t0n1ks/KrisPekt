import { GAP, MM } from '../core/constants';
import type { Page, Point } from '../core/types';
import { SelectionPlacement } from '../domain/SelectionPlacement';

/** Width used before any page exists (an A4 page in world px). */
const DEFAULT_PAGE_W = 794;

/**
 * Vertical stack of pages in world coordinates. Pages are centred on x = 0 and separated
 * by {@link GAP}; positions are recomputed whenever pages are added, removed or resized.
 */
export class PageLayout {
  private positions = new WeakMap<Page, Point>();
  private pages: readonly Page[] = [];
  private height = 0;

  /** Recomputes positions for the given page order. */
  update(pages: readonly Page[]): void {
    this.pages = pages;
    this.positions = new WeakMap();
    let y = 0;
    for (const p of pages) {
      this.positions.set(p, { x: (-p.w * MM) / 2, y });
      y += p.h * MM + GAP;
    }
    this.height = Math.max(0, y - GAP);
  }

  /** Top-left corner of a page in world px. */
  pos(page: Page): Point {
    return this.positions.get(page) ?? { x: 0, y: 0 };
  }

  /** Height of the whole stack. */
  get totalHeight(): number {
    return this.height;
  }

  /** Width of the widest page in world px. */
  get maxPageWidth(): number {
    return this.pages.reduce((m, p) => Math.max(m, p.w * MM), 0) || DEFAULT_PAGE_W;
  }

  /** The page under a world point, optionally with extra padding around each page. */
  pageAt(x: number, y: number, pad = 0): Page | null {
    for (const p of this.pages) {
      const o = this.pos(p);
      if (x >= o.x - pad && x <= o.x + p.w * MM + pad && y >= o.y - pad && y <= o.y + p.h * MM + pad)
        return p;
    }
    return null;
  }

  /**
   * The page containing a world point, or the nearest page when the point lies in the gap
   * between pages or beyond the stack (where a dropped selection lands).
   */
  nearestPage(world: Point): Page | null {
    const rects = this.pages.map((p) => ({ ...this.pos(p), w: p.w * MM, h: p.h * MM }));
    return this.pages[SelectionPlacement.targetIndex(rects, world)] ?? null;
  }

  /**
   * Index of the "current" page: the first page whose bottom (plus half a gap) is below
   * a line 40 % down the viewport.
   */
  currentIndex(viewTop: number, viewHeight: number): number {
    const line = viewTop + viewHeight * 0.4;
    for (let i = 0; i < this.pages.length; i++) {
      const p = this.pages[i];
      if (p && this.pos(p).y + p.h * MM + GAP / 2 >= line) return i;
    }
    return Math.max(0, this.pages.length - 1);
  }

  /** Converts a world point into page-local coordinates. */
  toPage(page: Page, world: Point): Point {
    const o = this.pos(page);
    return { x: world.x - o.x, y: world.y - o.y };
  }
}
