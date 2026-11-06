import { ALLOWED_IMAGE_TYPES } from '../core/constants';

/** What a backup may contain: images, and the PDF files attached to pages. */
export const BACKUP_FILE_TYPES = [...ALLOWED_IMAGE_TYPES, 'application/pdf'] as const;

export type BackupFileType = (typeof BACKUP_FILE_TYPES)[number];

const EXTENSIONS: Record<BackupFileType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

/** The only form a file's name may have: the digest of its content and a known extension. */
const FILE_NAME = /^([0-9a-f]{64})\.(jpg|png|webp|pdf)$/;

/** A file inside the archive, as its name describes it. */
export interface BackupFileName {
  sha: string;
  type: BackupFileType;
}

/** The names inside a format 2 backup. Pure. Anything these rules do not allow is rejected. */
export class BackupEntries {
  static readonly MANIFEST = 'manifest.json';
  static readonly DATA = 'data.json';
  private static readonly FOLDER = 'files/';

  /** A known file type, or null. */
  static typeOf(type: string | null): BackupFileType | null {
    return (BACKUP_FILE_TYPES as readonly string[]).includes(type ?? '') ? (type as BackupFileType) : null;
  }

  /** `<sha256>.<ext>`, as `data.json` names a file. */
  static fileName(sha: string, type: BackupFileType): string {
    return `${sha}.${EXTENSIONS[type]}`;
  }

  /** Where a file named so sits in the archive. */
  static path(fileName: string): string {
    return BackupEntries.FOLDER + fileName;
  }

  /** What a `<sha256>.<ext>` says about the file, or null if the name is not allowed. */
  static parseFileName(name: string): BackupFileName | null {
    const match = FILE_NAME.exec(name);
    if (!match) return null;
    const type = BACKUP_FILE_TYPES.find((t) => EXTENSIONS[t] === match[2]);
    return type && match[1] ? { sha: match[1], type } : null;
  }

  /** The file in a `files/<sha256>.<ext>` entry, or null if the path is anything else. */
  static parsePath(path: string): BackupFileName | null {
    if (!path.startsWith(BackupEntries.FOLDER)) return null;
    return BackupEntries.parseFileName(path.slice(BackupEntries.FOLDER.length));
  }

  /** Whether an archive may have an entry with this name: the whitelist stops path traversal. */
  static isAllowed(path: string): boolean {
    return path === BackupEntries.MANIFEST || path === BackupEntries.DATA || !!BackupEntries.parsePath(path);
  }
}
