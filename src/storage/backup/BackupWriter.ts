import {
  BACKUP_APP,
  BACKUP_FORMAT,
  MAX_BACKUP_DATA_BYTES,
  MAX_BACKUP_ENTRIES,
  MAX_BACKUP_ENTRY_BYTES,
  MAX_BACKUP_LINE_BYTES,
} from '../../core/constants';
import type { BlobRecord, Notebook, Page, Subject } from '../../core/types';
import { sha256Hex, sniffBytes } from '../../core/utils/files';
import { Sha256 } from '../../core/utils/Sha256';
import { UiYield } from '../../core/utils/UiYield';
import { BackupEntries, type BackupFileType } from '../../domain/BackupEntries';
import { StrokeCodec } from '../../domain/StrokeCodec';
import type { BlobRepository } from '../BlobRepository';
import type { NotebookRepository } from '../NotebookRepository';
import type { PageRepository } from '../PageRepository';
import type { SubjectRepository } from '../SubjectRepository';
import type { BlobTableRow, ManifestEntry } from '../validation/backup';
import { BackupTooLargeError, ZipBuilder, type ZipSink } from './ZipBuilder';

const PIECE_BYTES = 256 * 1024;
/** A PDF is compressed only if a sample of it shrinks at least this far; most are already compressed. */
const PDF_WORTH_COMPRESSING = 0.85;
const PDF_SAMPLE_BYTES = 256 * 1024;
/** The files take this share of the progress bar, the page data the rest. */
const FILES_SHARE = 0.8;
const encoder = new TextEncoder();

/** Called with how much of a job is done, from 0 to 1. */
export type BackupProgress = (fraction: number) => void;

/**
 * Converts a stored file whose type a backup may not contain (for example a GIF inserted by an
 * older version) into an allowed one. Returns null to leave the file out.
 */
export type BlobNormalizer = (blob: Blob) => Promise<Blob | null>;

export interface BackupWriterRepositories {
  subjects: SubjectRepository;
  notebooks: NotebookRepository;
  pages: PageRepository;
  blobs: BlobRepository;
}

/** A finished backup. */
export interface BackupOutput {
  file: Blob;
  /** Stored files that could not be included: damaged, or of no known type. */
  skipped: number;
}

/** One file ready for the archive. */
interface PreparedFile {
  bytes: Uint8Array;
  type: BackupFileType;
  sha: string;
}

/** The files of a backup once they are in the archive. */
interface WrittenFiles {
  table: BlobTableRow[];
  entries: ManifestEntry[];
  skipped: number;
}

/** A stroke as `data.json` holds it. */
function compactPage(page: Page): unknown {
  return {
    ...page,
    strokes: page.strokes.map(({ p, ...stroke }) => ({ ...stroke, d: StrokeCodec.encode(p) })),
  };
}

function hashOf(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return sha256Hex(bytes).then((hex) => hex ?? new Sha256().update(bytes).hex());
}

/**
 * Writes a format 2 backup: one ZIP with raw files, `data.json` and `manifest.json`. See README for
 * the layout. Files are read one at a time, and identical files are stored once.
 */
export class BackupWriter {
  private readonly pause = new UiYield();

  constructor(
    private readonly repos: BackupWriterRepositories,
    private readonly normalize: BlobNormalizer,
    private readonly appVersion: string,
  ) {}

  /** Collects every valid record into a backup file. */
  async write(onProgress: BackupProgress = () => undefined): Promise<BackupOutput> {
    try {
      const [subjects, notebooks, pages, blobs] = await Promise.all([
        this.repos.subjects.all(),
        this.repos.notebooks.all(),
        this.repos.pages.all(),
        this.repos.blobs.all(),
      ]);
      const fflate = await import('fflate');
      const zip = new ZipBuilder(fflate);
      const files = await this.addFiles(zip, fflate, blobs, onProgress);
      const data = await this.addData(zip, { subjects, notebooks, blobs: files.table }, pages, onProgress);
      this.addManifest(zip, subjects, notebooks, pages.length, [...files.entries, data]);
      onProgress(1);
      return { file: zip.finish(), skipped: files.skipped };
    } finally {
      this.pause.close();
    }
  }

