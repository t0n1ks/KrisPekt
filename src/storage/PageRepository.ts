import type { Notebook, Page } from '../core/types';
import { CardRules } from '../domain/CardRules';
import type { Database } from './Database';
import { NotebookRepository } from './NotebookRepository';
import type { RecordReader } from './RecordReader';
import { parsePage } from './validation/records';

/** Stores pages; strokes are kept as Float32Array. */
export class PageRepository {
  constructor(
    private readonly db: Database,
    private readonly reader: RecordReader,
  ) {}

  /** All valid pages of every notebook (used for backups). */
  async all(): Promise<Page[]> {
    return this.reader.readAll('pages', await this.db.getAll('pages'), (raw) => parsePage(raw));
  }

  /** Valid pages of one notebook, in storage order. */
  async ofNotebook(notebookId: string): Promise<Page[]> {
    return this.reader.readAll('pages', await this.db.pagesOf(notebookId), (raw) => parsePage(raw));
  }

  /**
   * Pages of a notebook in `pageIds` order; pages missing from that list are appended
   * so nothing stored is ever lost from view, and a page listed twice appears once.
   */
  async loadOrdered(nb: Notebook): Promise<Page[]> {
    const pages = await this.ofNotebook(nb.id);
    const byId = new Map(pages.map((p) => [p.id, p]));
    const listed = new Set(nb.pageIds.map((id) => byId.get(id)).filter((p): p is Page => !!p));
    for (const page of pages) listed.add(page);
    return [...listed];
  }

  /** Inserts or replaces pages. */
  save(...pages: Page[]): Promise<void> {
    return this.db.putMany('pages', pages.map(PageRepository.toRecord));
  }

  deleteMany(ids: readonly string[]): Promise<void> {
    return this.db.deleteMany('pages', ids);
  }

  /**
   * Saves and deletes pages together with their notebook in one transaction, so the page order
   * can never disagree with the pages stored, whenever the app is closed.
   */
  commit(notebook: Notebook | null, save: readonly Page[], remove: readonly string[]): Promise<void> {
    return this.db.writeAcross([
      { store: 'pages', values: save.map(PageRepository.toRecord), deletes: remove },
      { store: 'notebooks', values: notebook ? [NotebookRepository.toRecord(notebook)] : [] },
    ]);
  }

  /** A shallow copy with only the persisted fields. */
  static toRecord(p: Page): Page {
    return {
      id: p.id,
      nbId: p.nbId,
      w: p.w,
      h: p.h,
      locked: !!p.locked,
      bg: p.bg,
      bgBlob: p.bgBlob || null,
      strokes: p.strokes,
      texts: p.texts,
      images: p.images,
      cards: p.cards,
      updatedAt: p.updatedAt || Date.now(),
    };
  }

  /** Ids of every blob a set of pages references (backgrounds, images and attachments). */
  static blobIds(pages: readonly Page[]): Set<string> {
    const ids = new Set<string>();
    for (const p of pages) {
      if (p.bgBlob) ids.add(p.bgBlob);
      for (const image of p.images) ids.add(image.blob);
      for (const card of p.cards) for (const id of CardRules.blobIds(card)) ids.add(id);
    }
    return ids;
  }
}
