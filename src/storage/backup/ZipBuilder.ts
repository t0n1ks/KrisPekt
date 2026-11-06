import { MAX_BACKUP_FILE_BYTES } from '../../core/constants';

/** Small pieces are gathered into parts of this size, so a backup is not thousands of tiny blobs. */
const PART_BYTES = 1024 * 1024;
const DEFLATE_LEVEL = 9;

/** The backup would exceed what a ZIP without ZIP64 can hold. */
export class BackupTooLargeError extends Error {
  constructor() {
    super('Backup too large');
    this.name = 'BackupTooLargeError';
  }
}

/** Takes the pieces of one entry as they come. */
export interface ZipSink {
  push(bytes: Uint8Array, final: boolean): void;
}

/**
 * Builds a ZIP with fflate's streaming writer. Every finished piece moves straight into a Blob,
 * which the browser may keep on disk, so the archive never has to fit in the page's memory.
 */
export class ZipBuilder {
  private readonly parts: Blob[] = [];
  private readonly pending = new Uint8Array(PART_BYTES);
  private filled = 0;
  private written = 0;
  private failure: Error | null = null;
  private readonly zip: import('fflate').Zip;

  constructor(private readonly fflate: typeof import('fflate')) {
    this.zip = new fflate.Zip((error, piece) => {
      if (error) this.failure = error;
      else this.collect(piece);
    });
  }

  /** Starts an entry kept as it is, for files that are already compressed. */
  stored(name: string): ZipSink {
    return this.open(new this.fflate.ZipPassThrough(name));
  }

  /** Starts a compressed entry. */
  deflated(name: string): ZipSink {
    return this.open(new this.fflate.ZipDeflate(name, { level: DEFLATE_LEVEL }));
  }

  /** The finished archive. */
  finish(): Blob {
    this.zip.end();
    this.check();
    this.flush();
    return new Blob(this.parts, { type: 'application/zip' });
  }

  private open(entry: import('fflate').ZipInputFile & ZipSink): ZipSink {
    this.zip.add(entry);
    return {
      push: (bytes, final) => {
        entry.push(bytes, final);
        this.check();
      },
    };
  }

  private check(): void {
    if (this.failure) throw this.failure;
    if (this.written > MAX_BACKUP_FILE_BYTES) throw new BackupTooLargeError();
  }

  private collect(piece: Uint8Array): void {
    this.written += piece.length;
    if (this.filled + piece.length > PART_BYTES) this.flush();
    if (piece.length > PART_BYTES / 2) this.parts.push(new Blob([piece as Uint8Array<ArrayBuffer>]));
    else {
      this.pending.set(piece, this.filled);
      this.filled += piece.length;
    }
  }

  private flush(): void {
    if (!this.filled) return;
    this.parts.push(new Blob([this.pending.slice(0, this.filled)]));
    this.filled = 0;
  }
}
