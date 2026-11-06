import { MAX_BACKUP_BYTES } from '../core/constants';
import type { Page } from '../core/types';
import { base64ToBlob, sha256Hex, sniffBytes } from '../core/utils/files';
import { uid } from '../core/utils/id';
import { Sha256 } from '../core/utils/Sha256';
import { UiYield } from '../core/utils/UiYield';
import { BackupEntries } from '../domain/BackupEntries';
import { BackupSize } from '../domain/BackupSize';
import { BackupDamagedError } from './backup/BackupDamagedError';
import { BackupReader, type ZipBackup } from './backup/BackupReader';
import {
  BackupWriter,
  type BackupOutput,
  type BackupProgress,
  type BackupWriterRepositories,
  type BlobNormalizer,
} from './backup/BackupWriter';
import { BackupTooLargeError } from './backup/ZipBuilder';
import { ZipFormatError } from './backup/ZipReader';
import type { Database } from './Database';
import { NewerBackupError, parseBackup, type BackupDocument } from './validation/backup';
import { ValidationError } from './validation/guards';

export type { BackupProgress, BlobNormalizer };

/**
 * Why a backup could not be used: `invalid` is not a backup at all, `damaged` is one that fails its
 * checks, `newer` was written by a later version of the app, `too-large` is over a limit.
 */
export type BackupErrorReason = 'too-large' | 'invalid' | 'damaged' | 'newer' | 'no-space';

export class BackupError extends Error {
  constructor(
    readonly reason: BackupErrorReason,
    cause?: unknown,
  ) {
    super('Backup rejected: ' + reason, { cause });
    this.name = 'BackupError';
  }
}

/** A backup that has been read and checked, of either format. */
export type ReadBackup = BackupDocument | ZipBackup;

export type BackupRepositories = BackupWriterRepositories;

export interface BackupServiceOptions {
  /** A name for a file whose id is already taken by a different file. */
  makeId?: () => string;
  /** Files are about to be written ahead of the pages that use them; see {@link BackupService.restore}. */
  onFilesWritten?: () => void;
  appVersion?: string;
}

/** The first bytes of a ZIP. */
const ZIP_HEAD = [0x50, 0x4b, 0x03, 0x04];

function isQuotaError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'QuotaExceededError';
}

/** Translates what a reader throws into the reason the user is told. */
function asBackupError(error: unknown): unknown {
  if (error instanceof BackupError) return error;
  if (error instanceof ZipFormatError || error instanceof BackupDamagedError) {
    return new BackupError('damaged', error);
  }
  if (error instanceof NewerBackupError) return new BackupError('newer', error);
  if (error instanceof ValidationError) return new BackupError('invalid', error);
  return error;
}

/** Creates and restores backups of the whole shelf. */
export class BackupService {
  private readonly makeId: () => string;

  constructor(
    private readonly db: Database,
    private readonly repos: BackupRepositories,
    private readonly normalizeBlob: BlobNormalizer,
    private readonly options: BackupServiceOptions = {},
  ) {
    this.makeId = options.makeId ?? uid;
  }

  /** Collects every valid record into a ZIP backup (format 2). */
  async createBackup(onProgress?: BackupProgress): Promise<BackupOutput> {
    try {
      const writer = new BackupWriter(this.repos, this.normalizeBlob, this.options.appVersion ?? '');
      return await writer.write(onProgress);
    } catch (error) {
      throw error instanceof BackupTooLargeError ? new BackupError('too-large', error) : error;
    }
  }

  /** About how large a backup would be now, without building it. */
  async estimateBytes(): Promise<number> {
    const [pages, blobs] = await Promise.all([this.repos.pages.all(), this.repos.blobs.all()]);
    return BackupSize.estimate(
      pages,
      blobs.map((record) => record.blob.size),
    );
  }

  /**
   * Reads and checks a backup file of either format, told apart by its first bytes and not its
   * name. Nothing is written. Throws {@link BackupError}.
   */
  async readFile(file: Blob, onProgress?: BackupProgress): Promise<ReadBackup> {
    const head = new Uint8Array(await file.slice(0, ZIP_HEAD.length).arrayBuffer());
    if (ZIP_HEAD.every((byte, i) => head[i] === byte)) {
      try {
        return await new BackupReader().read(file, onProgress);
      } catch (error) {
        throw asBackupError(error);
      }
    }
    return this.readJson(file);
  }

