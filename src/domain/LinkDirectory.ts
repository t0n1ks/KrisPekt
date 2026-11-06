import type { InternalLink, LinkTarget, Notebook, Subject } from '../core/types';
import { LinkRules } from './LinkRules';

/** What the shelf can tell. `LibraryService` is one. */
export interface LibrarySource {
  notebook(id: string): Notebook | undefined;
  subject(id: string): Subject | undefined;
  sortedSubjects(): Subject[];
  notebooksOf(subjectId: string): Notebook[];
}

/** Where a valid internal link leads. */
export interface ResolvedLink {
  nb: Notebook;
  pageId: string | null;
  anchorId: string | null;
}

/** A place in the notes, for showing in a list. */
export interface LinkEntry {
  target: InternalLink;
  /** The anchor's name, the page's title or the notebook's title; empty for a page without one. */
  name: string;
  notebook: string;
  subject: string;
  /** 1-based; null for a whole notebook. */
  pageNumber: number | null;
}

/** Search matches ignore case and accents: "Ёлка" is found by "елка". */
function normalized(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase();
}

/**
 * Finds the places links lead to, on the shelf. It needs no pages: a notebook record knows its page
 * order and its anchors, so this is immediate, and a link's state can be asked for while drawing.
 * Pure over what the source says.
 */
export class LinkDirectory {
  constructor(private readonly source: LibrarySource) {}

  /** Where a link leads, or null if the target is gone. */
  resolve(link: InternalLink): ResolvedLink | null {
    const nb = this.source.notebook(link.nb);
    if (!nb) return null;
    if (link.kind === 'notebook') return { nb, pageId: null, anchorId: null };
    if (link.kind === 'page') {
      return nb.pageIds.includes(link.id) ? { nb, pageId: link.id, anchorId: null } : null;
    }
    const mark = nb.marks?.find((m) => m.id === link.id);
    return mark && nb.pageIds.includes(mark.pageId) ? { nb, pageId: mark.pageId, anchorId: mark.id } : null;
  }

  /** Whether a link's target is gone. A web address is never known to be. */
  isBroken(link: LinkTarget): boolean {
    return LinkRules.isInternal(link) && this.resolve(link) === null;
  }

  /** A place as a list entry, or null if it is gone. */
  describe(link: InternalLink): LinkEntry | null {
    const found = this.resolve(link);
    if (!found) return null;
    const mark = found.nb.marks?.find((m) => m.id === found.anchorId);
    const own = link.kind === 'notebook' ? found.nb.title : this.pageTitle(found.nb, found.pageId ?? '');
    return this.entry(link, found.nb, mark?.name ?? own, found.pageId);
  }

  /** A page's title, empty if it has none. */
  pageTitle(nb: Notebook, pageId: string): string {
    return nb.pageTitles?.find((mark) => mark.pageId === pageId)?.title ?? '';
  }

  /** Anchors, then titled pages, then notebooks, whose name has the query in it. */
  search(query: string): LinkEntry[] {
    const needle = normalized(query.trim());
    if (!needle) return [];
    const notebooks = this.source.sortedSubjects().flatMap((s) => this.source.notebooksOf(s.id));
    const anchors = notebooks.flatMap((nb) =>
      (nb.marks ?? [])
        .filter((mark) => normalized(mark.name).includes(needle))
        .map((mark) => this.entry({ kind: 'anchor', nb: nb.id, id: mark.id }, nb, mark.name, mark.pageId)),
    );
    const pages = notebooks.flatMap((nb) =>
      (nb.pageTitles ?? [])
        .filter((mark) => nb.pageIds.includes(mark.pageId) && normalized(mark.title).includes(needle))
        .map((mark) => this.entry({ kind: 'page', nb: nb.id, id: mark.pageId }, nb, mark.title, mark.pageId)),
    );
    const titled = notebooks
      .filter((nb) => normalized(nb.title).includes(needle))
      .map((nb) => this.entry({ kind: 'notebook', nb: nb.id }, nb, nb.title, null));
    return [...anchors, ...pages, ...titled];
  }

  /** The subjects that have notebooks. */
  subjects(): Subject[] {
    return this.source.sortedSubjects().filter((s) => this.source.notebooksOf(s.id).length > 0);
  }

  notebooksOf(subjectId: string): Notebook[] {
    return this.source.notebooksOf(subjectId);
  }

  /** A notebook's anchors on one page, as entries. */
  anchorsOn(nb: Notebook, pageId: string): LinkEntry[] {
    return (nb.marks ?? [])
      .filter((mark) => mark.pageId === pageId)
      .map((mark) => this.entry({ kind: 'anchor', nb: nb.id, id: mark.id }, nb, mark.name, pageId));
  }

  private entry(target: InternalLink, nb: Notebook, name: string, pageId: string | null): LinkEntry {
    return {
      target,
      name,
      notebook: nb.title,
      subject: this.source.subject(nb.subjectId)?.name ?? '',
      pageNumber: pageId === null ? null : nb.pageIds.indexOf(pageId) + 1,
    };
  }
}
