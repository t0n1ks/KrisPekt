import type { Notebook, Page, Subject } from '../core/types';
import { CardRules } from './CardRules';

/** A stored file's size and type: all that is needed of it, so no bytes are read. */
export interface BlobFacts {
  id: string;
  size: number;
  type: string;
}

export interface BreakdownInput {
  subjects: readonly Subject[];
  /** Including those in the Trash. */
  notebooks: readonly Notebook[];
  pages: readonly Page[];
  blobs: readonly BlobFacts[];
}

/** Bytes by what they hold, as stored on the device. */
export interface SizeSplit {
  handwriting: number;
  /** Text boxes, anchors, links and other page data. */
  text: number;
  photos: number;
  /** Attached PDFs, their thumbnails, and PDF pages used as backgrounds. */
  pdfs: number;
}

/** Bytes of the same pages and files as an old JSON backup would hold them. */
export interface JsonBackupParts {
  strokes: number;
  text: number;
  links: number;
  photos: number;
  pdfFiles: number;
  pdfPages: number;
  /** What base64 adds to the files above. */
  base64: number;
  total: number;
}

export interface NotebookUsage extends SizeSplit {
  notebook: Notebook;
  total: number;
}

export interface SubjectUsage {
  /** Null for notebooks whose subject is gone. */
  subject: Subject | null;
  total: number;
  notebooks: NotebookUsage[];
}

export type FileKind = 'photo' | 'pdf' | 'pdfPage';

export interface FileUsage {
  id: string;
  kind: FileKind;
  /** The attached file's name; empty for photos and page backgrounds, which have none. */
  name: string;
  type: string;
  bytes: number;
  notebook: Notebook;
}

export interface StorageReport {
  overall: SizeSplit;
  total: number;
  /** Bytes that would be freed by emptying the Trash. */
  trash: number;
  subjects: SubjectUsage[];
  trashedNotebooks: NotebookUsage[];
  /** Largest first. */
  largest: FileUsage[];
  /** Stored files no page refers to; the next cleanup removes them. */
  unused: number;
  /** About how much re-encoding the JPEG photos already stored would save. Nothing does that. */
  photoSavings: number;
  jsonBackup: JsonBackupParts;
}

/** How many of the largest files a report lists. */
const LARGEST_COUNT = 10;
/** The stored form of a stroke point: three 32-bit floats. */
const BYTES_PER_POINT = 12;
/** A stroke's id, colour and other fields. */
const BYTES_PER_STROKE = 60;
/** A stroke coordinate in an old backup: up to 2 decimals and a comma; a pressure is shorter. */
const JSON_BYTES_PER_POINT = 19;
const JSON_BYTES_PER_STROKE = 80;
const BASE64_GROWTH = 1 / 3;
/**
 * New photos are WebP. A generated photo-like image took 48 % less at the new quality than the JPEG
 * the app used to store. Real photos have more fine detail, so this figure is deliberately lower.
 */
const WEBP_SAVING = 0.3;

function jsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

function emptySplit(): SizeSplit {
  return { handwriting: 0, text: 0, photos: 0, pdfs: 0 };
}

function totalOf(split: SizeSplit): number {
  return split.handwriting + split.text + split.photos + split.pdfs;
}

/**
 * Works out what storage holds, from sizes alone. Pure. Files can be shared between notebooks, or
 * listed several times on one page: each counts once, for the first notebook using it, with
 * notebooks on the shelf first, so that "Trash" means what emptying it would actually free.
 */
export class StorageBreakdown {
  /** The whole report. */
  static measure(input: BreakdownInput): StorageReport {
    const blobs = new Map(input.blobs.map((blob) => [blob.id, blob]));
    const usage = new Map<string, NotebookUsage>();
    const files: FileUsage[] = [];
    const counted = new Set<string>();
    const shelfFirst = [...input.notebooks].sort(
      (a, b) => Number(a.deletedAt !== undefined) - Number(b.deletedAt !== undefined),
    );
    const pagesOf = StorageBreakdown.byNotebook(input.pages);
    const json = StorageBreakdown.emptyJsonParts();
    for (const notebook of shelfFirst) {
      const row: NotebookUsage = { notebook, total: 0, ...emptySplit() };
      usage.set(notebook.id, row);
      for (const page of pagesOf.get(notebook.id) ?? []) {
        StorageBreakdown.addPageData(row, json, page);
        for (const file of StorageBreakdown.filesOf(page)) {
          const blob = blobs.get(file.id);
          if (!blob || counted.has(file.id)) continue;
          counted.add(file.id);
          row[file.kind === 'photo' ? 'photos' : 'pdfs'] += blob.size;
          files.push({ ...file, type: blob.type, bytes: blob.size, notebook });
        }
      }
      row.total = totalOf(row);
    }
    return StorageBreakdown.assemble(input, usage, files, json, counted);
  }

