import { PAGE_CACHE_KEEP } from '../core/constants';
import type { Page, Stroke } from '../core/types';
import { context2d } from '../core/utils/dom';
import type { PagePainter } from './PagePainter';
import type { StrokePainter } from './StrokePainter';

/** What is hidden from a page bitmap: ids drawn by the live layer, plus a key that identifies them. */
export interface SkipInfo {
  set: Set<string> | null;
  /** `s<selection token>` and/or `e<edited text id>`, or '' when nothing is hidden. */
  key: string;
}

interface Entry {
  canvas: HTMLCanvasElement;
  key: string;
  scale: number;
  revision: number;
  skipKey: string;
}

/**
 * One bitmap per visible page at the current zoom, so panning only blits images.
 *
 * Cache key format: `<scale with 4 decimals>|<page revision>|<skip key>`. Any change of zoom,
 * page content (revision) or hidden items (selection token / edited text) invalidates it.
 * Entries are kept in least-recently-used order.
 */
export class PageCache {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly painter: PagePainter,
    private readonly strokes: StrokePainter,
  ) {}

  static key(scale: number, revision: number, skipKey: string): string {
    return scale.toFixed(4) + '|' + revision + '|' + skipKey;
  }

  /** A cached bitmap matching the key exactly, or null. */
  fresh(pageId: string, key: string): HTMLCanvasElement | null {
    const entry = this.entries.get(pageId);
    if (!entry || entry.key !== key) return null;
    this.touch(pageId, entry);
    return entry.canvas;
  }

  /** Any cached bitmap, even outdated (shown scaled while pinching). */
  stale(pageId: string): HTMLCanvasElement | null {
    return this.entries.get(pageId)?.canvas ?? null;
  }

  /** Repaints a page into its cache bitmap and returns it. */
  paint(
    page: Page,
    width: number,
    height: number,
    scale: number,
    revision: number,
    skip: SkipInfo,
  ): HTMLCanvasElement {
    const cw = Math.ceil(width);
    const ch = Math.ceil(height);
    const entry = this.entries.get(page.id) ?? {
      canvas: document.createElement('canvas'),
      key: '',
      scale,
      revision,
      skipKey: '',
    };
    if (entry.canvas.width !== cw || entry.canvas.height !== ch) {
      entry.canvas.width = cw;
      entry.canvas.height = ch;
    }
    const ctx = context2d(entry.canvas);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    this.painter.paint(ctx, page, scale, skip.set);
    Object.assign(entry, {
      key: PageCache.key(scale, revision, skip.key),
      scale,
      revision,
      skipKey: skip.key,
    });
    this.touch(page.id, entry);
    return entry.canvas;
  }

  /**
   * Draws a just-finished stroke onto the existing bitmap instead of repainting the page.
   * Only possible if the bitmap was up to date before the stroke and nothing is hidden.
   */
  append(page: Page, stroke: Stroke, oldRevision: number, newRevision: number): void {
    const entry = this.entries.get(page.id);
    if (!entry || entry.revision !== oldRevision || entry.skipKey) return;
    const ctx = context2d(entry.canvas);
    ctx.setTransform(entry.scale, 0, 0, entry.scale, 0, 0);
    this.strokes.draw(ctx, stroke);
    entry.revision = newRevision;
    entry.key = PageCache.key(entry.scale, newRevision, '');
  }

  /** Drops off-screen bitmaps once more than a few are cached. */
  prune(visible: ReadonlySet<string>): void {
    for (const id of [...this.entries.keys()]) {
      if (!visible.has(id) && this.entries.size > PAGE_CACHE_KEEP) this.entries.delete(id);
    }
  }

  delete(pageId: string): void {
    this.entries.delete(pageId);
  }

  clear(): void {
    this.entries.clear();
  }

  private touch(id: string, entry: Entry): void {
    this.entries.delete(id);
    this.entries.set(id, entry);
  }
}
