import type { ExportScope } from '../core/types';

/** Pages chosen for an export, as 0-based indices into the notebook's page order. */
export type RangeResult = { ok: true; indices: number[] } | { ok: false };

/**
 * Which pages an export includes: the current one, all of them, or a range "from … to" typed
 * by the user. The range is validated strictly (whole numbers, 1 ≤ from ≤ to ≤ count) and
 * never silently corrected, so the user sees exactly what will be exported.
 */
export class PageRange {
  /** A typed page number: digits only (surrounding spaces allowed), or null. */
  static parseNumber(text: string): number | null {
    const trimmed = text.trim();
    if (!/^\d{1,6}$/.test(trimmed)) return null;
    return Number(trimmed);
  }

  /** Validates a typed range against a notebook of `count` pages. */
  static parse(fromText: string, toText: string, count: number): RangeResult {
    const from = PageRange.parseNumber(fromText);
    const to = PageRange.parseNumber(toText);
    if (from === null || to === null || from < 1 || to > count || from > to) return { ok: false };
    return { ok: true, indices: PageRange.span(from - 1, to - 1) };
  }

  /**
   * The pages for a scope. `current` is the open page (0-based, clamped into range); `range`
   * needs the typed values.
   */
  static select(
    scope: ExportScope,
    count: number,
    current: number,
    typed: { from: string; to: string },
  ): RangeResult {
    if (count < 1) return { ok: false };
    if (scope === 'all') return { ok: true, indices: PageRange.span(0, count - 1) };
    if (scope === 'current') {
      const index = Math.min(count - 1, Math.max(0, Math.floor(current)));
      return { ok: true, indices: [index] };
    }
    return PageRange.parse(typed.from, typed.to, count);
  }

  private static span(first: number, last: number): number[] {
    return Array.from({ length: last - first + 1 }, (_, i) => first + i);
  }
}
