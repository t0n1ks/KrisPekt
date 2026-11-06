import type { InternalLink, Page, TextParagraph } from '../core/types';
import { AnchorMarks } from './AnchorMarks';

/** One line of the contents. */
export interface ContentsEntry {
  name: string;
  /** 1-based. */
  page: number;
  target: InternalLink;
}

export interface ContentsStyle {
  /** The width to fill, in the units of `measure`. */
  width: number;
  /** "p. 3". */
  pageLabel: (page: number) => string;
  measure: (text: string) => number;
}

const LEADER = '.';
const MIN_LEADER = 3;
const ELLIPSIS = '…';

/** Builds a notebook's table of contents: its anchors in page order. Pure. */
export class TableOfContents {
  /** The anchors of the pages of a notebook, with their page numbers. */
  static entries(nbId: string, pages: readonly Pick<Page, 'id' | 'anchors'>[]): ContentsEntry[] {
    return pages.flatMap((page, index) =>
      AnchorMarks.ordered(page).map((anchor) => ({
        name: anchor.name,
        page: index + 1,
        target: { kind: 'anchor', nb: nbId, id: anchor.id } as const,
      })),
    );
  }

  /** One linked paragraph per entry, "Name ……… p. N", each on one line of the given width. */
  static paragraphs(entries: readonly ContentsEntry[], style: ContentsStyle): TextParagraph[] {
    return entries.map((entry) => ({
      runs: [{ t: TableOfContents.line(entry, style), link: entry.target }],
    }));
  }

  private static line(entry: ContentsEntry, style: ContentsStyle): string {
    const label = style.pageLabel(entry.page);
    const room = (text: string): number => style.width - style.measure(`${text} ${label}`);
    const minimum = ' ' + LEADER.repeat(MIN_LEADER);
    const name = TableOfContents.fitted(entry.name, (text) => room(text + minimum) >= 0);
    let count = MIN_LEADER;
    const dot = Math.max(1, style.measure(LEADER));
    const spare = room(`${name} ${LEADER.repeat(count)}`);
    if (spare > 0) count += Math.floor(spare / dot);
    // Widths of whole strings do not always add up; a line must never wrap by one dot.
    while (count > MIN_LEADER && room(`${name} ${LEADER.repeat(count)}`) < 0) count--;
    return `${name} ${LEADER.repeat(count)} ${label}`;
  }

  /** The text, cut short with an ellipsis if it does not fit. */
  private static fitted(text: string, fits: (candidate: string) => boolean): string {
    if (fits(text)) return text;
    const chars = Array.from(text);
    for (let n = chars.length - 1; n > 0; n--) {
      const candidate = chars.slice(0, n).join('').trimEnd() + ELLIPSIS;
      if (fits(candidate)) return candidate;
    }
    return ELLIPSIS;
  }
}
