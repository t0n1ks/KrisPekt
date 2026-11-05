import type { BlobRecord } from '../core/types';
import type { Database } from './Database';
import type { RecordReader } from './RecordReader';
import { asId, asRecord, isRecord, ValidationError } from './validation/guards';

function parseBlobRecord(raw: unknown): BlobRecord {
  const o = asRecord(raw, 'blob');
  if (!(o.blob instanceof Blob)) throw new ValidationError('blob.blob', 'expected a Blob');
  return { id: asId(o.id, 'blob.id'), blob: o.blob };
}

/**
 * Blob ids in a stored page record, read leniently: a record that fails validation is skipped
 * when loading, but it may be repaired later, so its images must not be treated as unused.
 */
function referencedBlobs(raw: unknown): string[] {
  if (!isRecord(raw)) return [];
  const ids = typeof raw.bgBlob === 'string' ? [raw.bgBlob] : [];
  if (!Array.isArray(raw.images)) return ids;
  for (const image of raw.images as unknown[]) {
    if (isRecord(image) && typeof image.blob === 'string') ids.push(image.blob);
  }
  return ids;
}

/** Stores binary images: inserted photos and rasterised PDF pages. */
export class BlobRepository {
  /** Saved since the app started; a page may be about to reference them (a PDF still importing). */
  private readonly savedNow = new Set<string>();

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
    this.savedNow.add(id);
    const record: BlobRecord = { id, blob };
    return this.db.put('blobs', record);
  }

  /**
   * Deletes blobs no stored page references, except those in `inUse` and those saved since the
   * app started. Returns how many were deleted and how many spared for now.
   */
  sweep(inUse: ReadonlySet<string>): Promise<{ deleted: number; spared: number }> {
    return this.db.sweepBlobs(referencedBlobs, (id) => inUse.has(id) || this.savedNow.has(id));
  }

  deleteMany(ids: readonly string[]): Promise<void> {
    return this.db.deleteMany('blobs', ids);
  }
}
