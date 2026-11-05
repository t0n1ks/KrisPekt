import { BRUSH_KINDS } from '../../core/constants';
import type {
  ImageItem,
  Notebook,
  NotebookView,
  Page,
  Stroke,
  Subject,
  TextItem,
  TextParagraph,
  TextSpan,
} from '../../core/types';
import { RichText } from '../../domain/RichText';
import {
  LIMITS,
  MAX_LEN,
  MAX_STROKE_POINTS,
  MAX_TEXT_RUNS,
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
  if (o.order !== undefined) notebook.order = asNumber(o.order, `${path}.order`, LIMITS.order);
  if (o.zoomLock !== undefined)
    notebook.zoomLock = asNumber(o.zoomLock, `${path}.zoomLock`, LIMITS.lockedZoom);
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

/** Strokes without `b` are ballpoint pens; only pen strokes may name a brush. */
export function parseStroke(raw: unknown, path = 'stroke'): Stroke {
  const o = asRecord(raw, path);
  const stroke: Stroke = {
    id: asId(o.id, `${path}.id`),
    k: asOneOf(o.k, ['pen', 'hl'] as const, `${path}.k`),
    c: asColor(o.c, `${path}.c`),
    s: asNumber(o.s, `${path}.s`, LIMITS.strokeWidth),
    p: parsePoints(o.p, `${path}.p`),
  };
  if (o.b !== undefined) {
    if (stroke.k !== 'pen') throw new ValidationError(`${path}.b`, 'only pen strokes have a brush');
    stroke.b = asOneOf(o.b, BRUSH_KINDS, `${path}.b`);
  }
  return stroke;
}

/** Style flags are stored only when on. */
function parseFlag(value: unknown, path: string): true {
  if (value !== true) throw new ValidationError(path, 'expected true');
  return true;
}

function parseRun(raw: unknown, path: string): TextSpan {
  const o = asRecord(raw, path);
  const t = asString(o.t, `${path}.t`, MAX_LEN.text);
  if (t.includes('\n')) throw new ValidationError(`${path}.t`, 'a line break inside a run');
  const run: TextSpan = { t };
  if (o.fs !== undefined) run.fs = asNumber(o.fs, `${path}.fs`, LIMITS.fontSize);
  if (o.c !== undefined) run.c = asColor(o.c, `${path}.c`);
  for (const key of ['b', 'i', 'u', 's'] as const) {
    if (o[key] !== undefined) run[key] = parseFlag(o[key], `${path}.${key}`);
  }
  return run;
}

function parseParagraph(raw: unknown, path: string, budget: { runs: number }): TextParagraph {
  const o = asRecord(raw, path);
  const rawRuns = asArray(o.runs, `${path}.runs`, MAX_TEXT_RUNS);
  budget.runs -= rawRuns.length;
  if (rawRuns.length === 0 || budget.runs < 0) throw new ValidationError(`${path}.runs`, 'bad run count');
  const para: TextParagraph = { runs: rawRuns.map((run, i) => parseRun(run, `${path}.runs[${i}]`)) };
  if (o.align !== undefined) para.align = asOneOf(o.align, ['center', 'right'] as const, `${path}.align`);
  if (o.list !== undefined) para.list = asOneOf(o.list, ['bullet', 'number'] as const, `${path}.list`);
  return para;
}

/**
 * Items without `paras` are text from before rich text. With them, `t` follows from the runs:
 * a stored `t` that disagrees could otherwise show one text and search or export another.
 */
export function parseText(raw: unknown, path = 'text'): TextItem {
  const o = asRecord(raw, path);
  const item: TextItem = {
    id: asId(o.id, `${path}.id`),
    x: asNumber(o.x, `${path}.x`, LIMITS.coord),
    y: asNumber(o.y, `${path}.y`, LIMITS.coord),
    w: asNumber(o.w, `${path}.w`, LIMITS.extent),
    t: asString(o.t, `${path}.t`, MAX_LEN.text),
    fs: asNumber(o.fs, `${path}.fs`, LIMITS.fontSize),
    c: asColor(o.c, `${path}.c`),
  };
  if (o.auto !== undefined) item.auto = parseFlag(o.auto, `${path}.auto`);
  if (o.paras === undefined) return item;
  const rawParas = asArray(o.paras, `${path}.paras`, MAX_LEN.text + 1);
  if (rawParas.length === 0) throw new ValidationError(`${path}.paras`, 'no paragraphs');
  const budget = { runs: MAX_TEXT_RUNS };
  item.paras = rawParas.map((para, i) => parseParagraph(para, `${path}.paras[${i}]`, budget));
  item.t = RichText.plainText(item.paras);
  if (item.t.length > MAX_LEN.text) throw new ValidationError(`${path}.paras`, 'text too long');
  return item;
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
