import type { PagePainter } from '../../canvas/PagePainter';
import { BITMAP_LRU_SIZE, MM, THUMBNAIL_CACHE_SIZE } from '../../core/constants';
import type { Page } from '../../core/types';
import { context2d, replaceChildren } from '../../core/utils/dom';
import { ThumbnailCache } from '../../domain/ThumbnailCache';
import { PageRepository } from '../../storage/PageRepository';

export interface PageThumbnailsDeps {
  /** The scrolling element whose visible children get painted. */
  root: HTMLElement;
  painter: Pick<PagePainter, 'paint'>;
  /** Loads a blob's bitmap; it is then in the painter's cache. */
  loadBitmap: (id: string) => Promise<unknown>;
  /** A page's content revision. */
  revision: (page: Page) => number;
  dpr: () => number;
}

/** Extra distance around the visible area that is painted ahead of scrolling. */
const PAINT_AHEAD = '240px';
/** Painting pauses for a frame after this many ms, so scrolling stays smooth. */
const FRAME_BUDGET_MS = 8;
/** Repaints per opening of a page with more images than the bitmap cache holds; see {@link paintNext}. */
const CROWDED_PAGE_PAINTS = 2;

/**
 * Paints page thumbnails lazily: only hosts near the visible area of the root, a few per frame,
 * however many pages there are. Each thumbnail remembers the page revision it shows and is
 * repainted when that changes, so it can never show deleted or moved content.
 */
export class PageThumbnails {
  private readonly observer: IntersectionObserver;
  private readonly cache = new ThumbnailCache<HTMLCanvasElement>(THUMBNAIL_CACHE_SIZE);
  private readonly pageOf = new Map<Element, Page>();
  private readonly visible = new Map<string, HTMLElement>();
  private readonly crowdedPaints = new Map<string, number>();
  private queue: string[] = [];
  private pumping = false;
  /** Bumped by {@link reset}, which stops a paint loop that is waiting. */
  private run = 0;

  constructor(private readonly deps: PageThumbnailsDeps) {
    this.observer = new IntersectionObserver((entries) => this.onIntersect(entries), {
      root: deps.root,
      rootMargin: PAINT_AHEAD,
    });
  }

  /** Paints this page into `host` whenever `host` comes near the visible area. */
  watch(host: HTMLElement, page: Page): void {
    this.pageOf.set(host, page);
    this.observer.observe(host);
  }

  /** Stops watching a host (its page is gone). */
  unwatch(host: HTMLElement): void {
    const page = this.pageOf.get(host);
    this.pageOf.delete(host);
    this.observer.unobserve(host);
    if (page) this.visible.delete(page.id);
  }

  /** Repaints visible thumbnails whose page changed. */
  refresh(): void {
    this.queue = [...this.visible.keys()];
    void this.pump();
  }

  /** The canvas showing a page, if one was painted. */
  canvasOf(pageId: string): HTMLCanvasElement | null {
    return this.cache.bitmap(pageId);
  }

  /** Forgets everything; for when the panel closes. */
  reset(): void {
    this.run++;
    this.observer.disconnect();
    this.pageOf.clear();
    this.visible.clear();
    this.crowdedPaints.clear();
    this.queue = [];
    this.cache.clear();
  }

  private onIntersect(entries: readonly IntersectionObserverEntry[]): void {
    for (const entry of entries) {
      const host = entry.target as HTMLElement;
      const page = this.pageOf.get(host);
      if (!page) continue;
      if (entry.isIntersecting) {
        this.visible.set(page.id, host);
        this.queue.push(page.id);
      } else {
        // Off screen it stays only in the bounded cache, so memory does not grow with scrolling.
        this.visible.delete(page.id);
        replaceChildren(host);
      }
    }
    void this.pump();
  }

  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    const run = this.run;
    let sliceStart = performance.now();
    try {
      while (run === this.run) {
        const id = this.queue.shift();
        if (id === undefined) return;
        await this.paintNext(id, run);
        if (performance.now() - sliceStart > FRAME_BUDGET_MS) {
          await new Promise((resolve) => requestAnimationFrame(resolve));
          sliceStart = performance.now();
        }
      }
    } finally {
      this.pumping = false;
      if (this.queue.length) void this.pump();
    }
  }

  /**
   * Paints one thumbnail if it is still near the screen and out of date. Bitmaps are loaded first,
   * because a miss while painting bumps the page's revision when it arrives. A page with more
   * images than the bitmap cache holds would miss every time and repaint for ever, so its
   * repaints are limited.
   */
  private async paintNext(id: string, run: number): Promise<void> {
    const host = this.visible.get(id);
    const page = host && this.pageOf.get(host);
    if (!host || !page) return;
    const revision = this.deps.revision(page);
    const cached = this.cache.bitmap(id);
    if (cached && host.firstChild !== cached) replaceChildren(host, cached);
    if (this.cache.isFresh(id, revision)) return;
    const blobs = [...PageRepository.blobIds([page])];
    if (blobs.length > BITMAP_LRU_SIZE) {
      const paints = this.crowdedPaints.get(id) ?? 0;
      if (paints >= CROWDED_PAGE_PAINTS) return;
      this.crowdedPaints.set(id, paints + 1);
    }
    await Promise.all(blobs.map((blob) => this.deps.loadBitmap(blob)));
    if (run !== this.run || !this.visible.has(id)) return;
    this.draw(host, page);
  }

  private draw(host: HTMLElement, page: Page): void {
    const canvas = this.cache.bitmap(page.id) ?? document.createElement('canvas');
    const fit = Math.min(host.clientWidth / (page.w * MM), host.clientHeight / (page.h * MM));
    const width = page.w * MM * fit;
    const height = page.h * MM * fit;
    const dpr = this.deps.dpr();
    canvas.className = 'page-item__canvas';
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    const revision = this.deps.revision(page);
    const ctx = context2d(canvas);
    const scale = fit * dpr;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    this.deps.painter.paint(ctx, page, scale, null);
    this.cache.put(page.id, canvas, revision, new Set(this.visible.keys()));
    if (host.firstChild !== canvas) replaceChildren(host, canvas);
  }
}
