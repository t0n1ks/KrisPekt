import type { ToolKind, ToolPreset, ToolbarPrefs } from '../core/types';

const TOOLS: readonly ToolKind[] = ['pen', 'hl', 'eraser', 'lasso', 'hand', 'text'];
const DEFAULT_ORDER: readonly string[] = [...TOOLS, 'colors', 'ruler', 'image', 'attach', 'undo', 'redo'];
/** On the bar only if asked for: the lasso's button also gives the Hand. */
const HIDDEN_BY_DEFAULT: readonly string[] = ['hand'];
/** Always reachable, so they cannot be hidden. The More button is not a movable item at all. */
const ESSENTIAL: ReadonlySet<string> = new Set(['undo', 'redo']);
const PRESET_PREFIX = 'preset:';

/** Which items stay longest on a narrow bar. Presets rank by their place among equals. */
const PRIORITY: Readonly<Record<string, number>> = {
  undo: 100,
  redo: 100,
  pen: 95,
  eraser: 90,
  hl: 70,
  lasso: 65,
  hand: 64,
  text: 60,
  colors: 40,
  ruler: 30,
  image: 20,
  attach: 15,
};
const PRESET_PRIORITY = 80;

/** Pure rules of the toolbar's order and hidden items. Items are named by plain string ids. */
export class ToolbarLayout {
  /** The id of a preset's item. */
  static presetItem(presetId: string): string {
    return PRESET_PREFIX + presetId;
  }

  /** The preset id of an item, or null if it is not a preset's. */
  static presetIdOf(item: string): string | null {
    return item.startsWith(PRESET_PREFIX) ? item.slice(PRESET_PREFIX.length) : null;
  }

  /** The tool of a base tool item, or null for anything else. */
  static toolOf(item: string): ToolKind | null {
    return TOOLS.find((tool) => tool === item) ?? null;
  }

  /** The default layout: the base items, with presets right after the tools. */
  static defaults(presets: readonly ToolPreset[]): ToolbarPrefs {
    return ToolbarLayout.resolve({ order: [...DEFAULT_ORDER], hidden: [...HIDDEN_BY_DEFAULT] }, presets);
  }

  /**
   * A stored layout made whole: unknown items go, base items it does not know yet come back at
   * their default place (hidden, if that is how they start), and new presets land right after the
   * last tool or preset.
   */
  static resolve(stored: ToolbarPrefs | undefined, presets: readonly ToolPreset[]): ToolbarPrefs {
    const presetItems = presets.map((p) => ToolbarLayout.presetItem(p.id));
    const known = new Set([...DEFAULT_ORDER, ...presetItems]);
    const order = [...new Set(stored?.order ?? DEFAULT_ORDER)].filter((id) => known.has(id));
    for (const [index, id] of DEFAULT_ORDER.entries()) {
      if (!order.includes(id)) order.splice(Math.min(index, order.length), 0, id);
    }
    for (const id of presetItems) {
      if (!order.includes(id)) order.splice(ToolbarLayout.afterLastTool(order), 0, id);
    }
    const unseen = HIDDEN_BY_DEFAULT.filter((id) => !stored?.order.includes(id));
    const hidden = [...new Set([...(stored?.hidden ?? []), ...unseen])].filter(
      (id) => known.has(id) && !ESSENTIAL.has(id),
    );
    return { order, hidden };
  }

  /** The order with an item moved to an index. */
  static moved(order: readonly string[], item: string, toIndex: number): string[] {
    const from = order.indexOf(item);
    if (from < 0) return [...order];
    const rest = order.filter((id) => id !== item);
    const at = Math.min(Math.max(0, toIndex), rest.length);
    return [...rest.slice(0, at), item, ...rest.slice(at)];
  }

  /**
   * Whether an item may be hidden. Undo and redo may not, and neither may the last thing left
   * to write with, or the only way back to writing would be a menu.
   */
  static canHide(layout: ToolbarPrefs, item: string, presets: readonly ToolPreset[]): boolean {
    if (ESSENTIAL.has(item)) return false;
    const writes = (id: string): boolean => {
      const presetId = ToolbarLayout.presetIdOf(id);
      return presetId ? presets.some((p) => p.id === presetId && p.tool === 'pen') : id === 'pen';
    };
    if (!writes(item)) return true;
    return layout.order.some((id) => id !== item && writes(id) && !layout.hidden.includes(id));
  }

  /** The layout with an item shown or hidden. */
  static withHidden(layout: ToolbarPrefs, item: string, hidden: boolean): ToolbarPrefs {
    const rest = layout.hidden.filter((id) => id !== item);
    return { order: layout.order, hidden: hidden ? [...rest, item] : rest };
  }

  /** The layout without an item. */
  static without(layout: ToolbarPrefs, item: string): ToolbarPrefs {
    return {
      order: layout.order.filter((id) => id !== item),
      hidden: layout.hidden.filter((id) => id !== item),
    };
  }

  /** How long an item stays on the bar when room runs out: the higher, the longer. */
  static priority(item: string): number {
    return PRIORITY[item] ?? PRESET_PRIORITY;
  }

  private static afterLastTool(order: readonly string[]): number {
    let last = -1;
    order.forEach((id, index) => {
      if (ToolbarLayout.toolOf(id) || ToolbarLayout.presetIdOf(id)) last = index;
    });
    return last + 1;
  }
}
