import type { HintCounts } from '../core/types';

/** Pure rules of hints that are shown only once. */
export class OneTimeHints {
  /** Whether a hint has yet to be shown. */
  static due(counts: HintCounts | undefined, key: keyof HintCounts): boolean {
    return (counts?.[key] ?? 0) < 1;
  }

  /** The counts after a hint was shown. */
  static shown(counts: HintCounts | undefined, key: keyof HintCounts): HintCounts {
    return { ...counts, [key]: (counts?.[key] ?? 0) + 1 };
  }
}
