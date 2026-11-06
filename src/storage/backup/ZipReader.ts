import {
  MAX_BACKUP_ENTRIES,
  MAX_BACKUP_RATIO,
  MAX_BACKUP_RATIO_FLOOR,
  MAX_BACKUP_TOTAL_BYTES,
} from '../../core/constants';

const END_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const END_SIZE = 22;
const CENTRAL_SIZE = 46;
const LOCAL_SIZE = 30;
const MAX_COMMENT = 0xffff;
const CHUNK_BYTES = 1024 * 1024;

export type ZipMethod = 0 | 8;

/** One file of an archive, as its central directory describes it. */
export interface ZipEntry {
  name: string;
  method: ZipMethod;
  compressedSize: number;
  size: number;
  headerOffset: number;
  /** Where the next entry, or the directory, starts: this entry may not read past it. */
  limit: number;
}

/** The archive is malformed, or it tries something an honest backup never does. */
export class ZipFormatError extends Error {
  constructor(problem: string) {
    super('Bad ZIP: ' + problem);
    this.name = 'ZipFormatError';
  }
}

function slice(file: Blob, start: number, end: number): Promise<Uint8Array<ArrayBuffer>> {
  return file
    .slice(start, end)
    .arrayBuffer()
    .then((buffer) => new Uint8Array(buffer));
}

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/**
 * Reads a ZIP from a file without loading it: the directory at the end first, so every limit is
 * checked before a single byte is unpacked, then each entry on its own, piece by piece.
 *
 * A reader that walks the file from the start, like fflate's streaming `Unzip`, cannot be used. The
 * writer does not know sizes in advance, so it records them after each entry, and a stored file
 * could contain bytes that look like the end of an entry. The directory has the real sizes.
 *
 * ZIP64 is not understood, and neither the writer nor the limits ever need it.
 */
export class ZipReader {
  private constructor(
    private readonly file: Blob,
    readonly entries: readonly ZipEntry[],
    private readonly fflate: typeof import('fflate'),
  ) {}

  /** Reads and checks the directory. Throws {@link ZipFormatError}. */
  static async open(file: Blob): Promise<ZipReader> {
    const end = await ZipReader.findEnd(file);
    const entries = ZipReader.parseDirectory(
      await slice(file, end.directoryOffset, end.directoryOffset + end.directorySize),
      end.count,
      end.directoryOffset,
    );
    return new ZipReader(file, entries, await import('fflate'));
  }

  private static async findEnd(
    file: Blob,
  ): Promise<{ count: number; directoryOffset: number; directorySize: number }> {
    if (file.size < END_SIZE) throw new ZipFormatError('too short');
    const from = Math.max(0, file.size - END_SIZE - MAX_COMMENT);
    const tail = await slice(file, from, file.size);
    const data = view(tail);
    for (let at = tail.length - END_SIZE; at >= 0; at--) {
      if (data.getUint32(at, true) !== END_SIGNATURE) continue;
      if (at + END_SIZE + data.getUint16(at + 20, true) !== tail.length) continue;
      const end = {
        disk: data.getUint16(at + 4, true),
        directoryDisk: data.getUint16(at + 6, true),
        here: data.getUint16(at + 8, true),
        count: data.getUint16(at + 10, true),
        directorySize: data.getUint32(at + 12, true),
        directoryOffset: data.getUint32(at + 16, true),
      };
      if (end.disk || end.directoryDisk || end.here !== end.count) throw new ZipFormatError('split archive');
      if (end.count === 0xffff || end.directoryOffset === 0xffffffff) throw new ZipFormatError('ZIP64');
      if (end.count > MAX_BACKUP_ENTRIES) throw new ZipFormatError('too many entries');
      if (end.directoryOffset + end.directorySize > from + at) throw new ZipFormatError('bad directory');
      return end;
    }
    throw new ZipFormatError('no end of directory');
  }

  private static parseDirectory(bytes: Uint8Array, count: number, directoryOffset: number): ZipEntry[] {
    const data = view(bytes);
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const entries: ZipEntry[] = [];
    let at = 0;
    let total = 0;
    for (let i = 0; i < count; i++) {
      if (at + CENTRAL_SIZE > bytes.length || data.getUint32(at, true) !== CENTRAL_SIGNATURE) {
        throw new ZipFormatError('bad directory entry');
      }
      const nameLength = data.getUint16(at + 28, true);
      const next =
        at + CENTRAL_SIZE + nameLength + data.getUint16(at + 30, true) + data.getUint16(at + 32, true);
      if (next > bytes.length) throw new ZipFormatError('bad directory entry');
      const entry = ZipReader.parseEntry(
        data,
        at,
        decoder.decode(bytes.subarray(at + CENTRAL_SIZE, at + CENTRAL_SIZE + nameLength)),
      );
      total += entry.size;
      if (total > MAX_BACKUP_TOTAL_BYTES) throw new ZipFormatError('too large when unpacked');
      entries.push(entry);
      at = next;
    }
    if (at !== bytes.length) throw new ZipFormatError('bad directory size');
    return ZipReader.withLimits(entries, directoryOffset);
  }