  private async addFiles(
    zip: ZipBuilder,
    fflate: typeof import('fflate'),
    blobs: readonly BlobRecord[],
    onProgress: BackupProgress,
  ): Promise<WrittenFiles> {
    const total = blobs.reduce((sum, record) => sum + record.blob.size, 0) + 1;
    const written: WrittenFiles = { table: [], entries: [], skipped: 0 };
    const seen = new Set<string>();
    let done = 0;
    for (const record of blobs) {
      const file = await this.prepare(record);
      done += record.blob.size;
      if (!file) written.skipped++;
      else {
        const name = BackupEntries.fileName(file.sha, file.type);
        written.table.push({ id: record.id, file: name });
        if (!seen.has(name)) {
          seen.add(name);
          // Two more entries follow: the data and the manifest.
          if (seen.size + 2 > MAX_BACKUP_ENTRIES) throw new BackupTooLargeError();
          await this.addFile(zip, fflate, BackupEntries.path(name), file);
          written.entries.push({ name: BackupEntries.path(name), size: file.bytes.length, sha256: file.sha });
        }
      }
      onProgress((done / total) * FILES_SHARE);
      await this.pause.pause();
    }
    return written;
  }

  /** Reads one stored file. Its real type comes from its bytes, so that the backup can be restored. */
  private async prepare(record: BlobRecord): Promise<PreparedFile | null> {
    if (record.blob.size > MAX_BACKUP_ENTRY_BYTES) return null;
    let bytes = new Uint8Array(await record.blob.arrayBuffer());
    let type = BackupEntries.typeOf(sniffBytes(bytes.subarray(0, 16)));
    if (!type) {
      const converted = await this.normalize(record.blob);
      if (!converted) return null;
      bytes = new Uint8Array(await converted.arrayBuffer());
      type = BackupEntries.typeOf(sniffBytes(bytes.subarray(0, 16)));
      if (!type) return null;
    }
    return { bytes, type, sha: await hashOf(bytes) };
  }

  private async addFile(
    zip: ZipBuilder,
    fflate: typeof import('fflate'),
    path: string,
    file: PreparedFile,
  ): Promise<void> {
    const sink = this.worthCompressing(fflate, file) ? zip.deflated(path) : zip.stored(path);
    await this.pushPieces(sink, file.bytes, true);
  }

  /** Images are already compressed. A PDF may or may not be: only a sample can tell. */
  private worthCompressing(fflate: typeof import('fflate'), file: PreparedFile): boolean {
    if (file.type !== 'application/pdf') return false;
    const sample = file.bytes.subarray(0, PDF_SAMPLE_BYTES);
    return fflate.deflateSync(sample, { level: 6 }).length < sample.length * PDF_WORTH_COMPRESSING;
  }

  /**
   * Writes `data.json` line by line: a head, then one page per line. It is valid JSON as a whole,
   * and the reader takes it a line at a time, so neither side needs it all in one string.
   */
  private async addData(
    zip: ZipBuilder,
    head: unknown,
    pages: readonly Page[],
    onProgress: BackupProgress,
  ): Promise<ManifestEntry> {
    const sink = zip.deflated(BackupEntries.DATA);
    const hash = new Sha256();
    let size = 0;
    const write = async (text: string, final = false): Promise<void> => {
      const bytes = encoder.encode(text);
      size += bytes.length;
      if (bytes.length > MAX_BACKUP_LINE_BYTES || size > MAX_BACKUP_DATA_BYTES)
        throw new BackupTooLargeError();
      hash.update(bytes);
      await this.pushPieces(sink, bytes, final);
    };
    await write(JSON.stringify(head).slice(0, -1) + ',"pages":[\n');
    for (const [i, page] of pages.entries()) {
      await write(JSON.stringify(compactPage(page)) + (i < pages.length - 1 ? ',\n' : '\n'));
      onProgress(FILES_SHARE + ((1 - FILES_SHARE) * i) / pages.length);
    }
    await write(']}', true);
    return { name: BackupEntries.DATA, size, sha256: hash.hex() };
  }

  private addManifest(
    zip: ZipBuilder,
    subjects: readonly Subject[],
    notebooks: readonly Notebook[],
    pages: number,
    entries: readonly ManifestEntry[],
  ): void {
    const manifest = {
      app: BACKUP_APP,
      format: BACKUP_FORMAT,
      createdAt: new Date().toISOString(),
      appVersion: this.appVersion,
      counts: {
        subjects: subjects.length,
        notebooks: notebooks.length,
        pages,
        files: entries.length - 1,
        trash: [...subjects, ...notebooks].filter((item) => item.deletedAt !== undefined).length,
      },
      entries,
    };
    zip.deflated(BackupEntries.MANIFEST).push(encoder.encode(JSON.stringify(manifest)), true);
  }

  private async pushPieces(sink: ZipSink, bytes: Uint8Array, final: boolean): Promise<void> {
    for (let at = 0; at < bytes.length; at += PIECE_BYTES) {
      const end = Math.min(bytes.length, at + PIECE_BYTES);
      sink.push(bytes.subarray(at, end), final && end === bytes.length);
      await this.pause.pause();
    }
  }
}
