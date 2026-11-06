import type { Anchor, AnchorMark, Page } from '../core/types';

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

  /** Changes exactly when a link somewhere could become valid or broken. */
  static signature(marks: readonly AnchorMark[], pageIds: readonly string[]): string {
    return JSON.stringify([marks.map((mark) => mark.id).sort(), [...pageIds].sort()]);
  }
}
