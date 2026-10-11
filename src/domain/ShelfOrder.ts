/** Pure rules for reordering subjects (and notebooks) on the shelf. */
export class ShelfOrder {
  /** Moves the item at `from` to position `to` (both clamped); returns a new list. */
  static moveTo<T>(list: readonly T[], from: number, to: number): T[] {
    const out = [...list];
    if (from < 0 || from >= out.length) return out;
    const [item] = out.splice(from, 1);
    const target = Math.max(0, Math.min(out.length, to));
    if (item !== undefined) out.splice(target, 0, item);
    return out;
  }

  /** Moves `item` one step up (`-1`) or down (`+1`); unchanged at the ends or if missing. */
  static step<T>(list: readonly T[], item: T, delta: -1 | 1): T[] {
    const index = list.indexOf(item);
    if (index < 0) return [...list];
    return ShelfOrder.moveTo(list, index, index + delta);
  }

  /**
   * Where a dragged item lands: the number of other items whose vertical centre lies above the
   * pointer. `centers` are the centres of the items that are not being dragged, top to bottom.
   */
  static dropIndex(centers: readonly number[], y: number): number {
    let index = 0;
    while (index < centers.length && (centers[index] ?? 0) < y) index++;
    return index;
  }

  /** The `order` values to store: 0..n-1 in list order. */
  static renumber<T extends { order?: number }>(list: readonly T[]): void {
    list.forEach((item, i) => (item.order = i));
  }
}
