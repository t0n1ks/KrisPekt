import { MAX_BACKUP_FILE_BYTES } from '../core/constants';
import type { Page } from '../core/types';

/** What one point and one stroke take in the packed `data.json`, measured on generated handwriting. */
const BYTES_PER_POINT = 2.6;
const BYTES_PER_STROKE = 14;
/** How far the rest of a page's JSON (mostly text and ids) packs. */
const PAGE_DATA_SHARE = 0.4;
const ENVELOPE_BYTES = 2048;
/** Each file's name and sizes in the archive and the manifest. */
const BYTES_PER_FILE = 400;

/** Estimates how large a backup file would be, without building it. Pure. */
export class BackupSize {
  /** About how many bytes a backup of these pages and stored files takes. */
  static estimate(pages: readonly Page[], blobSizes: readonly number[]): number {
    let total = ENVELOPE_BYTES;
    for (const size of blobSizes) total += size + BYTES_PER_FILE;
    for (const page of pages) {
      const { strokes, ...rest } = page;
      total += JSON.stringify(rest).length * PAGE_DATA_SHARE;
      for (const stroke of strokes) total += (stroke.p.length / 3) * BYTES_PER_POINT + BYTES_PER_STROKE;
    }
    return Math.round(total);
  }

  /** Whether a backup of this size could not be made. */
  static overLimit(bytes: number): boolean {
    return bytes > MAX_BACKUP_FILE_BYTES;
  }
}
