import { MAX_FAVORITES, MAX_RECENT_COLORS } from '../core/constants';

const HEX_PATTERN = /^#[0-9a-f]{6}$/i;

const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/**
 * Pure rules for the colour lists in preferences: the hex input, recent custom colours and
 * the favourites pinned to the tray. Every method returns a new list.
 */
export class ColorLists {
  /** `#RRGGBB` in upper case for valid input (surrounding spaces allowed), otherwise null. */
  static parseHex(input: string): string | null {
    const value = input.trim();
    return HEX_PATTERN.test(value) ? value.toUpperCase() : null;
  }

  /** Puts `color` first, drops an earlier copy (case-insensitive) and keeps at most 8. */
  static pushRecent(list: readonly string[], color: string, max = MAX_RECENT_COLORS): string[] {
    return [color, ...list.filter((c) => !same(c, color))].slice(0, max);
  }

  /** Whether the list already contains the colour (case-insensitive). */
  static includes(list: readonly string[], color: string): boolean {
    return list.some((c) => same(c, color));
  }

  /**
   * Pins a colour to the front of the favourites. When five are pinned, the last one makes
   * room. Returns null if the colour is already pinned.
   */
  static pin(list: readonly string[], color: string, max = MAX_FAVORITES): string[] | null {
    if (ColorLists.includes(list, color)) return null;
    return [color, ...list].slice(0, max);
  }

  /** Replaces the favourite at `index`; a colour pinned elsewhere moves here instead of doubling. */
  static replace(list: readonly string[], index: number, color: string): string[] {
    if (index < 0 || index >= list.length) return [...list];
    const out = list.map((c, i) => (i === index ? color : c));
    return out.filter((c, i) => i === index || !same(c, color));
  }

  /** Removes the favourite at `index`. */
  static remove(list: readonly string[], index: number): string[] {
    return list.filter((_, i) => i !== index);
  }
}