  private static byNotebook(pages: readonly Page[]): Map<string, Page[]> {
    const grouped = new Map<string, Page[]>();
    for (const page of pages) {
      const list = grouped.get(page.nbId);
      if (list) list.push(page);
      else grouped.set(page.nbId, [page]);
    }
    return grouped;
  }

  private static emptyJsonParts(): JsonBackupParts {
    return { strokes: 0, text: 0, links: 0, photos: 0, pdfFiles: 0, pdfPages: 0, base64: 0, total: 0 };
  }

  private static addPageData(row: NotebookUsage, json: JsonBackupParts, page: Page): void {
    const { strokes, texts, images, cards, anchors, inkLinks, ...rest } = page;
    for (const stroke of strokes) {
      const points = stroke.p.length / 3;
      row.handwriting += points * BYTES_PER_POINT + BYTES_PER_STROKE;
      json.strokes += points * JSON_BYTES_PER_POINT + JSON_BYTES_PER_STROKE;
    }
    const text = jsonBytes(texts) + jsonBytes(images) + jsonBytes(cards) + jsonBytes(rest);
    const links = jsonBytes(anchors) + jsonBytes(inkLinks);
    row.text += text + links;
    json.text += text;
    json.links += links;
  }

  /** The files a page uses, with what each one is to it. */
  private static filesOf(page: Page): Omit<FileUsage, 'type' | 'bytes' | 'notebook'>[] {
    const files: Omit<FileUsage, 'type' | 'bytes' | 'notebook'>[] = [];
    if (page.bgBlob) files.push({ id: page.bgBlob, kind: 'pdfPage', name: '' });
    for (const image of page.images) files.push({ id: image.blob, kind: 'photo', name: '' });
    for (const card of page.cards) {
      for (const id of CardRules.blobIds(card)) {
        files.push({ id, kind: 'pdf', name: card.kind === 'pdf' && id === card.blob ? card.name : '' });
      }
    }
    return files;
  }

  private static assemble(
    input: BreakdownInput,
    usage: ReadonlyMap<string, NotebookUsage>,
    files: readonly FileUsage[],
    json: JsonBackupParts,
    counted: ReadonlySet<string>,
  ): StorageReport {
    const overall = emptySplit();
    let trash = 0;
    for (const row of usage.values()) {
      overall.handwriting += row.handwriting;
      overall.text += row.text;
      overall.photos += row.photos;
      overall.pdfs += row.pdfs;
      if (row.notebook.deletedAt !== undefined) trash += row.total;
    }
    const photos = files.filter((file) => file.kind === 'photo');
    const pdfs = files.filter((file) => file.kind === 'pdf');
    const pdfPages = files.filter((file) => file.kind === 'pdfPage');
    const sum = (list: readonly FileUsage[]): number => list.reduce((all, file) => all + file.bytes, 0);
    json.photos = sum(photos);
    json.pdfFiles = sum(pdfs);
    json.pdfPages = sum(pdfPages);
    json.base64 = (json.photos + json.pdfFiles + json.pdfPages) * BASE64_GROWTH;
    json.total =
      json.strokes + json.text + json.links + json.photos + json.pdfFiles + json.pdfPages + json.base64;
    return {
      overall,
      total: totalOf(overall),
      trash,
      subjects: StorageBreakdown.bySubject(input.subjects, usage),
      trashedNotebooks: [...usage.values()].filter((row) => row.notebook.deletedAt !== undefined),
      largest: [...files].sort((a, b) => b.bytes - a.bytes).slice(0, LARGEST_COUNT),
      unused: input.blobs.reduce((all, blob) => all + (counted.has(blob.id) ? 0 : blob.size), 0),
      photoSavings: Math.round(sum(photos.filter((file) => file.type === 'image/jpeg')) * WEBP_SAVING),
      jsonBackup: json,
    };
  }

  /** Subjects on the shelf and their notebooks there, largest first; the Trash is its own figure. */
  private static bySubject(
    subjects: readonly Subject[],
    usage: ReadonlyMap<string, NotebookUsage>,
  ): SubjectUsage[] {
    const rows = [...usage.values()].filter((row) => row.notebook.deletedAt === undefined);
    return subjects
      .filter((subject) => subject.deletedAt === undefined)
      .map((subject) => {
        const notebooks = rows
          .filter((row) => row.notebook.subjectId === subject.id)
          .sort((a, b) => b.total - a.total);
        return { subject, notebooks, total: notebooks.reduce((all, row) => all + row.total, 0) };
      })
      .sort((a, b) => b.total - a.total);
  }
}
