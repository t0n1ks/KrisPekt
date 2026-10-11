import { ALLOWED_IMAGE_TYPES, BACKUP_APP, MAX_BACKUP_BYTES } from '../core/constants';
import type { BlobRecord, Page } from '../core/types';
import { base64ToBlob, blobToBase64 } from '../core/utils/files';
import type { BlobRepository } from './BlobRepository';
import type { Database } from './Database';
import type { NotebookRepository } from './NotebookRepository';
import type { PageRepository } from './PageRepository';
import type { SubjectRepository } from './SubjectRepository';
import {
  parseBackup,
  type AllowedImageType,
  type BackupBlob,
  type BackupDocument,
} from './validation/backup';

/** Why a backup file was refused. */
export type BackupErrorReason = 'too-large' | 'invalid';

export class BackupError extends Error {
  constructor(
    readonly reason: BackupErrorReason,
    cause?: unknown,
  ) {
    super('Backup rejected: ' + reason, { cause });
    this.name = 'BackupError';
  }
}

/**
 * Converts a stored blob whose type a backup may not contain (for example a GIF inserted by
 * an older version) into an allowed one. Returns null to leave the blob out.
 */
export type BlobNormalizer = (blob: Blob) => Promise<Blob | null>;

export interface BackupRepositories {
  subjects: SubjectRepository;
  notebooks: NotebookRepository;
  pages: PageRepository;
  blobs: BlobRepository;
}

function isAllowedType(type: string): type is AllowedImageType {
  return (ALLOWED_IMAGE_TYPES as readonly string[]).includes(type);
}

/** Strokes become plain arrays rounded to 2 decimals, which keeps backups compact. */
function pageToJson(page: Page): unknown {
  return {
    ...page,
    strokes: page.strokes.map((s) => ({ ...s, p: Array.from(s.p, (v) => Math.round(v * 100) / 100) })),
  };
}

/** Creates and restores JSON backups of the whole shelf. */
export class BackupService {
  constructor(
    private readonly db: Database,
    private readonly repos: BackupRepositories,
    private readonly normalizeBlob: BlobNormalizer,
  ) {}

  /** Collects every valid record into a backup file (`app: 'krispekt'`, version 1). */
  async createBackup(): Promise<Blob> {
    const [subjects, notebooks, pages, blobRecords] = await Promise.all([
      this.repos.subjects.all(),
      this.repos.notebooks.all(),
      this.repos.pages.all(),
      this.repos.blobs.all(),
    ]);
    const blobs: BackupBlob[] = [];
    for (const record of blobRecords) {
      const entry = await this.encodeBlob(record);
      if (entry) blobs.push(entry);
    }
    const json = JSON.stringify({
      app: BACKUP_APP,
      version: 1,
      exportedAt: new Date().toISOString(),
      subjects,
      notebooks,
      pages: pages.map(pageToJson),
      blobs,
    });
    return new Blob([json], { type: 'application/json' });
  }

  private async encodeBlob(record: BlobRecord): Promise<BackupBlob | null> {
    const blob = isAllowedType(record.blob.type) ? record.blob : await this.normalizeBlob(record.blob);
    if (!blob || !isAllowedType(blob.type)) return null;
    return { id: record.id, type: blob.type, data: await blobToBase64(blob) };
  }

  /**
   * Reads and fully validates a backup file. Throws {@link BackupError} if the file is
   * larger than 300 MB, is not JSON, or does not match the backup format exactly.
   */
  async readFile(file: Blob): Promise<BackupDocument> {
    if (file.size > MAX_BACKUP_BYTES) throw new BackupError('too-large');
    let raw: unknown;
    try {
      raw = JSON.parse(await file.text());
    } catch (error) {
      throw new BackupError('invalid', error);
    }
    return BackupService.parse(raw);
  }

  /** Validates an already-parsed JSON value. */
  static parse(raw: unknown): BackupDocument {
    try {
      return parseBackup(raw);
    } catch (error) {
      throw new BackupError('invalid', error);
    }
  }

  /**
   * Writes a validated backup in a single transaction. Records with the same id are
   * replaced by the backup version; everything else on the shelf stays.
   */
  async restore(doc: BackupDocument): Promise<void> {
    const blobs = doc.blobs.map((b) => ({ id: b.id, blob: base64ToBlob(b.data, b.type) }));
    await this.db.writeAcross([
      { store: 'blobs', values: blobs },
      { store: 'pages', values: doc.pages },
      { store: 'notebooks', values: doc.notebooks },
      { store: 'subjects', values: doc.subjects },
    ]);
  }
}
