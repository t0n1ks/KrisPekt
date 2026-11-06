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
  for (const list of [raw.images, raw.cards]) {
    if (!Array.isArray(list)) continue;
    for (const item of list as unknown[]) {
      if (!isRecord(item)) continue;
      if (typeof item.blob === 'string') ids.push(item.blob);
      if (typeof item.thumb === 'string') ids.push(item.thumb);
    }
  }
  return ids;
}

/** Stores binary files: photos, rasterised PDF pages, and attached PDFs with their thumbnails. */
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

  /**
   * Deletes these blobs unless a stored page references them or they are in `inUse`. A blob may
   * be shared: an item copied between notebooks, or the same PDF attached twice.
   * Returns how many were spared because of `inUse` or having just been saved.
   */
  async deleteUnreferenced(ids: ReadonlySet<string>, inUse: ReadonlySet<string>): Promise<number> {
    let spared = 0;
    await this.db.sweepBlobs(referencedBlobs, (id) => {
      if (!ids.has(id)) return true;
      const keep = inUse.has(id) || this.savedNow.has(id);
      if (keep) spared++;
      return keep;
    });
    return spared;
  }

  deleteMany(ids: readonly string[]): Promise<void> {
    return this.db.deleteMany('blobs', ids);
  }
}
