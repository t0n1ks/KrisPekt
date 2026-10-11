import { ALLOWED_IMAGE_TYPES, BACKUP_APP, BACKUP_APP_LEGACY, MAX_BLOB_BYTES } from '../../core/constants';
import type { Notebook, Page, Subject } from '../../core/types';
import { base64DecodedLength } from '../../core/utils/files';
import { ValidationError, asArray, asId, asOneOf, asRecord, asString, optionalArray } from './guards';
import { parseNotebook, parsePage, parseSubject } from './records';

export type AllowedImageType = (typeof ALLOWED_IMAGE_TYPES)[number];

/** A blob as it appears in a backup file: base64 data plus its MIME type. */
export interface BackupBlob {
  id: string;
  type: AllowedImageType;
  data: string;
}

/** A fully validated backup. Nothing outside these fields survives parsing. */
export interface BackupDocument {
  subjects: Subject[];
  notebooks: Notebook[];
  pages: Page[];
  blobs: BackupBlob[];
}

const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;
/** Base64 length of the largest allowed blob, with slack for padding. */
const MAX_BASE64_LENGTH = Math.ceil(MAX_BLOB_BYTES / 3) * 4 + 4;

function parseBackupBlob(raw: unknown, path: string): BackupBlob {
  const o = asRecord(raw, path);
  const data = asString(o.data, `${path}.data`, MAX_BASE64_LENGTH);
  if (data.length % 4 !== 0 || !BASE64_PATTERN.test(data))
    throw new ValidationError(`${path}.data`, 'invalid base64');
  if (base64DecodedLength(data) > MAX_BLOB_BYTES) throw new ValidationError(`${path}.data`, 'blob too large');
  return {
    id: asId(o.id, `${path}.id`),
    type: asOneOf(o.type, ALLOWED_IMAGE_TYPES, `${path}.type`),
    data,
  };
}

function assertUniqueIds(items: readonly { id: string }[], path: string): void {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) throw new ValidationError(path, 'duplicate id ' + item.id);
    seen.add(item.id);
  }
}

/**
 * Validates a parsed backup JSON value. Accepts files written by KrisPekt (`app: 'krispekt'`)
 * and by its predecessor (`app: 'konspektnik'`). Throws ValidationError on any mismatch,
 * so a file is either imported whole or not at all.
 */
export function parseBackup(raw: unknown): BackupDocument {
  const o = asRecord(raw, 'backup');
  asOneOf(o.app, [BACKUP_APP, BACKUP_APP_LEGACY] as const, 'backup.app');
  const doc: BackupDocument = {
    subjects: asArray(o.subjects, 'subjects').map((v, i) => parseSubject(v, `subjects[${i}]`)),
    notebooks: asArray(o.notebooks, 'notebooks').map((v, i) => parseNotebook(v, `notebooks[${i}]`)),
    pages: optionalArray(o.pages, 'pages').map((v, i) => parsePage(v, `pages[${i}]`)),
    blobs: optionalArray(o.blobs, 'blobs').map((v, i) => parseBackupBlob(v, `blobs[${i}]`)),
  };
  assertUniqueIds(doc.subjects, 'subjects');
  assertUniqueIds(doc.notebooks, 'notebooks');
  assertUniqueIds(doc.pages, 'pages');
  assertUniqueIds(doc.blobs, 'blobs');
  return doc;
}
