import {
  ALLOWED_IMAGE_TYPES,
  BACKUP_APP,
  BACKUP_APP_LEGACY,
  BACKUP_FORMAT,
  MAX_ATTACHMENT_PDF_BYTES,
  MAX_BACKUP_ENTRIES,
  MAX_BLOB_BYTES,
} from '../../core/constants';
import type { Notebook, Page, Subject } from '../../core/types';
import { base64DecodedLength, sniffBytes } from '../../core/utils/files';
import { AnchorMarks } from '../../domain/AnchorMarks';
import { BackupEntries } from '../../domain/BackupEntries';
import { StrokeCodec } from '../../domain/StrokeCodec';
import {
  MAX_ITEMS,
  MAX_STROKE_POINTS,
  ValidationError,
  asArray,
  asId,
  asNumber,
  asOneOf,
  asRecord,
  asString,
  optionalArray,
} from './guards';
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

export function assertUniqueIds(items: readonly { id: string }[], path: string): void {
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
  const { marks: _untrusted, pageTitles: _alsoUntrusted, ...rest } = notebook;
  const marks = AnchorMarks.of(ordered);
  const pageTitles = AnchorMarks.titles(ordered);
  return {
    ...rest,
    ...(marks.length ? { marks } : {}),
    ...(pageTitles.length ? { pageTitles } : {}),
  };
}

/** Every notebook's list of anchors, as its pages have them. */
export function finishNotebooks(notebooks: readonly Notebook[], pages: readonly Page[]): Notebook[] {
  return notebooks.map((notebook) => withDerivedMarks(notebook, pages));
}

/** One row of the manifest's list of entries. */
export interface ManifestEntry {
  name: string;
  size: number;
  sha256: string;
}

/** The manifest of a ZIP backup. */
export interface BackupManifest {
  createdAt: string;
  entries: ManifestEntry[];
}

/** Written by a later version of the app: not a broken file, the app just has to be updated. */
export class NewerBackupError extends ValidationError {
  constructor(format: number) {
    super('manifest.format', String(format));
    this.name = 'NewerBackupError';
  }
}

/** Which file holds the content of a stored blob. */
export interface BlobTableRow {
  id: string;
  file: string;
}

/** The first line of `data.json`. */
export interface DataHead {
  subjects: Subject[];
  notebooks: Notebook[];
  blobs: BlobTableRow[];
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const ENTRY_SIZE_RANGE = [0, 2 ** 40] as const;

function parseManifestEntry(raw: unknown, path: string): ManifestEntry {
  const o = asRecord(raw, path);
  const name = asString(o.name, `${path}.name`, 100);
  if (!BackupEntries.isAllowed(name) || name === BackupEntries.MANIFEST) {
    throw new ValidationError(`${path}.name`, 'not allowed');
  }
  const sha256 = asString(o.sha256, `${path}.sha256`, 64);
  if (!SHA256_PATTERN.test(sha256)) throw new ValidationError(`${path}.sha256`, 'not a SHA-256');
  return { name, size: asNumber(o.size, `${path}.size`, ENTRY_SIZE_RANGE), sha256 };
}

/** Validates a manifest. */
export function parseManifest(raw: unknown): BackupManifest {
  const o = asRecord(raw, 'manifest');
  asOneOf(o.app, [BACKUP_APP] as const, 'manifest.app');
  if (typeof o.format === 'number' && o.format > BACKUP_FORMAT) throw new NewerBackupError(o.format);
  if (o.format !== BACKUP_FORMAT) throw new ValidationError('manifest.format', 'unknown');
  const entries = asArray(o.entries, 'manifest.entries', MAX_BACKUP_ENTRIES).map((v, i) =>
    parseManifestEntry(v, `manifest.entries[${i}]`),
  );
  return { createdAt: asString(o.createdAt, 'manifest.createdAt', 40), entries };
}

/** Validates the head of `data.json`. */
export function parseDataHead(raw: unknown): DataHead {
  const o = asRecord(raw, 'data');
  const head: DataHead = {
    subjects: asArray(o.subjects, 'subjects').map((v, i) => parseSubject(v, `subjects[${i}]`)),
    notebooks: asArray(o.notebooks, 'notebooks').map((v, i) => parseNotebook(v, `notebooks[${i}]`)),
    blobs: asArray(o.blobs, 'blobs', MAX_ITEMS).map((v, i) => {
      const row = asRecord(v, `blobs[${i}]`);
      const file = asString(row.file, `blobs[${i}].file`, 100);
      if (!BackupEntries.parseFileName(file)) throw new ValidationError(`blobs[${i}].file`, 'not allowed');
      return { id: asId(row.id, `blobs[${i}].id`), file };
    }),
  };
  assertUniqueIds(head.subjects, 'subjects');
  assertUniqueIds(head.notebooks, 'notebooks');
  return head;
}

/** Validates a page of `data.json`: its strokes unpacked, then the same checks as any other page. */
export function parseCompactPage(raw: unknown, path: string): Page {
  const o = asRecord(raw, path);
  const strokes = optionalArray(o.strokes, `${path}.strokes`).map((value, i) => {
    const stroke = asRecord(value, `${path}.strokes[${i}]`);
    const points = StrokeCodec.decode(asArray(stroke.d, `${path}.strokes[${i}].d`, MAX_STROKE_POINTS * 3));
    if (!points) throw new ValidationError(`${path}.strokes[${i}].d`, 'bad points');
    return { ...stroke, p: points };
  });
  return parsePage({ ...o, strokes }, path);
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
