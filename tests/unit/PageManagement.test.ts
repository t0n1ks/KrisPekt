import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Camera } from '../../src/canvas/Camera';
import { PageLayout } from '../../src/canvas/PageLayout';
import type { Notebook, Page } from '../../src/core/types';
import { History } from '../../src/domain/History';
import { PageGrid } from '../../src/domain/PageGrid';
import { PageOrder } from '../../src/domain/PageOrder';
import { PageSizePolicy } from '../../src/domain/PageSizePolicy';
import { PageSizes } from '../../src/domain/PageSizes';
import { ThumbnailCache } from '../../src/domain/ThumbnailCache';
import { EditorSession } from '../../src/editor/EditorSession';
import { PageDeletion, type UndoPrompt } from '../../src/editor/PageDeletion';
import { PageOperations } from '../../src/editor/PageOperations';
import { UndoController } from '../../src/editor/UndoController';
import { Viewport } from '../../src/editor/Viewport';
import { I18n } from '../../src/i18n/I18n';
import { BlobSweeper } from '../../src/services/BlobSweeper';
import { TabPresence } from '../../src/services/TabPresence';
import { BackupService } from '../../src/storage/BackupService';
import { BlobRepository } from '../../src/storage/BlobRepository';
import { Database } from '../../src/storage/Database';
import { NotebookRepository } from '../../src/storage/NotebookRepository';
import { PageRepository } from '../../src/storage/PageRepository';
import { RecordReader } from '../../src/storage/RecordReader';
import { SaveQueue } from '../../src/storage/SaveQueue';
import { SubjectRepository } from '../../src/storage/SubjectRepository';
import { notebook, page, subject } from './fixtures';

const A4 = { w: 210, h: 297 };
const A5 = { w: 148, h: 210 };

const image = (blob: string, id = 'i' + blob) => ({ id, x: 0, y: 0, w: 10, h: 10, blob });
const ids = (pages: readonly Page[]): string[] => pages.map((p) => p.id);

/** The real editor logic over an in-memory database, with a prompt the test can drive. */
function rig(pages: Page[], options: { db?: Database; nb?: Notebook } = {}) {
  const db = options.db ?? Database.inMemory();
  const reader = new RecordReader(() => undefined);
  const repos = {
    subjects: new SubjectRepository(db, reader),
    notebooks: new NotebookRepository(db, reader),
    pages: new PageRepository(db, reader),
    blobs: new BlobRepository(db, reader),
  };
  const onSaved = vi.fn();
  const onError = vi.fn();
  const saveQueue = new SaveQueue(repos.pages, onError, onSaved);
  const nb = options.nb ?? notebook({ base: { ...A4 }, pageIds: ids(pages) });
  saveQueue.setNotebook(nb);
  const session = new EditorSession(
    () => undefined,
    (p) => saveQueue.markPageDirty(p),
    () => saveQueue.markNotebookDirty(),
  );
  session.open(nb, pages);
  const history = new History();
  const undo = new UndoController({
    history,
    session,
    beforeStep: () => undefined,
    onRestored: () => undefined,
    onStateChange: () => undefined,
  });
  const camera = new Camera();
  camera.resize({ left: 0, top: 0, width: 1000, height: 800 }, 1);
  camera.setZoom(1.4);
  const layout = new PageLayout();
  layout.update(pages);
  const viewport = new Viewport(camera, layout, session, { request: () => undefined } as never);
  const i18n = new I18n('en');
  const settle = vi.fn();
  const toast = vi.fn();
  const onPagesChanged = vi.fn();
  let id = 0;
  const pageOps = new PageOperations({
    session,
    viewport,
    camera,
    layout,
    undo,
    saveQueue,
    i18n,
    sizes: new PageSizes(i18n),
    makeId: () => 'new' + ++id,
    toast,
    settle,
    onPagesChanged,
  });
  const due = { value: false };
  const sweeper: BlobSweeper = new BlobSweeper({
    blobs: repos.blobs,
    tabs: { othersOpen: () => Promise.resolve(false) },
    inUse: () =>
      new Set([...PageRepository.blobIds(session.pages), ...history.blobIds(), ...deletion.pendingBlobIds()]),
    flush: () => saveQueue.flush(),
    isDue: () => due.value,
    setDue: (v) => {
      due.value = v;
    },
    onError,
  });
  let shown: Parameters<UndoPrompt['show']>[0] | null = null;
  const prompt: UndoPrompt = {
    show: (p) => {
      shown = p;
    },
    hide: () => {
      shown = null;
    },
  };
  const confirm = vi.fn((_title: string, _text: string) => Promise.resolve(true));
  const deletion: PageDeletion = new PageDeletion({
    session,
    pageOps,
    undo,
    cache: { delete: () => undefined },
    saveQueue,
    sweeper,
    i18n,
    prompt,
    toast,
    confirm,
    settle,
    onPagesChanged,
  });
  return {
    db,
    repos,
    nb,
    session,
    history,
    undo,
    camera,
    layout,
    pageOps,
    deletion,
    sweeper,
    due,
    saveQueue,
    onSaved,
    onError,
    settle,
    toast,
    confirm,
    prompt: (): Parameters<UndoPrompt['show']>[0] | null => shown,
  };
}

