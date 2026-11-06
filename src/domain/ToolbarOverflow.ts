/** An item the bar could show. */
export interface OverflowItem {
  id: string;
  width: number;
  /** The higher, the longer it stays on the bar. */
  priority: number;
  /** Stays on the bar whatever the room: undo, redo and the active tool. */
  always: boolean;
}

/** What goes where; both lists keep the user's order. */
export interface OverflowResult {
  bar: string[];
  overflow: string[];
}

/**
 * The Priority+ rule. The always-visible items go first. Then the others take what room is left,
 * highest priority first; among equals, the one further left. An item too wide for what is left
 * is skipped, and a narrower one after it may still fit.
 */
export class ToolbarOverflow {
  /**
   * @param items in the user's order, without the More button
   * @param available the width of the bar's content, in px
   * @param moreWidth the width of the More button, which is always on the bar
   * @param gap the room between two neighbours, in px
   */
  static compute(
    items: readonly OverflowItem[],
    available: number,
    moreWidth: number,
    gap: number,
  ): OverflowResult {
    const room = { left: available - moreWidth };
    const onBar = new Set<string>();
    const take = (item: OverflowItem): void => {
      onBar.add(item.id);
      room.left -= item.width + gap;
    };
    items.filter((item) => item.always).forEach(take);
    const ranked = items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => !item.always)
      .sort((a, b) => b.item.priority - a.item.priority || a.index - b.index);
    for (const { item } of ranked) {
      if (item.width + gap <= room.left) take(item);
    }
    return {
      bar: items.filter((item) => onBar.has(item.id)).map((item) => item.id),
      overflow: items.filter((item) => !onBar.has(item.id)).map((item) => item.id),
    };
  }
}
