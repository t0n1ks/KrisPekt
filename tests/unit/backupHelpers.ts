import { zipSync, type Zippable } from 'fflate';
import type { Page, Stroke } from '../../src/core/types';
import { blobToBase64 } from '../../src/core/utils/files';
import { Sha256 } from '../../src/core/utils/Sha256';
import { BlobRepository } from '../../src/storage/BlobRepository';
import { BackupService } from '../../src/storage/BackupService';
import { Database } from '../../src/storage/Database';
import { NotebookRepository } from '../../src/storage/NotebookRepository';
import { PageRepository } from '../../src/storage/PageRepository';
import { RecordReader } from '../../src/storage/RecordReader';
import { SubjectRepository } from '../../src/storage/SubjectRepository';

/** An empty in-memory shelf with its backup service. */
export function shelf(options: ConstructorParameters<typeof BackupService>[3] = {}) {
  const db = Database.inMemory();
  const reader = new RecordReader(() => undefined);
  const repos = {
    subjects: new SubjectRepository(db, reader),
    notebooks: new NotebookRepository(db, reader),
    pages: new PageRepository(db, reader),
    blobs: new BlobRepository(db, reader),
  };
  const service = new BackupService(db, repos, () => Promise.resolve(null), options);
  return { db, repos, service };
}

/** The old backup format, as the app wrote it up to version 1: everything in one JSON string. */
export async function legacyBackup(repos: ReturnType<typeof shelf>['repos']): Promise<string> {
  const [subjects, notebooks, pages, records] = await Promise.all([
    repos.subjects.all(),
    repos.notebooks.all(),
    repos.pages.all(),
    repos.blobs.all(),
  ]);
  const blobs = [];
  for (const record of records) {
    blobs.push({ id: record.id, type: record.blob.type, data: await blobToBase64(record.blob) });
  }
  return JSON.stringify({
    app: 'krispekt',
    version: 1,
    exportedAt: new Date(0).toISOString(),
    subjects,
    notebooks,
    pages: pages.map((page) => ({
      ...page,
      strokes: page.strokes.map((s) => ({ ...s, p: Array.from(s.p, (v) => Math.round(v * 100) / 100) })),
    })),
    blobs,
  });
}

/** A number generator that gives the same sample on every run. */
export function randomFrom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

/**
 * One handwritten stroke: pen-down for about half a second at 120 Hz, curving like a letter, with the
 * sub-pixel jitter of a real stylus. Points closer than 0.35 px are dropped, as PenTool does.
 */
function handwrittenPoints(random: () => number, cx: number, cy: number): Float32Array {
  const jitter = (): number => (random() + random() + random() + random() - 2) / 1.4;
  const count = 12 + Math.floor(random() * 70);
  const [ax, ay, fx, fy, phase] = [
    4 + random() * 10,
    3 + random() * 9,
    2 + random() * 6,
    2 + random() * 6,
    random() * 6,
  ];
  const points: number[] = [];
  let pressure = 0.25 + random() * 0.2;
  let [lastX, lastY] = [-1e9, -1e9];
  for (let i = 0; i < count; i++) {
    const t = i / count;
    const x = cx + ax * Math.sin(fx * t + phase) + 14 * t + jitter() * 0.06;
    const y = cy + ay * Math.cos(fy * t) + jitter() * 0.06;
    pressure = Math.min(1, Math.max(0.05, pressure + (0.5 - pressure) * 0.05 + jitter() * 0.012));
    if ((x - lastX) ** 2 + (y - lastY) ** 2 < 0.35 ** 2) continue;
    lastX = x;
    lastY = y;
    points.push(x, y, pressure);
  }
  return Float32Array.from(points);
}

/** A page of handwriting. */
export function handwrittenPage(random: () => number, id: string, nbId: string, strokes: number): Page {
  const ink: Stroke[] = [];
  let x = 70;
  let y = 70;
  for (let i = 0; i < strokes; i++) {
    x += 4 + random() * 8;
    if (x > 720) {
      x = 70;
      y += 32;
    }
    ink.push({
      id: `s${id}x${i}`,
      k: 'pen',
      c: '#1E40AF',
      s: 2,
      b: 'ballpoint',
      p: handwrittenPoints(random, x, y),
    });
  }
  return {
    id,
    nbId,
    w: 210,
    h: 297,
    locked: true,
    bg: 'gridm',
    bgBlob: null,
    strokes: ink,
    texts: [{ id: `t${id}`, x: 75, y: 40, w: 600, t: 'Лекция ' + id, fs: 20, c: '#1E40AF' }],
    images: [],
    cards: [],
    anchors: [{ id: `a${id}`, name: 'Тема ' + id, items: [], rect: { x: 0, y: 0, w: 0, h: 0 } }],
    inkLinks: [],
    updatedAt: 1700000000000,
  };
}

/** Bytes as hard to compress as a real JPEG: a valid signature, then noise. */
export function fakeJpeg(bytes: number, random: () => number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(bytes);
  for (let i = 0; i < bytes; i++) out[i] = Math.floor(random() * 256);
  out.set([0xff, 0xd8, 0xff, 0xe0]);
  return out;
}

export function sha256(bytes: Uint8Array): string {
  return new Sha256().update(bytes).hex();
}

export interface ForgedBackup {
  data?: string;
  files?: Record<string, Uint8Array>;
  manifest?: (entries: { name: string; size: number; sha256: string }[]) => unknown;
  extra?: Zippable;
}

export const encode = (text: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(text);

export const EMPTY_DATA = '{"subjects":[],"notebooks":[],"blobs":[],"pages":[\n]}';

/** A format 2 backup put together by hand, for files the app would never write. */
export function forgeBackup(forged: ForgedBackup = {}): Blob {
  const data = encode(forged.data ?? EMPTY_DATA);
  const files = forged.files ?? {};
  const entries = [
    { name: 'data.json', size: data.length, sha256: sha256(data) },
    ...Object.entries(files).map(([name, bytes]) => ({ name, size: bytes.length, sha256: sha256(bytes) })),
  ];
  const manifest = forged.manifest?.(entries) ?? {
    app: 'krispekt',
    format: 2,
    createdAt: '2026-11-06T00:00:00.000Z',
    entries,
  };
  const zipped = zipSync({
    'manifest.json': encode(JSON.stringify(manifest)),
    'data.json': data,
    ...files,
    ...forged.extra,
  });
  return new Blob([zipped as Uint8Array<ArrayBuffer>], { type: 'application/zip' });
}
