import type { BlobRecord } from '../core/types';
import type { Database } from './Database';
import type { RecordReader } from './RecordReader';
import { asId, asRecord, ValidationError } from './validation/guards';

function parseBlobRecord(raw: unknown): BlobRecord {
  const o = asRecord(raw, 'blob');
  if (!(o.blob instanceof Blob)) throw new ValidationError('blob.blob', 'expected a Blob');
  return { id: asId(o.id, 'blob.id'), blob: o.blob };
}

/** Stores binary images: inserted photos and rasterised PDF pages. */
export class BlobRepository {
  constructor(
    private readonly db: Database,
    private readonly reader: RecordReader,
  ) {}

  /** The blob with this id, or null. */
  async get(id: string): Promise<Blob | null> {
    const record = this.reader.readOne('blobs', await this.db.get('blobs', id), parseBlobRecord);
    return record ? record.blob : null;
  }

  /** Every valid blob record (used for backups). */
  async all(): Promise<BlobRecord[]> {
    return this.reader.readAll('blobs', await this.db.getAll('blobs'), parseBlobRecord);
  }

  save(id: string, blob: Blob): Promise<void> {
    const record: BlobRecord = { id, blob };
    return this.db.put('blobs', record);
  }

  deleteMany(ids: readonly string[]): Promise<void> {
    return this.db.deleteMany('blobs', ids);
  }
}
