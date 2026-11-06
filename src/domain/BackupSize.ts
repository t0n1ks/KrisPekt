import { MAX_BACKUP_BYTES } from '../core/constants';
import type { Page } from '../core/types';

/** A stroke coordinate in the file: up to 2 decimals and a comma. */
const BYTES_PER_COORDINATE = 8;
const BYTES_PER_STROKE = 80;
const ENVELOPE_BYTES = 2048;
const BASE64_GROWTH = 4 / 3;

/** Estimates how large a backup file would be, without building it. Pure. */
export class BackupSize {
  /** About how many bytes a backup of these pages and stored files takes. */
  static estimate(pages: readonly Page[], blobSizes: readonly number[]): number {
    let total = ENVELOPE_BYTES;
    for (const size of blobSizes) total += size * BASE64_GROWTH;
    for (const page of pages) {
      const { strokes, ...rest } = page;
      total += JSON.stringify(rest).length;
      for (const stroke of strokes) total += stroke.p.length * BYTES_PER_COORDINATE + BYTES_PER_STROKE;
    }
    return Math.round(total);
  }

  /** Whether a backup of this size could not be restored. */
  static overLimit(bytes: number): boolean {
    return bytes > MAX_BACKUP_BYTES;
  }
}
