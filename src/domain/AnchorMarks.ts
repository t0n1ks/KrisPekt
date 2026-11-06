import type { Anchor, AnchorMark, InternalLink, LinkTarget, Page, PageTitleMark } from '../core/types';
import { LinkRules } from './LinkRules';

/**
 * The notebook's list of its anchors, derived from its pages. The notebook record has it so that
 * links can be checked and anchors searched across the shelf without loading any page. Pure.
 */
export class AnchorMarks {
  /** A page's anchors from the top of the page down; whole-page anchors first. */
  static ordered(page: Pick<Page, 'anchors'>): Anchor[] {
    const top = (anchor: Anchor): number => (anchor.items.length ? anchor.rect.y : -Infinity);
    return [...page.anchors].sort((a, b) => top(a) - top(b));
  }

  /** Every anchor of the pages, in page order. */
  static of(pages: readonly Pick<Page, 'id' | 'anchors'>[]): AnchorMark[] {
    return pages.flatMap((page) =>
      AnchorMarks.ordered(page).map((anchor) => ({ id: anchor.id, pageId: page.id, name: anchor.name })),
    );
  }

  /** The titles of the pages that have one, in page order. */
  static titles(pages: readonly Pick<Page, 'id' | 'title'>[]): PageTitleMark[] {
    return pages.flatMap((page) => (page.title ? [{ pageId: page.id, title: page.title }] : []));
  }

  /**
   * The anchors bound to these items and nothing else. With a range, a stretch of text counts only
   * if it overlaps the range. Whole-page anchors are on no items, so they never count.
   */
  static on(
    page: Pick<Page, 'anchors'>,
    ids: ReadonlySet<string>,
    range: readonly [number, number] | null = null,
  ): Anchor[] {
    const overlaps = (anchor: Anchor): boolean =>
      !range || !anchor.range || (anchor.range[0] < range[1] && range[0] < anchor.range[1]);
    return page.anchors.filter(
      (anchor) => anchor.items.length > 0 && anchor.items.every((id) => ids.has(id)) && overlaps(anchor),
    );
  }

  /** How many links on these pages lead to these places. A word split into runs is one link. */
  static incoming(
    pages: readonly Pick<Page, 'texts' | 'inkLinks'>[],
    targets: readonly InternalLink[],
  ): number {
    const leadsThere = (link: LinkTarget | undefined): boolean =>
      targets.some((target) => LinkRules.same(link, target));
    let count = 0;
    for (const page of pages) {
      count += page.inkLinks.filter((ink) => leadsThere(ink.link)).length;
      for (const item of page.texts) {
        for (const para of item.paras ?? []) {
          let before: LinkTarget | undefined;
          for (const run of para.runs) {
            if (leadsThere(run.link) && !LinkRules.same(run.link, before)) count++;
            before = run.link;
          }
        }
      }
    }
    return count;
  }

  /** Changes exactly when a link somewhere could become valid or broken. */
  static signature(marks: readonly AnchorMark[], pageIds: readonly string[]): string {
    return JSON.stringify([marks.map((mark) => mark.id).sort(), [...pageIds].sort()]);
  }
}
