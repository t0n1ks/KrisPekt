import {
  ALLOWED_IMAGE_TYPES,
  BACKUP_APP,
  BACKUP_APP_LEGACY,
  MAX_ATTACHMENT_PDF_BYTES,
  MAX_BLOB_BYTES,
} from '../../core/constants';
import type { Notebook, Page, Subject } from '../../core/types';
import { base64DecodedLength, sniffBytes } from '../../core/utils/files';
import { AnchorMarks } from '../../domain/AnchorMarks';
import { ValidationError, asArray, asId, asOneOf, asRecord, asString, optionalArray } from './guards';
import { parseNotebook, parsePage, parseSubject } from './records';

const PDF_TYPE = 'application/pdf';

/** What a backup may contain: images, and the PDF files attached to pages. */
export const BACKUP_BLOB_TYPES = [...ALLOWED_IMAGE_TYPES, PDF_TYPE] as const;

export type BackupBlobType = (typeof BACKUP_BLOB_TYPES)[number];

/** A blob as it appears in a backup file: base64 data plus its MIME type. */
export interface BackupBlob {
  id: string;
  type: BackupBlobType;
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

/** Base64 length of a blob of `bytes`, with slack for padding. */
function maxBase64Length(bytes: number): number {
  return Math.ceil(bytes / 3) * 4 + 4;
}

/** A PDF in a backup must really start like one; the declared type alone proves nothing. */
function assertPdfSignature(data: string, path: string): void {
  const head = Uint8Array.from(atob(data.slice(0, 8)), (c) => c.charCodeAt(0));
  if (sniffBytes(head) !== PDF_TYPE) throw new ValidationError(path, 'not a PDF');
}

function parseBackupBlob(raw: unknown, path: string): BackupBlob {
  const o = asRecord(raw, path);
  const type = asOneOf(o.type, BACKUP_BLOB_TYPES, `${path}.type`);
  const limit = type === PDF_TYPE ? MAX_ATTACHMENT_PDF_BYTES : MAX_BLOB_BYTES;
  const data = asString(o.data, `${path}.data`, maxBase64Length(limit));
  if (data.length % 4 !== 0 || !BASE64_PATTERN.test(data))
    throw new ValidationError(`${path}.data`, 'invalid base64');
  if (base64DecodedLength(data) > limit) throw new ValidationError(`${path}.data`, 'blob too large');
  if (type === PDF_TYPE) assertPdfSignature(data, `${path}.data`);
  return { id: asId(o.id, `${path}.id`), type, data };
}

function assertUniqueIds(items: readonly { id: string }[], path: string): void {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) throw new ValidationError(path, 'duplicate id ' + item.id);
    seen.add(item.id);
  }
}

/**
 * A notebook's list of anchors comes from its pages, whatever the file says: a list that disagrees
 * could otherwise make links look valid or broken when they are not.
 */
function withDerivedMarks(notebook: Notebook, pages: readonly Page[]): Notebook {
  const own = new Map(pages.filter((page) => page.nbId === notebook.id).map((page) => [page.id, page]));
  const ordered = notebook.pageIds.flatMap((id) => own.get(id) ?? []);
  const { marks: _untrusted, ...rest } = notebook;
  const marks = AnchorMarks.of(ordered);
  return marks.length ? { ...rest, marks } : rest;
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
  doc.notebooks = doc.notebooks.map((notebook) => withDerivedMarks(notebook, doc.pages));
  return doc;
}
