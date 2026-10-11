import type { ImageItem, Notebook, NotebookView, Page, Stroke, Subject, TextItem } from '../../core/types';
import {
  LIMITS,
  MAX_LEN,
  MAX_STROKE_POINTS,
  ValidationError,
  asArray,
  asBackground,
  asBoolean,
  asColor,
  asId,
  asNumber,
  asOneOf,
  asRecord,
  asString,
  optionalArray,
} from './guards';

/*
 * Parsers for every stored record type. Each one accepts `unknown`, checks the whole
 * structure, copies only known fields into a fresh object and throws ValidationError on
 * any mismatch. They are used both for backup files and for records read from IndexedDB,
 * because stored data may come from an older version or be tampered with.
 */

export function parseSubject(raw: unknown, path = 'subject'): Subject {
  const o = asRecord(raw, path);
  return {
    id: asId(o.id, `${path}.id`),
    name: asString(o.name, `${path}.name`, MAX_LEN.name),
    color: asColor(o.color, `${path}.color`),
    order: asNumber(o.order, `${path}.order`, LIMITS.order),
    createdAt: asNumber(o.createdAt, `${path}.createdAt`, LIMITS.timestamp),
  };
}

function parseView(raw: unknown, path: string): NotebookView | null {
  if (raw == null) return null;
  const o = asRecord(raw, path);
  return {
    pageId: o.pageId == null ? null : asId(o.pageId, `${path}.pageId`),
    z: asNumber(o.z, `${path}.z`, LIMITS.zoom),
  };
}

export function parseNotebook(raw: unknown, path = 'notebook'): Notebook {
  const o = asRecord(raw, path);
  const base = asRecord(o.base, `${path}.base`);
  const notebook: Notebook = {
    id: asId(o.id, `${path}.id`),
    subjectId: asId(o.subjectId, `${path}.subjectId`),
    title: asString(o.title, `${path}.title`, MAX_LEN.name),
    color: asColor(o.color, `${path}.color`),
    base: {
      w: asNumber(base.w, `${path}.base.w`, LIMITS.pageMm),
      h: asNumber(base.h, `${path}.base.h`, LIMITS.pageMm),
    },
    bg: asBackground(o.bg, `${path}.bg`),
    pageIds: optionalArray(o.pageIds, `${path}.pageIds`).map((id, i) => asId(id, `${path}.pageIds[${i}]`)),
    createdAt: asNumber(o.createdAt, `${path}.createdAt`, LIMITS.timestamp),
    updatedAt: asNumber(o.updatedAt, `${path}.updatedAt`, LIMITS.timestamp),
    view: parseView(o.view, `${path}.view`),
  };
  if (o.sample !== undefined) notebook.sample = asBoolean(o.sample, `${path}.sample`);
  return notebook;
}

/** Accepts a Float32Array (IndexedDB) or a plain number array (backup JSON). */
function parsePoints(raw: unknown, path: string): Float32Array {
  const values: ArrayLike<unknown> =
    raw instanceof Float32Array ? raw : asArray(raw, path, MAX_STROKE_POINTS * 3);
  if (values.length === 0 || values.length % 3 !== 0) throw new ValidationError(path, 'bad point count');
  if (values.length > MAX_STROKE_POINTS * 3) throw new ValidationError(path, 'too many points');
  const out = new Float32Array(values.length);
  for (let i = 0; i < values.length; i++) {
    const range = i % 3 === 2 ? LIMITS.pressure : LIMITS.coord;
    out[i] = asNumber(values[i], `${path}[${i}]`, range);
  }
  return out;
}

export function parseStroke(raw: unknown, path = 'stroke'): Stroke {
  const o = asRecord(raw, path);
  return {
    id: asId(o.id, `${path}.id`),
    k: asOneOf(o.k, ['pen', 'hl'] as const, `${path}.k`),
    c: asColor(o.c, `${path}.c`),
    s: asNumber(o.s, `${path}.s`, LIMITS.strokeWidth),
    p: parsePoints(o.p, `${path}.p`),
  };
}

export function parseText(raw: unknown, path = 'text'): TextItem {
  const o = asRecord(raw, path);
  return {
    id: asId(o.id, `${path}.id`),
    x: asNumber(o.x, `${path}.x`, LIMITS.coord),
    y: asNumber(o.y, `${path}.y`, LIMITS.coord),
    w: asNumber(o.w, `${path}.w`, LIMITS.extent),
    t: asString(o.t, `${path}.t`, MAX_LEN.text),
    fs: asNumber(o.fs, `${path}.fs`, LIMITS.fontSize),
    c: asColor(o.c, `${path}.c`),
  };
}

export function parseImage(raw: unknown, path = 'image'): ImageItem {
  const o = asRecord(raw, path);
  return {
    id: asId(o.id, `${path}.id`),
    x: asNumber(o.x, `${path}.x`, LIMITS.coord),
    y: asNumber(o.y, `${path}.y`, LIMITS.coord),
    w: asNumber(o.w, `${path}.w`, LIMITS.extent),
    h: asNumber(o.h, `${path}.h`, LIMITS.extent),
    blob: asId(o.blob, `${path}.blob`),
  };
}

export function parsePage(raw: unknown, path = 'page'): Page {
  const o = asRecord(raw, path);
  const list = <T>(key: string, parse: (v: unknown, p: string) => T): T[] =>
    optionalArray(o[key], `${path}.${key}`).map((v, i) => parse(v, `${path}.${key}[${i}]`));
  return {
    id: asId(o.id, `${path}.id`),
    nbId: asId(o.nbId, `${path}.nbId`),
    w: asNumber(o.w, `${path}.w`, LIMITS.pageMm),
    h: asNumber(o.h, `${path}.h`, LIMITS.pageMm),
    locked: o.locked === undefined ? false : asBoolean(o.locked, `${path}.locked`),
    bg: asBackground(o.bg, `${path}.bg`),
    bgBlob: o.bgBlob == null ? null : asId(o.bgBlob, `${path}.bgBlob`),
    strokes: list('strokes', parseStroke),
    texts: list('texts', parseText),
    images: list('images', parseImage),
    updatedAt: o.updatedAt === undefined ? 0 : asNumber(o.updatedAt, `${path}.updatedAt`, LIMITS.timestamp),
  };
}
