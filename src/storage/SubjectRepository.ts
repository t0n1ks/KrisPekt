import type { Subject } from '../core/types';
import type { Database } from './Database';
import type { RecordReader } from './RecordReader';
import { parseSubject } from './validation/records';

/** Stores subjects (the shelf sections). */
export class SubjectRepository {
  constructor(
    private readonly db: Database,
    private readonly reader: RecordReader,
  ) {}

  /** All valid subjects. */
  async all(): Promise<Subject[]> {
    return this.reader.readAll('subjects', await this.db.getAll('subjects'), (raw) => parseSubject(raw));
  }

  /** Inserts or replaces subjects. */
  save(...subjects: Subject[]): Promise<void> {
    return this.db.putMany(
      'subjects',
      subjects.map((s) => ({ ...s })),
    );
  }

  delete(id: string): Promise<void> {
    return this.db.delete('subjects', id);
  }
}