  /** An old backup. It is parsed as one string, so its old size limit stays. */
  private async readJson(file: Blob): Promise<BackupDocument> {
    if (file.size > MAX_BACKUP_BYTES) throw new BackupError('too-large');
    let raw: unknown;
    try {
      raw = JSON.parse(await file.text());
    } catch (error) {
      throw new BackupError('invalid', error);
    }
    return BackupService.parse(raw);
  }

  /** Validates an already-parsed JSON value of an old backup. */
  static parse(raw: unknown): BackupDocument {
    try {
      return parseBackup(raw);
    } catch (error) {
      throw new BackupError('invalid', error);
    }
  }

  /**
   * Restores a checked backup: records with the same id are replaced by the backup version, and
   * everything else on the shelf stays. Either all of it arrives or nothing changes.
   *
   * The pages, notebooks and subjects go in one transaction. Files are too many for that, so they
   * come first, one by one, and only under ids nothing else uses: nothing on the shelf can see them
   * until that transaction refers to them. If anything fails they are deleted again; if the app is
   * killed on the way, the next cleanup removes them as unused.
   */
  async restore(backup: ReadBackup, onProgress: BackupProgress = () => undefined): Promise<void> {
    if ('kind' in backup) return this.restoreZip(backup, onProgress);
    const blobs = backup.blobs.map((b) => ({ id: b.id, blob: base64ToBlob(b.data, b.type) }));
    await this.db.writeAcross([
      { store: 'blobs', values: blobs },
      { store: 'pages', values: backup.pages },
      { store: 'notebooks', values: backup.notebooks },
      { store: 'subjects', values: backup.subjects },
    ]);
  }

  private async restoreZip(backup: ZipBackup, onProgress: BackupProgress): Promise<void> {
    const written: string[] = [];
    const renamed = new Map<string, string>();
    const pause = new UiYield();
    this.options.onFilesWritten?.();
    try {
      const total = backup.files.reduce((sum, file) => sum + file.entry.size, 0) + 1;
      let done = 0;
      for (const file of backup.files) {
        await this.restoreFile(backup, file, written, renamed);
        done += file.entry.size;
        onProgress(done / total);
        await pause.pause();
      }
      await this.db.writeAcross([
        { store: 'pages', values: backup.pages.map((page) => BackupService.renamed(page, renamed)) },
        { store: 'notebooks', values: backup.notebooks },
        { store: 'subjects', values: backup.subjects },
      ]);
      onProgress(1);
    } catch (error) {
      await this.repos.blobs.deleteMany(written).catch(() => undefined);
      throw isQuotaError(error) ? new BackupError('no-space', error) : asBackupError(error);
    } finally {
      pause.close();
    }
  }

  /** Checks one file against its name and signature, and stores it under the ids it serves. */
  private async restoreFile(
    backup: ZipBackup,
    file: ZipBackup['files'][number],
    written: string[],
    renamed: Map<string, string>,
  ): Promise<void> {
    const bytes = await backup.zip.bytes(file.entry);
    const sha = (await sha256Hex(bytes)) ?? new Sha256().update(bytes).hex();
    if (sha !== file.sha) throw new BackupDamagedError('hash differs');
    const type = BackupEntries.parsePath(file.entry.name)?.type;
    if (!type || sniffBytes(bytes.subarray(0, 16)) !== type) throw new BackupDamagedError('bad signature');
    const blob = new Blob([bytes], { type });
    for (const id of file.ids) {
      const existing = await this.repos.blobs.get(id);
      if (existing && (await BackupService.sameContent(existing, bytes.length, sha))) continue;
      const target = existing ? this.makeId() : id;
      if (existing) renamed.set(id, target);
      written.push(target);
      await this.repos.blobs.save(target, blob);
    }
  }

  private static async sameContent(blob: Blob, size: number, sha: string): Promise<boolean> {
    if (blob.size !== size) return false;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return ((await sha256Hex(bytes)) ?? new Sha256().update(bytes).hex()) === sha;
  }

  /** The page as it refers to the files that had to take another id. */
  private static renamed(page: Page, ids: ReadonlyMap<string, string>): Page {
    if (!ids.size) return page;
    const id = (value: string): string => ids.get(value) ?? value;
    return {
      ...page,
      bgBlob: page.bgBlob === null ? null : id(page.bgBlob),
      images: page.images.map((image) => ({ ...image, blob: id(image.blob) })),
      cards: page.cards.map((card) =>
        card.kind === 'pdf'
          ? { ...card, blob: id(card.blob), thumb: card.thumb === null ? null : id(card.thumb) }
          : card,
      ),
    };
  }
}
