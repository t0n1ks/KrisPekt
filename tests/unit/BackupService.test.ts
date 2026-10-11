import { beforeEach, describe, expect, it } from 'vitest';
import { BRUSH_KINDS } from '../../src/core/constants';
import { BlobRepository } from '../../src/storage/BlobRepository';
import { BackupError, BackupService } from '../../src/storage/BackupService';
import { Database } from '../../src/storage/Database';
import { NotebookRepository } from '../../src/storage/NotebookRepository';
import { PageRepository } from '../../src/storage/PageRepository';
import { RecordReader } from '../../src/storage/RecordReader';
import { SubjectRepository } from '../../src/storage/SubjectRepository';
import { backupJson, notebook, page, subject } from './fixtures';

const PNG_1PX =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function setup() {
  const db = Database.inMemory();
  const reader = new RecordReader(() => undefined);
  const repos = {
    subjects: new SubjectRepository(db, reader),
    notebooks: new NotebookRepository(db, reader),
    pages: new PageRepository(db, reader),
    blobs: new BlobRepository(db, reader),
  };
  const service = new BackupService(db, repos, async () => null);
  return { db, repos, service };
}

function expectInvalid(raw: unknown): void {
  try {
    BackupService.parse(raw);
  } catch (error) {
    expect(error).toBeInstanceOf(BackupError);
    expect((error as BackupError).reason).toBe('invalid');
    return;
  }
  throw new Error('backup was accepted');
}

describe('BackupService round trip', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });

  it('exports and restores the same data', async () => {
    const { repos, service } = ctx;
    await repos.subjects.save(subject());
    await repos.notebooks.save(notebook({ sample: true, view: { pageId: 'pg1', z: 1.2 } }));
    await repos.pages.save(page({ images: [{ id: 'im1', x: 1, y: 2, w: 30, h: 40, blob: 'bl1' }] }));
    await repos.blobs.save(
      'bl1',
      new Blob([Uint8Array.from(atob(PNG_1PX), (c) => c.charCodeAt(0))], { type: 'image/png' }),
    );

    const file = await service.createBackup();
    const json = JSON.parse(await file.text());
    expect(json.app).toBe('krispekt');
    expect(json.version).toBe(1);
    expect(json.pages[0].strokes[0].p).toEqual([10.12, 20.46, 0.5, 30, 40, 0.6]);
    expect(json.blobs[0]).toMatchObject({ id: 'bl1', type: 'image/png' });

    const target = setup();
    const doc = await target.service.readFile(file);
    await target.service.restore(doc);
    expect(await target.repos.subjects.all()).toEqual([subject()]);
    const [nb] = await target.repos.notebooks.all();
    expect(nb).toMatchObject({ id: 'nb1', sample: true, view: { pageId: 'pg1', z: 1.2 } });
    const [restored] = await target.repos.pages.ofNotebook('nb1');
    expect(restored?.strokes[0]?.p).toBeInstanceOf(Float32Array);
    expect(restored?.strokes[0]?.p[0]).toBeCloseTo(10.12, 4);
    const blob = await target.repos.blobs.get('bl1');
    expect(blob?.type).toBe('image/png');
    expect(blob?.size).toBe(atob(PNG_1PX).length);
  });

  it('accepts backups written by the prototype, including the legacy app name', () => {
    expect(BackupService.parse(backupJson()).pages).toHaveLength(1);
    expect(BackupService.parse(backupJson({ app: 'konspektnik' })).notebooks).toHaveLength(1);
  });

  it('drops unknown fields', () => {
    const raw = backupJson({ extra: 1 });
    (raw.subjects as Record<string, unknown>[])[0] = { ...subject(), evil: '<script>' };
    const doc = BackupService.parse(raw);
    expect(Object.keys(doc.subjects[0] ?? {})).toEqual(['id', 'name', 'color', 'order', 'createdAt']);
  });

  /** A backup whose only page holds one stroke with these extra fields. */
  function withStroke(fields: Record<string, unknown>): Record<string, unknown> {
    const stroke = { id: 'st1', k: 'pen', c: '#000000', s: 2, p: [0, 0, 0.5, 4, 4, 0.5], ...fields };
    return backupJson({ pages: [{ ...page(), strokes: [stroke] }] });
  }

  it.each(BRUSH_KINDS)('accepts strokes drawn with the %s brush', (b) => {
    const doc = BackupService.parse(withStroke({ b }));
    expect(doc.pages[0]?.strokes[0]?.b).toBe(b);
  });

  it('reads strokes without a brush (older backups) as ballpoint', () => {
    const stroke = BackupService.parse(withStroke({})).pages[0]?.strokes[0];
    expect(stroke && 'b' in stroke).toBe(false);
  });

  it('rejects unknown brushes and brushes on highlighter strokes', () => {
    expectInvalid(withStroke({ b: 'quill' }));
    expectInvalid(withStroke({ b: '' }));
    expectInvalid(withStroke({ b: 3 }));
    expectInvalid(withStroke({ b: 'constructor' }));
    expectInvalid(withStroke({ k: 'hl', b: 'pencil' }));
  });

  it('keeps markup in names as plain text (it is rendered with textContent)', () => {
    const raw = backupJson({ subjects: [subject({ name: '<img src=x onerror=alert(1)>' })] });
    expect(BackupService.parse(raw).subjects[0]?.name).toBe('<img src=x onerror=alert(1)>');
  });

  it('rejects files larger than 300 MB before reading them', async () => {
    const big = {
      size: 301 * 1024 * 1024,
      text: () => Promise.reject(new Error('must not read')),
    } as unknown as Blob;
    await expect(ctx.service.readFile(big)).rejects.toMatchObject({ reason: 'too-large' });
  });

  it('rejects non-JSON', async () => {
    await expect(ctx.service.readFile(new Blob(['not json']))).rejects.toMatchObject({ reason: 'invalid' });
  });
});

