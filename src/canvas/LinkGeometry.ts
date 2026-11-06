import { MM } from '../core/constants';
import type { Anchor, Box, InkLink, Page, PageRect } from '../core/types';
import { CardRules } from '../domain/CardRules';
import type { StrokeGeometry } from './StrokeGeometry';
import type { TextLayout } from './TextLayout';

function boxOf(rect: PageRect): Box {
  return { x0: rect.x, y0: rect.y, x1: rect.x + rect.w, y1: rect.y + rect.h };
}

/** Measures items on a page, and the areas of the anchors and ink links bound to them. */
export class LinkGeometry {
  constructor(
    private readonly geometry: Pick<StrokeGeometry, 'bbox'>,
    private readonly texts: Pick<TextLayout, 'box' | 'glyphs' | 'migrated'>,
  ) {}

  /** Bounding box of one item on a page. */
  itemBox(page: Page, id: string): Box | null {
    const st = page.strokes.find((s) => s.id === id);
    if (st) return this.geometry.bbox(st);
    const t = page.texts.find((x) => x.id === id);
    if (t) return this.texts.box(t);
    const im = page.images.find((x) => x.id === id);
    if (im) return { x0: im.x, y0: im.y, x1: im.x + im.w, y1: im.y + im.h };
    const card = page.cards.find((x) => x.id === id);
    return card ? CardRules.box(card) : null;
  }

  /** Bounding box of several items; null if none of them is on the page. */
  itemsBox(page: Page, ids: Iterable<string>): Box | null {
    let box: Box | null = null;
    for (const id of ids) {
      const b = this.itemBox(page, id);
      if (!b) continue;
      box = box
        ? {
            x0: Math.min(box.x0, b.x0),
            y0: Math.min(box.y0, b.y0),
            x1: Math.max(box.x1, b.x1),
            y1: Math.max(box.y1, b.y1),
          }
        : b;
    }
    return box;
  }

  /** A whole page. */
  pageBox(page: Page): Box {
    return { x0: 0, y0: 0, x1: page.w * MM, y1: page.h * MM };
  }

  /**
   * Where an anchor is now: a stretch of a text box, its items, or the whole page without any. The
   * stored rect stands in when its items cannot be measured.
   */
  anchorBox(page: Page, anchor: Anchor): Box {
    if (!anchor.items.length) return this.pageBox(page);
    return this.rangeBox(page, anchor) ?? this.itemsBox(page, anchor.items) ?? boxOf(anchor.rect);
  }

  /** Where an ink link is now. */
  inkBox(page: Page, link: InkLink): Box {
    return this.itemsBox(page, link.items) ?? boxOf(link.rect);
  }

  private rangeBox(page: Page, anchor: Anchor): Box | null {
    if (!anchor.range) return null;
    const item = page.texts.find((t) => t.id === anchor.items[0]);
    if (!item) return null;
    const rich = this.texts.migrated(item);
    const [start, end] = anchor.range;
    const glyphs = this.texts
      .glyphs(rich, this.texts.box(rich))
      .filter((glyph) => glyph.start >= start && glyph.end <= end);
    if (!glyphs.length) return null;
    return {
      x0: Math.min(...glyphs.map((g) => g.x0)),
      y0: Math.min(...glyphs.map((g) => g.y0)),
      x1: Math.max(...glyphs.map((g) => g.x1)),
      y1: Math.max(...glyphs.map((g) => g.y1)),
    };
  }
}
