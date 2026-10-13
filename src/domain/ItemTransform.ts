import type { ImageItem, Stroke, TextItem } from '../core/types';
import { clamp } from '../core/utils/math';
import { LIMITS } from '../storage/validation/guards';

/** A page's items, or a subset of them. */
export interface PageItems {
  strokes: Stroke[];
  texts: TextItem[];
  images: ImageItem[];
}

/** Uniform scale `k` around (`ox`, `oy`), then a move by (`dx`, `dy`); all in page px. */
export interface ItemMapping {
  ox: number;
  oy: number;
  k: number;
  dx: number;
  dy: number;
}

const clampCoord = (v: number): number => clamp(v, LIMITS.coord[0], LIMITS.coord[1]);

/**
 * Moves and scales selected items. Items are replaced, never mutated in place, so history
 * snapshots that share the old objects stay intact. Pure, so it can be unit tested.
 */
export class ItemTransform {
  /** The mapping that only moves by (`dx`, `dy`). */
  static translation(dx: number, dy: number): ItemMapping {
    return { ox: 0, oy: 0, k: 1, dx, dy };
  }

  /** Splits items into the ones in `ids` and the rest. */
  static split(items: PageItems, ids: ReadonlySet<string>): { picked: PageItems; rest: PageItems } {
    const has = (x: { id: string }): boolean => ids.has(x.id);
    const not = (x: { id: string }): boolean => !ids.has(x.id);
    return {
      picked: {
        strokes: items.strokes.filter(has),
        texts: items.texts.filter(has),
        images: items.images.filter(has),
      },
      rest: {
        strokes: items.strokes.filter(not),
        texts: items.texts.filter(not),
        images: items.images.filter(not),
      },
    };
  }

  /** Copies of the items with the mapping applied (stroke widths and font sizes scale too). */
  static map(items: PageItems, m: ItemMapping): PageItems {
    const tx = (x: number): number => clampCoord(m.ox + (x - m.ox) * m.k + m.dx);
    const ty = (y: number): number => clampCoord(m.oy + (y - m.oy) * m.k + m.dy);
    return {
      strokes: items.strokes.map((st) => ItemTransform.mapStroke(st, m.k, tx, ty)),
      texts: items.texts.map((t) => ({
        ...t,
        x: tx(t.x),
        y: ty(t.y),
        w: t.w * m.k,
        fs: clamp(t.fs * m.k, LIMITS.fontSize[0], LIMITS.fontSize[1]),
      })),
      images: items.images.map((im) => ({ ...im, x: tx(im.x), y: ty(im.y), w: im.w * m.k, h: im.h * m.k })),
    };
  }

  /** Replaces the items in `ids` with their mapped copies, keeping their order. */
  static mapInPlace(items: PageItems, ids: ReadonlySet<string>, m: ItemMapping): PageItems {
    const copies = ItemTransform.map(ItemTransform.split(items, ids).picked, m);
    return {
      strokes: ItemTransform.swap(items.strokes, copies.strokes),
      texts: ItemTransform.swap(items.texts, copies.texts),
      images: ItemTransform.swap(items.images, copies.images),
    };
  }

  private static swap<T extends { id: string }>(list: T[], copies: T[]): T[] {
    const byId = new Map(copies.map((c) => [c.id, c]));
    return list.map((x) => byId.get(x.id) ?? x);
  }

  private static mapStroke(
    st: Stroke,
    k: number,
    tx: (x: number) => number,
    ty: (y: number) => number,
  ): Stroke {
    const a = new Float32Array(st.p.length);
    for (let i = 0; i < a.length; i += 3) {
      a[i] = tx(st.p[i] ?? 0);
      a[i + 1] = ty(st.p[i + 1] ?? 0);
      a[i + 2] = st.p[i + 2] ?? 0;
    }
    return { ...st, p: a, s: clamp(st.s * k, LIMITS.strokeWidth[0], LIMITS.strokeWidth[1]) };
  }
}