describe('BackupService rejects malformed or malicious backups', () => {
  const withPage = (overrides: Record<string, unknown>) =>
    backupJson({ pages: [{ ...page(), strokes: [], ...overrides }] });

  it.each<[string, unknown]>([
    ['null', null],
    ['an array', []],
    ['a wrong app name', backupJson({ app: 'other' })],
    ['missing notebooks', backupJson({ notebooks: undefined })],
    ['subjects that are not an array', backupJson({ subjects: 'x' })],
    ['a script tag as an id', backupJson({ subjects: [subject({ id: '<script>alert(1)</script>' })] })],
    ['a name that is a number', backupJson({ subjects: [{ ...subject(), name: 42 }] })],
    ['a huge name', backupJson({ subjects: [subject({ name: 'x'.repeat(5000) })] })],
    ['a bad colour', backupJson({ subjects: [subject({ color: 'red;background:url(x)' })] })],
    ['a CSS-injection colour', backupJson({ notebooks: [notebook({ color: '#fff;}' })] })],
    ['an unknown background', backupJson({ notebooks: [notebook({ bg: 'url(evil)' as never })] })],
    ['a page size of 1e9 mm', withPage({ w: 1e9 })],
    ['a tiny page size', withPage({ h: 1 })],
    [
      'NaN coordinates',
      withPage({ texts: [{ id: 't1', x: 'NaN', y: 0, w: 10, t: 'a', fs: 12, c: '#000000' }] }),
    ],
    ['a huge coordinate', withPage({ images: [{ id: 'i1', x: 1e12, y: 0, w: 1, h: 1, blob: 'b1' }] })],
    [
      'a font size of 5000',
      withPage({ texts: [{ id: 't1', x: 0, y: 0, w: 10, t: 'a', fs: 5000, c: '#000000' }] }),
    ],
    [
      'a stroke with a broken point list',
      withPage({ strokes: [{ id: 's1', k: 'pen', c: '#000000', s: 2, p: [1, 2] }] }),
    ],
    [
      'a stroke with string points',
      withPage({ strokes: [{ id: 's1', k: 'pen', c: '#000000', s: 2, p: ['1', '2', '3'] }] }),
    ],
    [
      'an unknown stroke kind',
      withPage({ strokes: [{ id: 's1', k: 'laser', c: '#000000', s: 2, p: [1, 2, 0.5] }] }),
    ],
    ['strokes that are an object', withPage({ strokes: {} })],
    ['an SVG blob', backupJson({ blobs: [{ id: 'b1', type: 'image/svg+xml', data: 'PHN2Zz4=' }] })],
    ['an HTML blob', backupJson({ blobs: [{ id: 'b1', type: 'text/html', data: 'PGI+' }] })],
    ['invalid base64', backupJson({ blobs: [{ id: 'b1', type: 'image/png', data: '@@@@' }] })],
    [
      'a blob over 25 MB',
      backupJson({ blobs: [{ id: 'b1', type: 'image/png', data: 'A'.repeat(36 * 1024 * 1024) }] }),
    ],
    ['duplicate notebook ids', backupJson({ notebooks: [notebook(), notebook()] })],
  ])('rejects %s', (_label, raw) => {
    expectInvalid(raw);
  });

  it('writes nothing when a backup is rejected', async () => {
    const { repos, service } = setup();
    await repos.subjects.save(subject({ id: 'keep', name: 'Existing' }));
    await expect(
      service.readFile(new Blob([JSON.stringify(backupJson({ app: 'x' }))])),
    ).rejects.toBeInstanceOf(BackupError);
    expect((await repos.subjects.all()).map((s) => s.id)).toEqual(['keep']);
  });
});
