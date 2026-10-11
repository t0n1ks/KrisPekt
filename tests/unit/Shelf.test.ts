import { describe, expect, it, vi } from 'vitest';
import { COVER_COLORS } from '../../src/core/constants';
import type { Subject } from '../../src/core/types';
import { ColorLists } from '../../src/domain/ColorLists';
import { ShelfOrder } from '../../src/domain/ShelfOrder';
import de from '../../src/i18n/locales/de.json';
import en from '../../src/i18n/locales/en.json';
import ru from '../../src/i18n/locales/ru.json';
import uk from '../../src/i18n/locales/uk.json';
import { LibraryService } from '../../src/services/LibraryService';
import { BackupService } from '../../src/storage/BackupService';
import { BlobRepository } from '../../src/storage/BlobRepository';
import { Database } from '../../src/storage/Database';
import { NotebookRepository } from '../../src/storage/NotebookRepository';
import { PageRepository } from '../../src/storage/PageRepository';
import { RecordReader } from '../../src/storage/RecordReader';
import { SubjectRepository } from '../../src/storage/SubjectRepository';
import { backupJson, notebook, subject } from './fixtures';

describe('ShelfOrder', () => {
  const list = ['a', 'b', 'c', 'd'];

  it('moves an item up and down', () => {
    expect(ShelfOrder.step(list, 'c', -1)).toEqual(['a', 'c', 'b', 'd']);
    expect(ShelfOrder.step(list, 'b', 1)).toEqual(['a', 'c', 'b', 'd']);
  });

  it('leaves the order unchanged at the ends', () => {
    expect(ShelfOrder.step(list, 'a', -1)).toEqual(list);
    expect(ShelfOrder.step(list, 'd', 1)).toEqual(list);
    expect(ShelfOrder.step(list, 'x', 1)).toEqual(list);
  });

  it('moves an item to any position', () => {
    expect(ShelfOrder.moveTo(list, 0, 3)).toEqual(['b', 'c', 'd', 'a']);
    expect(ShelfOrder.moveTo(list, 3, 0)).toEqual(['d', 'a', 'b', 'c']);
    expect(ShelfOrder.moveTo(list, 1, 99)).toEqual(['a', 'c', 'd', 'b']);
  });

  it('computes where a dragged item lands from the other items’ centres', () => {
    const centers = [100, 300, 500];
    expect(ShelfOrder.dropIndex(centers, 50)).toBe(0);
    expect(ShelfOrder.dropIndex(centers, 250)).toBe(1);
    expect(ShelfOrder.dropIndex(centers, 450)).toBe(2);
    expect(ShelfOrder.dropIndex(centers, 900)).toBe(3);
    expect(ShelfOrder.dropIndex([], 10)).toBe(0);
  });

  it('renumbers orders as 0..n-1', () => {
    const items = [{ order: 7 }, { order: -2 }, { order: 40 }];
    ShelfOrder.renumber(items);
    expect(items.map((i) => i.order)).toEqual([0, 1, 2]);
  });
});

function library() {
  const db = Database.inMemory();
  const reader = new RecordReader(() => undefined);
  const repos = {
    subjects: new SubjectRepository(db, reader),
    notebooks: new NotebookRepository(db, reader),
    pages: new PageRepository(db, reader),
    blobs: new BlobRepository(db, reader),
  };
  const onChange = vi.fn();
  return {
    repos,
    onChange,
    service: new LibraryService(repos, () => 'id' + Math.random().toString(36).slice(2, 10), onChange),
  };
}

