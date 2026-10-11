import type { Notebook, Page } from '../core/types';
import type { Database } from './Database';
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
   * so nothing stored is ever lost from view.
   */
  async loadOrdered(nb: Notebook): Promise<Page[]> {
    const pages = await this.ofNotebook(nb.id);
    const byId = new Map(pages.map((p) => [p.id, p]));
    const ordered = nb.pageIds.map((id) => byId.get(id)).filter((p): p is Page => !!p);
    const listed = new Set(ordered);
    for (const page of pages) if (!listed.has(page)) ordered.push(page);
    return ordered;
  }

  /** Inserts or replaces pages. */
  save(...pages: Page[]): Promise<void> {
    return this.db.putMany('pages', pages.map(PageRepository.toRecord));
  }

  deleteMany(ids: readonly string[]): Promise<void> {
    return this.db.deleteMany('pages', ids);
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
      updatedAt: p.updatedAt || Date.now(),
    };
  }

  /** Ids of every blob a set of pages references (backgrounds and images). */
  static blobIds(pages: readonly Page[]): Set<string> {
    const ids = new Set<string>();
    for (const p of pages) {
      if (p.bgBlob) ids.add(p.bgBlob);
      for (const image of p.images) ids.add(image.blob);
    }
    return ids;
  }
}
