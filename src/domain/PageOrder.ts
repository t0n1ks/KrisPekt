/** An item taken out of a list, with the position it had. */
export interface RemovedItem<T> {
  item: T;
  index: number;
}

/** Rules for changing the order of pages, as pure functions on lists. */
export class PageOrder {
  /** A copy of the list with the item at `from` now at index `to` (both clamped to the list). */
  static moved<T>(list: readonly T[], from: number, to: number): T[] {
    const out = [...list];
    const [item] = out.splice(from, 1);
    if (item === undefined) return out;
    out.splice(Math.min(Math.max(to, 0), out.length), 0, item);
    return out;
  }

  /** The list without `items`, and what was taken out in ascending position order. */
  static without<T>(list: readonly T[], items: ReadonlySet<T>): { kept: T[]; removed: RemovedItem<T>[] } {
    const kept: T[] = [];
    const removed: RemovedItem<T>[] = [];
    list.forEach((item, index) => {
      if (items.has(item)) removed.push({ item, index });
      else kept.push(item);
    });
    return { kept, removed };
  }

  /** A copy of the list with removed items back at their positions. */
  static restored<T>(list: readonly T[], removed: readonly RemovedItem<T>[]): T[] {
    const out = [...list];
    const ascending = [...removed].sort((a, b) => a.index - b.index);
    for (const { item, index } of ascending) out.splice(Math.min(index, out.length), 0, item);
    return out;
  }

  /**
   * The final index of an item dropped into a gap, where gap `g` lies just before the item
   * currently at index `g`. The item itself leaves the list first, so later gaps shift by one.
   */
  static indexForGap(from: number, gap: number): number {
    return gap > from ? gap - 1 : gap;
  }
}