describe('PageOrder', () => {
  it('moves an item in either direction and clamps the target', () => {
    expect(PageOrder.moved(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(PageOrder.moved(['a', 'b', 'c', 'd'], 3, 0)).toEqual(['d', 'a', 'b', 'c']);
    expect(PageOrder.moved(['a', 'b'], 0, 99)).toEqual(['b', 'a']);
  });

  it('takes items out and puts them back at their positions', () => {
    const list = ['a', 'b', 'c', 'd', 'e'];
    const { kept, removed } = PageOrder.without(list, new Set(['a', 'c', 'e']));
    expect(kept).toEqual(['b', 'd']);
    expect(PageOrder.restored(kept, removed)).toEqual(list);
  });

  it('turns a gap into the final index', () => {
    expect(PageOrder.indexForGap(1, 0)).toBe(0);
    expect(PageOrder.indexForGap(1, 1)).toBe(1);
    expect(PageOrder.indexForGap(1, 2)).toBe(1);
    expect(PageOrder.indexForGap(1, 4)).toBe(3);
  });
});

describe('PageGrid', () => {
  const grid = { originX: 10, originY: 20, stepX: 100, stepY: 200, columns: 3, count: 7 };

  it('finds the gap nearest to a point', () => {
    expect(PageGrid.gapAt(grid, 15, 30)).toBe(0);
    expect(PageGrid.gapAt(grid, 70, 30)).toBe(1);
    expect(PageGrid.gapAt(grid, 300, 30)).toBe(3);
    expect(PageGrid.gapAt(grid, 70, 230)).toBe(4);
  });

  it('stays within the list', () => {
    expect(PageGrid.gapAt(grid, -500, -500)).toBe(0);
    expect(PageGrid.gapAt(grid, 5000, 5000)).toBe(7);
  });

  it('places the indicator, including past the last cell of a full row', () => {
    expect(PageGrid.gapPosition(grid, 4)).toEqual({ x: 110, y: 220 });
    expect(PageGrid.gapPosition(grid, 7)).toEqual({ x: 110, y: 420 });
    expect(PageGrid.gapPosition({ ...grid, count: 6 }, 6)).toEqual({ x: 310, y: 220 });
  });
});

describe('ThumbnailCache', () => {
  it('never takes a thumbnail of older content for up to date', () => {
    const cache = new ThumbnailCache<string>(5);
    cache.put('a', 'bitmap', 3, new Set());
    expect(cache.isFresh('a', 3)).toBe(true);
    expect(cache.isFresh('a', 4)).toBe(false);
    expect(cache.isFresh('b', 0)).toBe(false);
  });

  it('stays bounded and evicts the oldest thumbnails off screen first', () => {
    const cache = new ThumbnailCache<string>(2);
    cache.put('a', 'A', 1, new Set(['a']));
    cache.put('b', 'B', 1, new Set(['a']));
    cache.put('c', 'C', 1, new Set(['a']));
    expect(cache.bitmap('a')).toBe('A');
    expect(cache.bitmap('b')).toBeNull();
    expect(cache.size).toBe(2);
  });
});

describe('inserting pages', () => {
  const nb = notebook({ base: { ...A4 }, bg: 'dots' });
  const makeId = (): string => 'x';

  it('a page between others follows the page before it', () => {
    const free = page({ id: 'free', locked: false, ...A5, bg: 'lines' });
    const locked = page({ id: 'locked', locked: true, ...A4 });
    expect(PageSizePolicy.newPageAt(nb, [free, locked], 1, makeId)).toMatchObject({
      locked: false,
      ...A5,
      bg: 'lines',
    });
    expect(PageSizePolicy.newPageAt(nb, [locked, free], 1, makeId)).toMatchObject({ locked: true, ...A4 });
  });

  it('after the last page it follows the last page', () => {
    const free = page({ locked: false, ...A5 });
    expect(PageSizePolicy.newPageAt(nb, [page(), free], 2, makeId)).toMatchObject({ locked: false, ...A5 });
  });

  it('before the first page it is locked at the notebook size, whatever the first page is', () => {
    const free = page({ locked: false, ...A5, bg: 'lines' });
    expect(PageSizePolicy.newPageAt(nb, [free], 0, makeId)).toMatchObject({
      locked: true,
      ...A4,
      bg: 'dots',
    });
  });

  it('addBefore puts a page in position and saves it with the order in one go', async () => {
    const a = page({ id: 'a' });
    const b = page({ id: 'b' });
    const r = rig([a, b]);
    await r.repos.pages.save(a, b);
    r.pageOps.addBefore(b);
    expect(ids(r.session.pages)).toEqual(['a', 'new1', 'b']);
    r.pageOps.addBefore(a);
    expect(ids(r.session.pages)).toEqual(['new2', 'a', 'new1', 'b']);
    expect(r.nb.base).toEqual(A4);
    expect(r.session.pages[0]).toMatchObject({ locked: true, ...A4 });
    await r.saveQueue.flush();
    expect(ids(await r.repos.pages.loadOrdered((await r.repos.notebooks.all())[0] as Notebook))).toEqual(
      ids(r.session.pages),
    );
  });

  it('add after the current page keeps working, at the right position', () => {
    const a = page({ id: 'a' });
    const b = page({ id: 'b' });
    const r = rig([a, b]);
    r.session.currentIndex = 0;
    r.pageOps.add();
    expect(ids(r.session.pages)).toEqual(['a', 'new1', 'b']);
    expect(r.settle).toHaveBeenCalled();
  });
});

describe('reordering pages', () => {
  it('moving the first page changes no size and leaves the notebook size alone', () => {
    const first = page({ id: 'first', locked: true, ...A4 });
    const free = page({ id: 'free', locked: false, ...A5 });
    const r = rig([first, free]);
    r.pageOps.moveTo(first, 1);
    expect(ids(r.session.pages)).toEqual(['free', 'first']);
    expect(r.nb.base).toEqual(A4);
    expect(free).toMatchObject({ locked: false, ...A5 });
    expect(first).toMatchObject({ locked: true, ...A4 });
    // New locked pages still get the notebook size.
    r.pageOps.addBefore(free);
    expect(r.session.pages[0]).toMatchObject({ locked: true, ...A4 });
  });

  it('saves the new order, keeps the zoom and keeps the current page on screen', async () => {
    const pages = [page({ id: 'a' }), page({ id: 'b' }), page({ id: 'c' })];
    const [a, b, c] = pages as [Page, Page, Page];
    const r = rig(pages);
    r.camera.setZoomLock(1.4);
    r.session.currentIndex = 1;
    r.camera.y = r.layout.pos(b).y + 50;
    r.pageOps.moveTo(c, 0);
    expect(r.camera.y).toBeCloseTo(r.layout.pos(b).y + 50);
    expect(r.camera.z).toBe(1.4);
    await r.saveQueue.flush();
    expect((await r.repos.notebooks.all())[0]?.pageIds).toEqual(['c', 'a', 'b']);
    expect(a.id).toBe('a');
    expect(r.onSaved).toHaveBeenCalled();
  });

  it('a move that changes nothing saves nothing', async () => {
    const a = page({ id: 'a' });
    const r = rig([a, page({ id: 'b' })]);
    r.pageOps.moveTo(a, 0);
    await r.saveQueue.flush();
    expect(r.onSaved).not.toHaveBeenCalled();
  });

  it('undo steps follow their page after a move', () => {
    const a = page({ id: 'a' });
    const b = page({ id: 'b' });
    const r = rig([a, b]);
    r.undo.record(a);
    a.strokes = [];
    r.pageOps.moveTo(a, 1);
    r.undo.undo();
    expect(a.strokes).toHaveLength(1);
    expect(b.strokes).toHaveLength(1);
  });
});

describe('duplicating pages', () => {
  it('makes an exact copy right after the original, sharing its blobs', () => {
    const original = page({
      id: 'a',
      locked: false,
      ...A5,
      bg: 'lines',
      bgBlob: 'pdf',
      images: [image('photo')],
    });
    const r = rig([original, page({ id: 'b' })]);
    r.pageOps.duplicate(original);
    const copy = r.session.pages[1] as Page;
    expect(ids(r.session.pages)).toEqual(['a', 'new1', 'b']);
    expect(copy).toMatchObject({ locked: false, ...A5, bg: 'lines', bgBlob: 'pdf' });
    expect(copy.strokes).toEqual(original.strokes);
    expect(copy.texts).toEqual(original.texts);
    expect(copy.images).toEqual(original.images);
    copy.strokes = [];
    expect(original.strokes).toHaveLength(1);
  });

  it('deleting either the original or the copy keeps the shared blobs', async () => {
    const original = page({ id: 'a', bgBlob: 'pdf', images: [image('photo')] });
    const r = rig([original, page({ id: 'b' })]);
    await r.repos.blobs.save('pdf', new Blob(['p']));
    await r.repos.blobs.save('photo', new Blob(['p']));
    r.pageOps.duplicate(original);
    const copy = r.session.pages[1] as Page;
    await r.saveQueue.flush();
    await r.deletion.request([original]);
    r.prompt()?.onExpire();
    await vi.waitFor(() => expect(r.due.value).toBe(false));
    expect(await r.repos.blobs.get('pdf')).not.toBeNull();
    expect(await r.repos.blobs.get('photo')).not.toBeNull();
    expect(copy.bgBlob).toBe('pdf');
  });
});

describe('deleting pages', () => {
  function three() {
    const pages = [page({ id: 'a' }), page({ id: 'b', images: [image('photo')] }), page({ id: 'c' })];
    return { pages, r: rig([...pages]) };
  }

  it('asks first, naming how many pages will go', async () => {
    const { pages, r } = three();
    r.confirm.mockResolvedValueOnce(false);
    expect(await r.deletion.request(pages.slice(0, 2))).toBe(false);
    expect(r.session.pages).toHaveLength(3);
    expect(r.confirm.mock.calls[0]?.[1]).toContain('2 pages');
  });

  it('never deletes the last page, one at a time or all at once', async () => {
    const { pages, r } = three();
    expect(await r.deletion.request(pages)).toBe(false);
    expect(r.confirm).not.toHaveBeenCalled();
    expect(r.session.pages).toHaveLength(3);
    expect(r.toast).toHaveBeenCalled();
  });

  it('deletes several pages at once, in one transaction with the new order', async () => {
    const { pages, r } = three();
    await r.saveQueue.flush();
    await r.repos.pages.save(...pages);
    const write = vi.spyOn(r.db, 'writeAcross');
    await r.deletion.request([pages[0] as Page, pages[2] as Page]);
    await r.saveQueue.flush();
    expect(ids(r.session.pages)).toEqual(['b']);
    expect(ids(await r.repos.pages.all())).toEqual(['b']);
    expect((await r.repos.notebooks.all())[0]?.pageIds).toEqual(['b']);
    expect(write).toHaveBeenCalledTimes(1);
    expect(r.onSaved).toHaveBeenCalled();
  });

  it('Undo brings pages, content and positions back and stores them again', async () => {
    const { pages, r } = three();
    await r.repos.pages.save(...pages);
    await r.deletion.request([pages[0] as Page, pages[1] as Page]);
    await r.saveQueue.flush();
    expect(r.prompt()?.message).toBe('Deleted: 2 pages');
    r.prompt()?.onAction();
    await r.saveQueue.flush();
    expect(ids(r.session.pages)).toEqual(['a', 'b', 'c']);
    expect(r.session.pages[1]?.images).toEqual([image('photo')]);
    const stored = await r.repos.pages.loadOrdered((await r.repos.notebooks.all())[0] as Notebook);
    expect(ids(stored)).toEqual(['a', 'b', 'c']);
    expect(stored[1]?.strokes).toHaveLength(1);
  });

  it('keeps blobs during the undo window and removes them after it', async () => {
    const { pages, r } = three();
    await r.repos.pages.save(...pages);
    const reader = new RecordReader(() => undefined);
    // A blob stored by an earlier run of the app, not one saved just now.
    await r.db.put('blobs', { id: 'photo', blob: new Blob(['p']) } as never);
    const blobs = new BlobRepository(r.db, reader);
    await r.deletion.request([pages[1] as Page]);
    await r.saveQueue.flush();
    expect(r.due.value).toBe(true);
    expect(await blobs.get('photo')).not.toBeNull();
    r.prompt()?.onExpire();
    await vi.waitFor(() => expect(r.due.value).toBe(false));
    expect(await blobs.get('photo')).toBeNull();
  });

  it('Undo keeps the blobs', async () => {
    const { pages, r } = three();
    await r.db.put('blobs', { id: 'photo', blob: new Blob(['p']) } as never);
    await r.deletion.request([pages[1] as Page]);
    r.prompt()?.onAction();
    await r.sweeper.run();
    expect(await r.repos.blobs.get('photo')).not.toBeNull();
  });

  it('a new deletion ends the window of the one before it', async () => {
    const { pages, r } = three();
    await r.deletion.request([pages[0] as Page]);
    await r.deletion.request([pages[1] as Page]);
    r.prompt()?.onAction();
    expect(ids(r.session.pages)).toEqual(['b', 'c']);
  });

  it('undo steps of a deleted page are gone, also after Undo, and others still work', async () => {
    const { pages, r } = three();
    const [a, b] = pages as [Page, Page, Page];
    r.undo.record(b);
    b.strokes = [];
    r.undo.record(a);
    a.strokes = [];
    await r.deletion.request([b]);
    r.prompt()?.onAction();
    expect(r.undo.undo()).toBe(true);
    expect(a.strokes).toHaveLength(1);
    expect(r.undo.undo()).toBe(false);
    expect(b.strokes).toHaveLength(0);
  });

  it('settles text editing and the selection before any page operation', async () => {
    const { pages, r } = three();
    r.pageOps.moveTo(pages[0] as Page, 1);
    expect(r.settle).toHaveBeenCalledTimes(1);
    r.pageOps.duplicate(pages[0] as Page);
    expect(r.settle).toHaveBeenCalledTimes(2);
    r.pageOps.addBefore(pages[0] as Page);
    expect(r.settle).toHaveBeenCalledTimes(3);
    await r.deletion.request([pages[0] as Page]);
    expect(r.settle.mock.calls.length).toBeGreaterThan(3);
  });
});

describe('cleaning up blobs', () => {
  function stored() {
    const db = Database.inMemory();
    const blobs = new BlobRepository(db, new RecordReader(() => undefined));
    const put = (id: string): Promise<void> => db.put('blobs', { id, blob: new Blob(['x']) } as never);
    return { db, blobs, put };
  }

  it('removes only blobs no stored page references, across notebooks', async () => {
    const { db, blobs, put } = stored();
    await Promise.all(['orphan', 'bg', 'img', 'other'].map(put));
    await db.put('pages', page({ id: 'p1', nbId: 'n1', bgBlob: 'bg', images: [image('img')] }));
    await db.put('pages', page({ id: 'p2', nbId: 'n2', images: [image('other')] }));
    expect(await blobs.sweep(new Set())).toEqual({ deleted: 1, spared: 0 });
    expect(await blobs.get('orphan')).toBeNull();
    expect(await blobs.get('bg')).not.toBeNull();
    expect(await blobs.get('other')).not.toBeNull();
  });

  it('keeps blobs of a damaged page record, which may still be repaired', async () => {
    const { db, blobs, put } = stored();
    await put('img');
    await db.put('pages', {
      id: 'bad',
      strokes: 'broken',
      bgBlob: null,
      images: [{ blob: 'img' }, null],
    } as never);
    expect((await blobs.sweep(new Set())).deleted).toBe(0);
  });

  it('spares blobs in use and blobs saved since the app started, for now', async () => {
    const { blobs, put } = stored();
    await put('history');
    await blobs.save('importing', new Blob(['x']));
    expect(await blobs.sweep(new Set(['history']))).toEqual({ deleted: 0, spared: 2 });
  });

  it('works in one transaction on real IndexedDB', async () => {
    const db = await Database.open();
    const blobs = new BlobRepository(db, new RecordReader(() => undefined));
    await db.put('blobs', { id: 'keepme', blob: new Blob(['x']) } as never);
    await db.put('blobs', { id: 'orphan', blob: new Blob(['x']) } as never);
    await db.put('pages', page({ id: 'sweepp', images: [image('keepme')] }));
    const storedIds = async (): Promise<string[]> =>
      (await db.getAll('blobs')).map((row) => (row as { id: string }).id);
    expect((await blobs.sweep(new Set())).deleted).toBeGreaterThanOrEqual(1);
    expect(await storedIds()).toContain('keepme');
    expect(await storedIds()).not.toContain('orphan');
    await db.delete('pages', 'sweepp');
    await blobs.sweep(new Set());
  });

  describe('BlobSweeper', () => {
    function sweeper(overrides: Partial<ConstructorParameters<typeof BlobSweeper>[0]> = {}) {
      const state = { due: true };
      const sweep = vi.fn().mockResolvedValue({ deleted: 1, spared: 0 });
      const onError = vi.fn();
      const flush = vi.fn().mockResolvedValue(undefined);
      const instance = new BlobSweeper({
        blobs: { sweep },
        tabs: { othersOpen: () => Promise.resolve(false) },
        inUse: () => new Set(),
        flush,
        isDue: () => state.due,
        setDue: (v) => {
          state.due = v;
        },
        onError,
        ...overrides,
      });
      return { instance, state, sweep, onError, flush };
    }

    let s: ReturnType<typeof sweeper>;
    beforeEach(() => {
      s = sweeper();
    });

    it('does nothing unless a cleanup is due', async () => {
      s.state.due = false;
      await s.instance.run();
      expect(s.sweep).not.toHaveBeenCalled();
    });

    it('saves pending edits first and clears the flag afterwards', async () => {
      await s.instance.run();
      expect(s.flush.mock.invocationCallOrder[0]).toBeLessThan(s.sweep.mock.invocationCallOrder[0] ?? 0);
      expect(s.state.due).toBe(false);
    });

    it('stays due when blobs were only spared, for the next start', async () => {
      s.sweep.mockResolvedValue({ deleted: 0, spared: 1 });
      await s.instance.run();
      expect(s.state.due).toBe(true);
    });

    it('leaves everything alone while another tab is open', async () => {
      const busy = sweeper({ tabs: { othersOpen: () => Promise.resolve(true) } });
      await busy.instance.run();
      expect(busy.sweep).not.toHaveBeenCalled();
      expect(busy.state.due).toBe(true);
    });

    it('reports a failure and stays due', async () => {
      s.sweep.mockRejectedValue(new Error('disk'));
      await s.instance.run();
      expect(s.onError).toHaveBeenCalledTimes(1);
      expect(s.state.due).toBe(true);
    });
  });

  describe('TabPresence', () => {
    const locks = (clients: string[]) =>
      ({
        request: vi.fn(() => Promise.resolve()),
        query: () =>
          Promise.resolve({ held: clients.map((clientId) => ({ name: 'krispekt-open-tab', clientId })) }),
      }) as unknown as LockManager;

    it('tells one tab from several', async () => {
      expect(await new TabPresence(locks(['me'])).othersOpen()).toBe(false);
      expect(await new TabPresence(locks(['me', 'me'])).othersOpen()).toBe(false);
      expect(await new TabPresence(locks(['me', 'you'])).othersOpen()).toBe(true);
    });

    it('assumes no other tab without the API, and one if the query fails', async () => {
      expect(await new TabPresence(null).othersOpen()).toBe(false);
      const failing = locks([]);
      failing.query = () => Promise.reject(new Error('no'));
      expect(await new TabPresence(failing).othersOpen()).toBe(true);
    });
  });
});

describe('backups after page operations', () => {
  it('round-trips the order, duplicates, size locks and shared blobs', async () => {
    const free = page({ id: 'free', locked: false, ...A5, images: [image('photo')] });
    const first = page({ id: 'first', locked: true, ...A4 });
    const r = rig([first, free]);
    await r.db.put('subjects', subject({ id: 'sub1' }));
    await r.repos.pages.save(first, free);
    await r.repos.blobs.save('photo', new Blob(['jpeg'], { type: 'image/jpeg' }));
    r.pageOps.duplicate(free);
    r.pageOps.moveTo(first, 2);
    await r.saveQueue.flush();
    const service = new BackupService(r.db, r.repos, () => Promise.resolve(null));
    const doc = await service.readFile(await service.createBackup());
    const target = Database.inMemory();
    const reader = new RecordReader(() => undefined);
    const restored = {
      subjects: new SubjectRepository(target, reader),
      notebooks: new NotebookRepository(target, reader),
      pages: new PageRepository(target, reader),
      blobs: new BlobRepository(target, reader),
    };
    await new BackupService(target, restored, () => Promise.resolve(null)).restore(doc);
    const nb = (await restored.notebooks.all())[0] as Notebook;
    const pages = await restored.pages.loadOrdered(nb);
    expect(ids(pages)).toEqual(['free', 'new1', 'first']);
    expect(pages[0]).toMatchObject({ locked: false, ...A5 });
    expect(pages[1]).toMatchObject({ locked: false, ...A5, images: [image('photo')] });
    expect(pages[2]).toMatchObject({ locked: true, ...A4 });
    expect((await restored.blobs.all()).map((b) => b.id)).toEqual(['photo']);
  });
});
