import {
  MAX_BACKUP_DATA_BYTES,
  MAX_BACKUP_ENTRY_BYTES,
  MAX_BACKUP_MANIFEST_BYTES,
} from '../../core/constants';
import type { Page } from '../../core/types';
import { Sha256 } from '../../core/utils/Sha256';
import { UiYield } from '../../core/utils/UiYield';
import { BackupEntries } from '../../domain/BackupEntries';
import {
  assertUniqueIds,
  finishNotebooks,
  parseManifest,
  type BackupManifest,
  type BlobTableRow,
  type DataHead,
} from '../validation/backup';
import { ValidationError } from '../validation/guards';
import { BackupDamagedError } from './BackupDamagedError';
import { BackupDataLines } from './BackupDataLines';
import type { BackupProgress } from './BackupWriter';
import { ZipFormatError, ZipReader, type ZipEntry } from './ZipReader';

/** A format 2 backup with its data checked. Its files are checked as they are restored. */
export interface ZipBackup {
  kind: 'zip';
  zip: ZipReader;
  subjects: DataHead['subjects'];
  notebooks: DataHead['notebooks'];
  pages: Page[];
  /** Which ids each file in the archive is stored under. */
  files: { entry: ZipEntry; sha: string; ids: string[] }[];
}

/**
 * Reads a format 2 backup and checks all of it except the files' contents, without writing anything.
 * Throws {@link ZipFormatError} or {@link BackupDamagedError} on a damaged or hostile archive, and
 * ValidationError on data of the wrong shape.
 */
export class BackupReader {
  private readonly pause = new UiYield();

  /** Opens and checks a backup file. */
  async read(file: Blob, onProgress: BackupProgress = () => undefined): Promise<ZipBackup> {
    try {
      const zip = await ZipReader.open(file);
      const byName = BackupReader.checkEntries(zip);
      const manifest = await this.readManifest(zip, byName);
      BackupReader.compare(manifest, byName);
      const dataEntry = byName.get(BackupEntries.DATA);
      if (!dataEntry) throw new BackupDamagedError('no data');
      const { head, pages } = await this.readData(zip, dataEntry, manifest, onProgress);
      return {
        kind: 'zip',
        zip,
        subjects: head.subjects,
        notebooks: finishNotebooks(head.notebooks, pages),
        pages,
        files: BackupReader.fileTable(head.blobs, byName),
      };
    } finally {
      this.pause.close();
    }
  }

  /** The whitelist and the limits on names and sizes, before anything is unpacked. */
  private static checkEntries(zip: ZipReader): Map<string, ZipEntry> {
    const byName = new Map<string, ZipEntry>();
    for (const entry of zip.entries) {
      if (!BackupEntries.isAllowed(entry.name)) throw new ZipFormatError('unknown entry');
      if (byName.has(entry.name)) throw new ZipFormatError('duplicate entry');
      if (entry.size > BackupReader.limitOf(entry.name)) throw new ZipFormatError('entry too large');
      byName.set(entry.name, entry);
    }
    return byName;
  }

  private static limitOf(name: string): number {
    if (name === BackupEntries.DATA) return MAX_BACKUP_DATA_BYTES;
    return name === BackupEntries.MANIFEST ? MAX_BACKUP_MANIFEST_BYTES : MAX_BACKUP_ENTRY_BYTES;
  }

  private async readManifest(zip: ZipReader, byName: Map<string, ZipEntry>): Promise<BackupManifest> {
    const entry = byName.get(BackupEntries.MANIFEST);
    if (!entry) throw new ValidationError('manifest', 'missing');
    let raw: unknown;
    try {
      raw = JSON.parse(new TextDecoder().decode(await zip.bytes(entry)));
    } catch (error) {
      if (error instanceof ZipFormatError) throw error;
      throw new ValidationError('manifest', 'not JSON');
    }
    return parseManifest(raw);
  }

  /** The archive must hold exactly what the manifest lists, in the sizes it lists. */
  private static compare(manifest: BackupManifest, byName: Map<string, ZipEntry>): void {
    if (manifest.entries.length !== byName.size - 1) throw new BackupDamagedError('entries differ');
    for (const listed of manifest.entries) {
      const entry = byName.get(listed.name);
      if (!entry || entry.size !== listed.size) throw new BackupDamagedError('entries differ');
      const file = BackupEntries.parsePath(listed.name);
      if (file && file.sha !== listed.sha256) throw new BackupDamagedError('hash differs from the name');
    }
  }

  private async readData(
    zip: ZipReader,
    entry: ZipEntry,
    manifest: BackupManifest,
    onProgress: BackupProgress,
  ): Promise<{ head: DataHead; pages: Page[] }> {
    const hash = new Sha256();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const lines = new BackupDataLines();
    let done = 0;
    try {
      for await (const piece of zip.read(entry)) {
        hash.update(piece);
        lines.add(decoder.decode(piece, { stream: true }));
        done += piece.length;
        onProgress(done / Math.max(1, entry.size));
        await this.pause.pause();
      }
      lines.add(decoder.decode());
    } catch (error) {
      if (error instanceof TypeError) throw new BackupDamagedError('not UTF-8');
      throw error;
    }
    const listed = manifest.entries.find((e) => e.name === BackupEntries.DATA);
    if (hash.hex() !== listed?.sha256) throw new BackupDamagedError('hash differs');
    return lines.finish();
  }

  /** Which ids each file serves. Every file must serve one, and every id must have a file. */
  private static fileTable(
    table: readonly BlobTableRow[],
    byName: Map<string, ZipEntry>,
  ): ZipBackup['files'] {
    assertUniqueIds(table, 'blobs');
    const files = new Map<string, ZipBackup['files'][number]>();
    for (const row of table) {
      const path = BackupEntries.path(row.file);
      const entry = byName.get(path);
      const parsed = BackupEntries.parsePath(path);
      if (!entry || !parsed) throw new BackupDamagedError('a file is missing');
      const known = files.get(path);
      if (known) known.ids.push(row.id);
      else files.set(path, { entry, sha: parsed.sha, ids: [row.id] });
    }
    if (files.size !== byName.size - 2) throw new BackupDamagedError('a file is not used');
    return [...files.values()];
  }
}
