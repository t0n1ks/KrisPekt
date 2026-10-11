import type { Notebook, Page, Subject } from '../../src/core/types';

export function subject(overrides: Partial<Subject> = {}): Subject {
  return {
    id: 'sub1',
    name: 'Математика',
    color: '#2F5DA8',
    order: 0,
    createdAt: 1700000000000,
    ...overrides,
  };
}

export function notebook(overrides: Partial<Notebook> = {}): Notebook {
  return {
    id: 'nb1',
    subjectId: 'sub1',
    title: 'Лекции',
    color: '#2F5DA8',
    base: { w: 210, h: 297 },
    bg: 'gridm',
    pageIds: ['pg1'],
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    view: null,
    ...overrides,
  };
}

export function page(overrides: Partial<Page> = {}): Page {
  return {
    id: 'pg1',
    nbId: 'nb1',
    w: 210,
    h: 297,
    locked: true,
    bg: 'gridm',
    bgBlob: null,
    strokes: [
      { id: 'st1', k: 'pen', c: '#1E40AF', s: 2, p: new Float32Array([10.123, 20.456, 0.5, 30, 40, 0.6]) },
    ],
    texts: [{ id: 'tx1', x: 75, y: 58, w: 600, t: 'y = x²', fs: 20, c: '#1E40AF' }],
    images: [],
    updatedAt: 1700000000000,
    ...overrides,
  };
}

/** A backup JSON object as the prototype writes it. */
export function backupJson(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const p = page();
  return {
    app: 'krispekt',
    version: 1,
    exportedAt: '2026-10-11T10:00:00.000Z',
    subjects: [subject()],
    notebooks: [notebook()],
    pages: [{ ...p, strokes: p.strokes.map((s) => ({ ...s, p: Array.from(s.p) })) }],
    blobs: [],
    ...overrides,
  };
}
