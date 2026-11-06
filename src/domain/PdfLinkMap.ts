import type { LinkTarget, Page } from '../core/types';

/**
 * Which page of an exported PDF an internal link leads to. Only pages in the file can be gone to:
 * links to other notebooks, or to pages left out of the export, stay as they look. Pure.
 */
export class PdfLinkMap {
  private readonly byPage = new Map<string, number>();
  private readonly byAnchor = new Map<string, number>();
  private readonly nbId: string | null;

  constructor(pages: readonly Pick<Page, 'id' | 'nbId' | 'anchors'>[]) {
    this.nbId = pages[0]?.nbId ?? null;
    pages.forEach((page, index) => {
      this.byPage.set(page.id, index + 1);
      for (const anchor of page.anchors) this.byAnchor.set(anchor.id, index + 1);
    });
  }

  /** The 1-based PDF page, or null if the file has no such place. */
  pageNumber(link: LinkTarget): number | null {
    if (link.kind === 'url' || link.nb !== this.nbId) return null;
    if (link.kind === 'notebook') return this.byPage.size ? 1 : null;
    return (link.kind === 'page' ? this.byPage : this.byAnchor).get(link.id) ?? null;
  }
}