describe('LibraryService reordering', () => {
  async function withSubjects(): Promise<ReturnType<typeof library> & { subjects: Subject[] }> {
    const lib = library();
    const subjects = [
      subject({ id: 's1', name: 'A', order: 5 }),
      subject({ id: 's2', name: 'B', order: 9 }),
      subject({ id: 's3', name: 'C', order: 12 }),
    ];
    await lib.repos.subjects.save(...subjects);
    await lib.service.load();
    return { ...lib, subjects };
  }

  const storedOrder = async (repos: ReturnType<typeof library>['repos']): Promise<string[]> =>
    (await repos.subjects.all()).sort((a, b) => a.order - b.order).map((s) => `${s.id}:${s.order}`);

  it('moves a subject down and persists orders 0..n-1', async () => {
    const { service, repos, onChange } = await withSubjects();
    const first = service.subject('s1');
    if (!first) throw new Error('missing subject');
    await service.moveSubject(first, 1);
    expect(await storedOrder(repos)).toEqual(['s2:0', 's1:1', 's3:2']);
    expect(onChange).toHaveBeenCalled();
  });

  it('keeps the order when moving past an end', async () => {
    const { service, repos } = await withSubjects();
    const last = service.subject('s3');
    if (!last) throw new Error('missing subject');
    await service.moveSubject(last, 1);
    expect(await storedOrder(repos)).toEqual(['s1:0', 's2:1', 's3:2']);
  });

  it('stores the order from a drag', async () => {
    const { service, repos } = await withSubjects();
    await service.reorderSubjects(['s3', 's1', 's2']);
    expect(await storedOrder(repos)).toEqual(['s3:0', 's1:1', 's2:2']);
    expect(service.sortedSubjects().map((s) => s.id)).toEqual(['s3', 's1', 's2']);
  });

  it('sorts old notebooks by creation time and arranged ones by order', async () => {
    const { service, repos } = library();
    await repos.subjects.save(subject({ id: 's1' }));
    await repos.notebooks.save(
      notebook({ id: 'n1', subjectId: 's1', createdAt: 3 }),
      notebook({ id: 'n2', subjectId: 's1', createdAt: 1 }),
      notebook({ id: 'n3', subjectId: 's1', createdAt: 2 }),
    );
    await service.load();
    expect(service.notebooksOf('s1').map((n) => n.id)).toEqual(['n2', 'n3', 'n1']);
    const n1 = service.notebook('n1');
    if (!n1) throw new Error('missing notebook');
    await service.moveNotebook(n1, -1);
    expect(service.notebooksOf('s1').map((n) => n.id)).toEqual(['n2', 'n1', 'n3']);
    const stored = await repos.notebooks.all();
    expect(stored.map((n) => n.order).sort()).toEqual([0, 1, 2]);
  });
});

describe('notebook order in backups', () => {
  it('accepts an optional notebook order and keeps old notebooks without one', () => {
    const doc = BackupService.parse(
      backupJson({ notebooks: [notebook({ order: 2 }), notebook({ id: 'nb2' })] }),
    );
    expect(doc.notebooks[0]?.order).toBe(2);
    expect(doc.notebooks[1] && 'order' in doc.notebooks[1]).toBe(false);
  });

  it('rejects a notebook order that is not a sane number', () => {
    for (const order of ['1', 1e12, Number.NaN, null]) {
      expect(() => BackupService.parse(backupJson({ notebooks: [{ ...notebook(), order }] }))).toThrow();
    }
  });
});

describe('cover palette', () => {
  const OLD = ['#2F5DA8', '#2E7D5B', '#B23A48', '#C9822B', '#6B4FA0', '#3D4451', '#1E8C93', '#B5527A'];

  it('has 24 distinct colours including the 8 original ones', () => {
    expect(COVER_COLORS).toHaveLength(24);
    expect(new Set(COVER_COLORS.map((c) => c.toLowerCase())).size).toBe(24);
    for (const c of OLD) expect(COVER_COLORS).toContain(c);
  });

  it.each([
    ['uk', uk],
    ['ru', ru],
    ['de', de],
    ['en', en],
  ])('%s names every cover colour', (_lang, dict) => {
    expect(dict.coverColorNames).toHaveLength(COVER_COLORS.length);
  });

  it('accepts only #RRGGBB as a custom cover colour', () => {
    expect(ColorLists.parseHex('#a1b2c3')).toBe('#A1B2C3');
    expect(ColorLists.parseHex('a1b2c3')).toBeNull();
    expect(ColorLists.parseHex('#a1b2c')).toBeNull();
  });

  it('gives light covers (pastels) an edge and deep ones none', () => {
    expect(COVER_COLORS.slice(18).every((c) => ColorLists.isLight(c))).toBe(true);
    expect(COVER_COLORS.slice(0, 18).some((c) => ColorLists.isLight(c))).toBe(false);
    expect(ColorLists.isLight('#FFFFFF')).toBe(true);
  });
});
