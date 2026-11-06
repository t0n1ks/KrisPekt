import { SCRATCH_WORD_SHARE } from '../core/constants';
import type { TextParagraph } from '../core/types';
import { RichText } from './RichText';

/** Characters [start, end) of a text, as offsets. */
export type TextRange = readonly [number, number];

/**
 * Which characters to take out of a text when some of them were crossed out, and taking them out.
 * Pure. Other characters keep their formatting, because only the ranges are cut.
 */
export class TextErasure {
  /**
   * What to delete, in order and without overlaps. A word with most of its characters covered
   * goes as a whole, with the spaces next to it, so no double space is left behind; of any other
   * word only the covered characters go. A paragraph left with nothing goes too, with its break.
   */
  static ranges(text: string, covered: readonly TextRange[]): TextRange[] {
    const cuts: [number, number][] = [];
    for (const word of text.matchAll(/\S+/g)) {
      const start = word.index;
      const end = start + word[0].length;
      const inWord = covered
        .map(([a, b]): [number, number] => [Math.max(a, start), Math.min(b, end)])
        .filter(([a, b]) => b > a);
      const share = inWord.reduce((sum, [a, b]) => sum + b - a, 0) / word[0].length;
      if (share >= SCRATCH_WORD_SHARE) cuts.push(TextErasure.withSpace(text, start, end));
      else cuts.push(...inWord);
    }
    return TextErasure.merged(cuts).map(([a, b]) => TextErasure.withBreak(text, a, b));
  }

  /** The paragraphs without the ranges. */
  static removed(paras: readonly TextParagraph[], ranges: readonly TextRange[]): TextParagraph[] {
    // From the end, so that the offsets of what is still to be cut stay right.
    return [...ranges]
      .sort((a, b) => b[0] - a[0])
      .reduce<TextParagraph[]>(
        (out, [start, end]) => RichText.replaceRange(out, start, end, '', {}),
        [...paras],
      );
  }

  private static withSpace(text: string, start: number, end: number): [number, number] {
    let after = end;
    while (TextErasure.isSpace(text.charAt(after))) after++;
    if (after > end) return [start, after];
    let before = start;
    while (before > 0 && TextErasure.isSpace(text.charAt(before - 1))) before--;
    return [before, end];
  }

  private static isSpace(char: string): boolean {
    return char === ' ' || char === '\t';
  }

  private static withBreak(text: string, start: number, end: number): [number, number] {
    const atStart = start === 0 || text.charAt(start - 1) === '\n';
    const atEnd = end === text.length || text.charAt(end) === '\n';
    if (!atStart || !atEnd) return [start, end];
    if (end < text.length) return [start, end + 1];
    return [Math.max(0, start - 1), end];
  }

  private static merged(cuts: readonly [number, number][]): [number, number][] {
    const out: [number, number][] = [];
    for (const [a, b] of [...cuts].sort((x, y) => x[0] - y[0])) {
      const last = out[out.length - 1];
      if (last && a <= last[1]) last[1] = Math.max(last[1], b);
      else out.push([a, b]);
    }
    return out;
  }
}