  private static parseEntry(data: DataView, at: number, name: string): ZipEntry {
    if (data.getUint16(at + 8, true) & 1) throw new ZipFormatError('encrypted');
    const method = data.getUint16(at + 10, true);
    if (method !== 0 && method !== 8) throw new ZipFormatError('unknown compression');
    const compressedSize = data.getUint32(at + 20, true);
    const size = data.getUint32(at + 24, true);
    if (method === 0 && compressedSize !== size) throw new ZipFormatError('stored size differs');
    if (size > MAX_BACKUP_RATIO_FLOOR && size > compressedSize * MAX_BACKUP_RATIO) {
      throw new ZipFormatError('compression ratio too high');
    }
    return { name, method, compressedSize, size, headerOffset: data.getUint32(at + 42, true), limit: 0 };
  }

  /** Entries may not overlap: overlapping ones are how the worst ZIP bombs are built. */
  private static withLimits(entries: ZipEntry[], directoryOffset: number): ZipEntry[] {
    const ordered = [...entries].sort((a, b) => a.headerOffset - b.headerOffset);
    ordered.forEach((entry, i) => {
      entry.limit = ordered[i + 1]?.headerOffset ?? directoryOffset;
      if (entry.headerOffset + LOCAL_SIZE + entry.name.length + entry.compressedSize > entry.limit) {
        throw new ZipFormatError('entries overlap');
      }
    });
    return entries;
  }

  /** The entry's bytes in pieces, unpacked and counted. Throws if they differ from what was declared. */
  async *read(entry: ZipEntry): AsyncGenerator<Uint8Array, void, void> {
    const start = await this.dataStart(entry);
    let produced = 0;
    const count = (piece: Uint8Array): Uint8Array => {
      produced += piece.length;
      // Counted as it arrives, so a bomb is stopped before it fills the memory.
      if (produced > entry.size) throw new ZipFormatError('entry longer than declared');
      return piece;
    };
    if (entry.method === 0) {
      for (let at = 0; at < entry.size; at += CHUNK_BYTES) {
        yield count(await slice(this.file, start + at, start + Math.min(entry.size, at + CHUNK_BYTES)));
      }
    } else {
      for await (const piece of this.inflated(entry, start)) yield count(piece);
    }
    if (produced !== entry.size) throw new ZipFormatError('entry shorter than declared');
  }

  /** All of an entry at once; for files whose size has been checked. */
  async bytes(entry: ZipEntry): Promise<Uint8Array<ArrayBuffer>> {
    if (entry.method === 0) {
      const start = await this.dataStart(entry);
      return slice(this.file, start, start + entry.size);
    }
    const out = new Uint8Array(entry.size);
    let at = 0;
    for await (const piece of this.read(entry)) {
      out.set(piece, at);
      at += piece.length;
    }
    return out;
  }

  private async *inflated(entry: ZipEntry, start: number): AsyncGenerator<Uint8Array, void, void> {
    let ready: Uint8Array[] = [];
    let ended = false;
    const inflate = new this.fflate.Inflate((piece, final) => {
      ready.push(piece);
      if (final) ended = true;
    });
    try {
      for (let at = 0; at < entry.compressedSize || at === 0; at += CHUNK_BYTES) {
        const end = Math.min(entry.compressedSize, at + CHUNK_BYTES);
        inflate.push(await slice(this.file, start + at, start + end), end === entry.compressedSize);
        const pieces = ready;
        ready = [];
        yield* pieces;
      }
    } catch (error) {
      throw error instanceof ZipFormatError ? error : new ZipFormatError('bad compressed data');
    }
    if (!ended) throw new ZipFormatError('truncated compressed data');
  }

  /** Checks the entry's local header against the directory, and finds where its data begins. */
  private async dataStart(entry: ZipEntry): Promise<number> {
    const header = await slice(this.file, entry.headerOffset, entry.headerOffset + LOCAL_SIZE);
    if (header.length < LOCAL_SIZE) throw new ZipFormatError('bad local header');
    const data = view(header);
    if (data.getUint32(0, true) !== LOCAL_SIGNATURE) throw new ZipFormatError('bad local header');
    if (data.getUint16(8, true) !== entry.method) throw new ZipFormatError('local header differs');
    const nameLength = data.getUint16(26, true);
    const start = entry.headerOffset + LOCAL_SIZE + nameLength + data.getUint16(28, true);
    const name = await slice(
      this.file,
      entry.headerOffset + LOCAL_SIZE,
      entry.headerOffset + LOCAL_SIZE + nameLength,
    );
    if (new TextDecoder().decode(name) !== entry.name) throw new ZipFormatError('local header differs');
    if (start + entry.compressedSize > entry.limit) throw new ZipFormatError('entries overlap');
    return start;
  }
}
