import type { Page } from '../core/types';
import { AnchorMarks } from './AnchorMarks';

/** One line of a PDF's document outline. */
export interface OutlineEntry {
  title: string;
  /** 1-based. */
  pageNumber: number;
  children: OutlineEntry[];
}

/** A PDF's document outline: what the reader's side panel lists. Pure. */
export class PdfOutline {
  /**
   * Titled pages at the top level with their bookmarks under them; the bookmarks of a page without
   * a title stand on their own. A bookmark on a whole page named like the page adds nothing.
   */
  static entries(pages: readonly Pick<Page, 'title' | 'anchors'>[]): OutlineEntry[] {
    return pages.flatMap((page, index) => {
      const pageNumber = index + 1;
      const { title } = page;
      const marks = AnchorMarks.ordered(page)
        .filter((anchor) => anchor.items.length > 0 || anchor.name !== title)
        .map((anchor): OutlineEntry => ({ title: anchor.name, pageNumber, children: [] }));
      return title ? [{ title, pageNumber, children: marks }] : marks;
    });
  }

  /**
   * A title as a PDF hex string in UTF-16 with its byte order mark. jsPDF writes outline titles in
   * a single-byte encoding, which would turn any non-Latin title into nonsense.
   */
  static encodedTitle(title: string): string {
    let hex = 'FEFF';
    for (let i = 0; i < title.length; i++) {
      hex += title.charCodeAt(i).toString(16).toUpperCase().padStart(4, '0');
    }
    return `<${hex}>`;
  }
}
