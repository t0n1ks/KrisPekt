import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PREFS, PREFS_KEY } from '../../src/core/constants';
import { Database } from '../../src/storage/Database';
import { NotebookRepository } from '../../src/storage/NotebookRepository';
import { PageRepository } from '../../src/storage/PageRepository';
import { PreferencesStore } from '../../src/storage/PreferencesStore';
import { RecordReader } from '../../src/storage/RecordReader';
import { SaveQueue } from '../../src/storage/SaveQueue';
import { SubjectRepository } from '../../src/storage/SubjectRepository';
import { notebook, page, subject } from './fixtures';

describe('Database', () => {
  it('opens IndexedDB with the prototype schema and keeps data', async () => {
    const db = await Database.open();
    expect(db.persistent).toBe(true);
    await db.put('pages', page({ id: 'a1', nbId: 'n1' }));
    await db.put('pages', page({ id: 'a2', nbId: 'n2' }));
    expect((await db.pagesOf('n1')).map((p) => (p as { id: string }).id)).toEqual(['a1']);
    await db.deleteMany('pages', ['a1', 'a2']);
    expect(await db.getAll('pages')).toEqual([]);
  });

  it('falls back to memory when IndexedDB is unavailable', async () => {
    const db = await Database.open(null);
    expect(db.persistent).toBe(false);
    await db.put('subjects', subject());
    expect(await db.get('subjects', 'sub1')).toEqual(subject());
  });
});

describe('repositories validate stored records', () => {
  it('skips and reports corrupted records instead of failing', async () => {
    const db = Database.inMemory();
    const onCorrupt = vi.fn();
    const repo = new SubjectRepository(db, new RecordReader(onCorrupt));
    await db.put('subjects', subject({ id: 'good' }));
    await db.put('subjects', { id: 'bad', name: { html: '<b>' }, color: 'nope' } as never);
    expect((await repo.all()).map((s) => s.id)).toEqual(['good']);
    expect(onCorrupt).toHaveBeenCalledTimes(1);
  });

  it('loads pages in notebook order and appends unlisted ones', async () => {
    const db = Database.inMemory();
    const repo = new PageRepository(db, new RecordReader(() => undefined));
    await repo.save(page({ id: 'p1' }), page({ id: 'p2' }), page({ id: 'p3' }));
    const ordered = await repo.loadOrdered(notebook({ pageIds: ['p3', 'p1', 'gone'] }));
    expect(ordered.map((p) => p.id)).toEqual(['p3', 'p1', 'p2']);
  });
});

describe('PreferencesStore', () => {
  it('returns defaults when nothing is stored', () => {
    localStorage.clear();
    expect(new PreferencesStore(localStorage).load()).toEqual(DEFAULT_PREFS);
  });

  it('merges valid values and rejects invalid ones', () => {
    localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({
        pen: { c: '#123456', s: 999 },
        hl: { c: 'url(evil)' },
        er: { mode: 'whole' },
        favs: ['#111111', 'bad', '#222222', '#333333', '#444444'],
        lang: 'de',
        fingerDraw: 'yes',
      }),
    );
    const prefs = new PreferencesStore(localStorage).load();
    // Preferences from before brushes: the single pen becomes the ballpoint.
    expect(prefs.brush).toBe('ballpoint');
    expect(prefs.brushes.ballpoint).toEqual({ c: '#123456', s: 8 });
    expect(prefs.brushes.fountain).toEqual(DEFAULT_PREFS.brushes.fountain);
    expect(prefs.hl).toEqual(DEFAULT_PREFS.hl);
    expect(prefs.er).toEqual({ mode: 'whole', r: 16 });
    expect(prefs.favs).toEqual(['#111111', '#222222', '#333333', '#444444']);
    expect(prefs.lang).toBe('de');
    expect(prefs.fingerDraw).toBe(true);
  });

  it('validates brushes, favourites and recent colours', () => {
    localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({
        brush: 'pencil',
        brushes: { pencil: { c: '#ABCDEF', s: 0.01 }, brush: { c: 'red', s: 12 }, quill: { c: '#000000' } },
        favs: ['#000001', '#000002', '#000003', '#000004', '#000005', '#000006'],
        recent: {
          pen: Array.from({ length: 12 }, (_, i) => `#00000${i.toString(16)}`),
          hl: ['bad', '#FDE047'],
        },
      }),
    );
    const prefs = new PreferencesStore(localStorage).load();
    expect(prefs.brush).toBe('pencil');
    expect(prefs.brushes.pencil).toEqual({ c: '#ABCDEF', s: 0.6 });
    expect(prefs.brushes.brush).toEqual({ c: DEFAULT_PREFS.brushes.brush.c, s: 12 });
    expect(Object.keys(prefs.brushes)).not.toContain('quill');
    expect(prefs.favs).toHaveLength(5);
    expect(prefs.recent.pen).toHaveLength(8);
    expect(prefs.recent.hl).toEqual(['#FDE047']);
  });

  it('falls back to the ballpoint for an unknown brush', () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ brush: 'quill' }));
    expect(new PreferencesStore(localStorage).load().brush).toBe('ballpoint');
  });

  it('survives corrupt JSON', () => {
    localStorage.setItem(PREFS_KEY, '{not json');
    expect(new PreferencesStore(localStorage).load()).toEqual(DEFAULT_PREFS);
  });
});

describe('SaveQueue', () => {
  afterEach(() => vi.useRealTimers());

  function setup() {
    const db = Database.inMemory();
    const reader = new RecordReader(() => undefined);
    const pages = new PageRepository(db, reader);
    const notebooks = new NotebookRepository(db, reader);
    const onError = vi.fn();
    const onSaved = vi.fn();
    return { pages, notebooks, onError, onSaved, queue: new SaveQueue(pages, notebooks, onError, onSaved) };
  }

  it('reports content changes, but not a forced flush with nothing changed', async () => {
    const { onSaved, queue } = setup();
    const nb = notebook({ updatedAt: 5 });
    queue.setNotebook(nb);
    await queue.flush(true);
    expect(onSaved).not.toHaveBeenCalled();
    expect(nb.updatedAt).toBe(5);
    queue.markPageDirty(page());
    await queue.flush();
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(nb.updatedAt).toBeGreaterThan(5);
  });

  it('writes dirty pages after the debounce delay', async () => {
    vi.useFakeTimers();
    const { pages, notebooks, queue } = setup();
    const nb = notebook();
    queue.setNotebook(nb);
    queue.markPageDirty(page());
    expect(await pages.all()).toEqual([]);
    await vi.advanceTimersByTimeAsync(700);
    expect((await pages.all()).map((p) => p.id)).toEqual(['pg1']);
    expect((await notebooks.all()).map((n) => n.id)).toEqual(['nb1']);
  });

  it('keeps pages dirty and reports when saving fails', async () => {
    const { pages, onError, queue } = setup();
    const save = vi.spyOn(pages, 'save').mockRejectedValueOnce(new Error('quota'));
    queue.markPageDirty(page());
    await queue.flush();
    expect(onError).toHaveBeenCalledTimes(1);
    await queue.flush();
    expect(save).toHaveBeenCalledTimes(2);
    expect((await pages.all()).map((p) => p.id)).toEqual(['pg1']);
  });

  it('forgets deleted pages', async () => {
    const { pages, queue } = setup();
    const p = page();
    queue.markPageDirty(p);
    queue.forget(p);
    await queue.flush();
    expect(await pages.all()).toEqual([]);
  });
});
