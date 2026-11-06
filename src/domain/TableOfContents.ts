import type { InternalLink, Page, TextParagraph, TextStyle } from '../core/types';
import { AnchorMarks } from './AnchorMarks';
import { LinkRules } from './LinkRules';

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
  measure: (text: string, look?: TextStyle) => number;
}

/** What the user made of a line: its paragraph's settings and its text's style. */
interface LineLook {
  para: Omit<TextParagraph, 'runs'>;
  style: TextStyle;
}

const LEADER = '.';
const MIN_LEADER = 3;
const ELLIPSIS = '…';

/** Builds a notebook's table of contents: its anchors in page order. Pure. */
export class TableOfContents {
  /**
   * The titled pages and the anchors of a notebook, with their page numbers. A bookmark on a whole
   * page named like the page stands for both.
   */
  static entries(nbId: string, pages: readonly Pick<Page, 'id' | 'anchors' | 'title'>[]): ContentsEntry[] {
    return pages.flatMap((page, index) => {
      const number = index + 1;
      const anchors = AnchorMarks.ordered(page);
      const { title } = page;
      const named = anchors.some((anchor) => !anchor.items.length && anchor.name === title);
      const heading: ContentsEntry[] =
        title && !named
          ? [{ name: title, page: number, target: { kind: 'page', nb: nbId, id: page.id } }]
          : [];
      return [
        ...heading,
        ...anchors.map((anchor): ContentsEntry => ({
          name: anchor.name,
          page: number,
          target: { kind: 'anchor', nb: nbId, id: anchor.id },
        })),
      ];
    });
  }

  /**
   * One linked paragraph per entry, "Name ……… p. N", each on one line of the given width. Written
   * again, a line keeps the look of the `previous` line leading to the same place; a new line takes
   * the look of the nearest line that has one.
   */
  static paragraphs(
    entries: readonly ContentsEntry[],
    style: ContentsStyle,
    previous: readonly TextParagraph[] = [],
  ): TextParagraph[] {
    const looks = entries.map((entry) => TableOfContents.lookOf(entry, previous));
    const fallback = previous[0] ? TableOfContents.lookIn(previous[0]) : { para: {}, style: {} };
    return entries.map((entry, index) => {
      const look = TableOfContents.nearest(looks, index) ?? fallback;
      const t = TableOfContents.line(entry, style, look.style);
      return { ...look.para, runs: [{ ...look.style, t, link: entry.target }] };
    });
  }

  private static lookOf(entry: ContentsEntry, previous: readonly TextParagraph[]): LineLook | null {
    const para = previous.find((other) => other.runs.some((run) => LinkRules.same(run.link, entry.target)));
    return para ? TableOfContents.lookIn(para) : null;
  }

  private static lookIn(paragraph: TextParagraph): LineLook {
    const { runs, ...para } = paragraph;
    const first = runs.find((run) => run.link) ?? runs[0];
    if (!first) return { para, style: {} };
    const { t: _text, link: _link, ...style } = first;
    return { para, style };
  }

  /** The look at an index, or the closest one to it, the earlier one when two are as close. */
  private static nearest(looks: readonly (LineLook | null)[], index: number): LineLook | null {
    for (let distance = 0; distance < looks.length; distance++) {
      const found = looks[index - distance] ?? looks[index + distance];
      if (found) return found;
    }
    return null;
  }

  private static line(entry: ContentsEntry, style: ContentsStyle, look: TextStyle = {}): string {
    const label = style.pageLabel(entry.page);
    const room = (text: string): number => style.width - style.measure(`${text} ${label}`, look);
    const minimum = ' ' + LEADER.repeat(MIN_LEADER);
    const name = TableOfContents.fitted(entry.name, (text) => room(text + minimum) >= 0);
    let count = MIN_LEADER;
    const dot = Math.max(1, style.measure(LEADER, look));
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
