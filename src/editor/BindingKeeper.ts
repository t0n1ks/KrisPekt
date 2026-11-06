import type { LinkGeometry } from '../canvas/LinkGeometry';
import type { Page } from '../core/types';
import { AnchorMarks } from '../domain/AnchorMarks';
import { ItemBindings } from '../domain/ItemBindings';
import type { EditorSession } from './EditorSession';

export interface BindingKeeperDeps {
  session: Pick<EditorSession, 'notebook' | 'pages' | 'bump'>;
  geometry: Pick<LinkGeometry, 'itemBox' | 'itemsBox' | 'anchorBox'>;
  markNotebookDirty: () => void;
}

/**
 * Runs after every change to a page or to the page list, so no edit has to know about anchors and
 * links: scratching out or deleting linked ink takes the link with it, whichever way it went.
 */
export class BindingKeeper {
  private signature = '';

  constructor(private readonly deps: BindingKeeperDeps) {}

  /** A notebook was opened: its stored list of anchors may be behind its pages. */
  opened(): void {
    this.signature = '';
    this.syncMarks();
  }

  /** A page's content changed. */
  pageChanged(page: Page): void {
    const { geometry } = this.deps;
    ItemBindings.reconcile(
      page,
      (id) => geometry.itemBox(page, id) !== null,
      (items, binding) =>
        'name' in binding
          ? geometry.anchorBox(page, { ...binding, items: [...items] })
          : geometry.itemsBox(page, items),
    );
    this.syncMarks();
  }

  /** Pages were added, removed or moved. */
  listChanged(): void {
    this.syncMarks();
  }

  /**
   * Updates the notebook's list. When a link could have become valid or broken, the pages showing
   * internal links are drawn again; their bitmaps are otherwise only redone when they change.
   */
  private syncMarks(): void {
    const { session } = this.deps;
    const nb = session.notebook;
    if (!nb) return;
    const marks = AnchorMarks.of(session.pages);
    const titles = AnchorMarks.titles(session.pages);
    const changed =
      JSON.stringify(marks) !== JSON.stringify(nb.marks ?? []) ||
      JSON.stringify(titles) !== JSON.stringify(nb.pageTitles ?? []);
    if (marks.length) nb.marks = marks;
    else delete nb.marks;
    if (titles.length) nb.pageTitles = titles;
    else delete nb.pageTitles;
    if (changed) this.deps.markNotebookDirty();
    const signature = AnchorMarks.signature(marks, nb.pageIds);
    if (signature === this.signature) return;
    this.signature = signature;
    for (const page of session.pages) if (ItemBindings.hasInternalLinks(page)) session.bump(page);
  }
}
