import type { Notebook, Subject } from '../core/types';
import type { Database } from './Database';
import type { RecordReader } from './RecordReader';
import { parseNotebook } from './validation/records';

/** Stores notebooks (metadata only; pages live in PageRepository). */
export class NotebookRepository {
  constructor(
    private readonly db: Database,
    private readonly reader: RecordReader,
  ) {}

  /** All valid notebooks. */
  async all(): Promise<Notebook[]> {
    return this.reader.readAll('notebooks', await this.db.getAll('notebooks'), (raw) => parseNotebook(raw));
  }

  /** Inserts or replaces notebooks. */
  save(...notebooks: Notebook[]): Promise<void> {
    return this.db.putMany('notebooks', notebooks.map(NotebookRepository.toRecord));
  }

  /** Writes a subject together with its notebooks: going to the Trash or back is all or nothing. */
  saveWithSubject(subject: Subject, notebooks: readonly Notebook[]): Promise<void> {
    return this.db.writeAcross([
      { store: 'subjects', values: [{ ...subject }] },
      { store: 'notebooks', values: notebooks.map(NotebookRepository.toRecord) },
    ]);
  }

  delete(id: string): Promise<void> {
    return this.db.delete('notebooks', id);
  }

  /** A plain copy with only the persisted fields. */
  static toRecord(nb: Notebook): Notebook {
    const record: Notebook = {
      id: nb.id,
      subjectId: nb.subjectId,
      title: nb.title,
      color: nb.color,
      base: { w: nb.base.w, h: nb.base.h },
      bg: nb.bg,
      pageIds: [...nb.pageIds],
      createdAt: nb.createdAt,
      updatedAt: nb.updatedAt,
      view: nb.view ? { pageId: nb.view.pageId, z: nb.view.z } : null,
    };
    if (nb.sample) record.sample = true;
    if (nb.order !== undefined) record.order = nb.order;
    if (nb.zoomLock !== undefined) record.zoomLock = nb.zoomLock;
    if (nb.marks?.length) record.marks = nb.marks.map((mark) => ({ ...mark }));
    if (nb.deletedAt !== undefined) record.deletedAt = nb.deletedAt;
    if (nb.deletedWithSubject) record.deletedWithSubject = true;
    return record;
  }
}
