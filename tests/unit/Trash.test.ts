import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DAY_MS } from '../../src/core/constants';
import type { BlobRecord, Notebook, Page, Subject } from '../../src/core/types';
import { LinkDirectory } from '../../src/domain/LinkDirectory';
import { TrashRules } from '../../src/domain/TrashRules';
import { LibraryService } from '../../src/services/LibraryService';
import { TrashPurger } from '../../src/services/TrashPurger';
import { fakeJpeg, randomFrom, shelf } from './backupHelpers';
import { notebook, page, subject } from './fixtures';

const START = Date.UTC(2026, 10, 1);

async function library() {
  const store = shelf();
  let now = START;
  let id = 0;
  const service = new LibraryService(
    store.repos,
    () => `made${++id}`,
    () => undefined,
    () => new Set<string>(),
    () => undefined,
    () => now,
  );
  await store.repos.subjects.save(subject(), subject({ id: 'sub2', name: 'Физика', order: 1 }));
  await store.repos.notebooks.save(
    notebook(),
    notebook({ id: 'nb2', pageIds: ['pg2'] }),
    notebook({ id: 'nb3', subjectId: 'sub2', pageIds: ['pg3'] }),
  );
  await store.repos.pages.save(page(), page({ id: 'pg2', nbId: 'nb2' }), page({ id: 'pg3', nbId: 'nb3' }));
  await service.load();
  return {
    ...store,
    backup: store.service,
    service,
    setNow: (value: number) => {
      now = value;
    },
    nb: (id: string) => service.notebook(id) as Notebook,
    subj: (id: string) => service.subject(id) as Subject,
  };
}

function imagePage(id: string, nbId: string, blob: string): Page {
  return page({ id, nbId, images: [{ id: `im${id}`, x: 0, y: 0, w: 1, h: 1, blob }] });
}

describe('the Trash rules', () => {
  it('counts the days left, rounding up, between 0 and 30', () => {
    expect(TrashRules.daysLeft(START, START)).toBe(30);
    expect(TrashRules.daysLeft(START, START + 1)).toBe(30);
    expect(TrashRules.daysLeft(START, START + DAY_MS + 1)).toBe(29);
    expect(TrashRules.daysLeft(START, START + 30 * DAY_MS)).toBe(0);
    expect(TrashRules.daysLeft(START, START + 90 * DAY_MS)).toBe(0);
    expect(TrashRules.daysLeft(START + 90 * DAY_MS, START)).toBe(30);
  });

  it('is up at exactly 30 days', () => {
    expect(TrashRules.isExpired(START, START + 30 * DAY_MS - 1)).toBe(false);
    expect(TrashRules.isExpired(START, START + 30 * DAY_MS)).toBe(true);
  });

  it('treats old records without the field as not deleted', () => {
    const shelfOnly = TrashRules.partition([subject()], [notebook()]);
    expect(shelfOnly.subjects).toHaveLength(1);
    expect(shelfOnly.notebooks).toHaveLength(1);
    expect(shelfOnly.trashedSubjects).toEqual([]);
  });

  it('never hides a notebook in use behind a deleted subject', () => {
    const split = TrashRules.partition([subject({ deletedAt: 5 })], [notebook()]);
    expect(split.revived.map((s) => s.id)).toEqual(['sub1']);
    expect(split.subjects.map((s) => s.id)).toEqual(['sub1']);
    expect(split.trashedSubjects).toEqual([]);
  });

  it('lists a notebook under its deleted subject, or on its own when the subject is back', () => {
    const nb = notebook({ deletedAt: 5, deletedWithSubject: true });
    expect(TrashRules.listing([subject({ deletedAt: 5 })], [nb]).notebooks).toEqual([]);
    expect(TrashRules.listing([], [nb]).notebooks).toEqual([nb]);
  });
});

describe('deleting into the Trash', () => {
  it('moves a notebook there and keeps all its data', async () => {
    const { service, repos, nb } = await library();
    await service.deleteNotebook(nb('nb1'));
    expect(service.notebook('nb1')).toBeUndefined();
    expect(service.notebooksOf('sub1').map((n) => n.id)).toEqual(['nb2']);
    expect(service.trash().notebooks.map((n) => n.id)).toEqual(['nb1']);
    expect(await repos.pages.ofNotebook('nb1')).toHaveLength(1);
    const stored = (await repos.notebooks.all()).find((n) => n.id === 'nb1');
    expect(stored?.deletedAt).toBe(START);
  });

  it('survives a reload', async () => {
    const { service, nb } = await library();
    await service.deleteNotebook(nb('nb1'));
    await service.load();
    expect(service.notebook('nb1')).toBeUndefined();
    expect(service.trash().notebooks.map((n) => n.id)).toEqual(['nb1']);
    expect(service.isEmpty).toBe(false);
  });

  it('never seeds a sample over a shelf whose only content is in the Trash', async () => {
    const { service, subj } = await library();
    await service.deleteSubject(subj('sub1'));
    await service.deleteSubject(subj('sub2'));
    expect(service.subjects).toEqual([]);
    expect(service.isEmpty).toBe(false);
  });

  it("takes a subject's notebooks with it, and a restore brings them back", async () => {
    const { service, repos, subj } = await library();
    await service.deleteSubject(subj('sub1'));
    expect(service.subject('sub1')).toBeUndefined();
    expect(service.notebooks.map((n) => n.id)).toEqual(['nb3']);
    expect(service.trash().subjects.map((s) => s.id)).toEqual(['sub1']);
    // Under the subject, not listed separately.
    expect(service.trash().notebooks).toEqual([]);
    expect(service.trashCount).toBe(3);

    const [gone] = service.trash().subjects;
    await service.restoreSubject(gone as Subject);
    expect(service.subject('sub1')?.deletedAt).toBeUndefined();
    expect(
      service
        .notebooksOf('sub1')
        .map((n) => n.id)
        .sort(),
    ).toEqual(['nb1', 'nb2']);
    expect(service.trashCount).toBe(0);
    const stored = await repos.notebooks.all();
    expect(stored.every((n) => n.deletedAt === undefined && !n.deletedWithSubject)).toBe(true);
  });

  it('leaves a notebook deleted earlier in the Trash when the subject comes back', async () => {
    const { service, nb, subj, setNow } = await library();
    await service.deleteNotebook(nb('nb1'));
    setNow(START + DAY_MS);
    await service.deleteSubject(subj('sub1'));
    const listed = service.trash();
    expect(listed.notebooks.map((n) => n.id)).toEqual(['nb1']);
    await service.restoreSubject(listed.subjects[0] as Subject);
    expect(service.notebooksOf('sub1').map((n) => n.id)).toEqual(['nb2']);
    expect(service.trash().notebooks.map((n) => n.id)).toEqual(['nb1']);
    expect(service.trash().notebooks[0]?.deletedAt).toBe(START);
  });

  it('restores a notebook with its deleted subject, says so, and leaves the others on their own', async () => {
    const { service, repos, nb, subj, setNow } = await library();
    await service.deleteNotebook(nb('nb1'));
    setNow(START + DAY_MS);
    await service.deleteSubject(subj('sub1'));
    const lonely = service.trash().notebooks[0] as Notebook;

    const withSubject = await service.restoreNotebook(lonely, 'fallback');

    expect(withSubject?.id).toBe('sub1');
    expect(service.subject('sub1')).toBeDefined();
    expect(service.notebooksOf('sub1').map((n) => n.id)).toEqual(['nb1']);
    // nb2 went with the subject; it is still in the Trash, now listed by itself.
    expect(service.trash().notebooks.map((n) => n.id)).toEqual(['nb2']);
    const stored = (await repos.notebooks.all()).find((n) => n.id === 'nb2');
    expect(stored).toMatchObject({ deletedAt: START + DAY_MS });
    expect(stored?.deletedWithSubject).toBeUndefined();
  });

  it('gives a notebook a new subject if its own is gone for good', async () => {
    const { service, nb, subj } = await library();
    await service.deleteNotebook(nb('nb3'));
    await service.deleteSubject(subj('sub2'));
    const [gone] = service.trash().subjects;
    const lonely = service.trash().notebooks[0] as Notebook;
    // Deleting the subject for good takes its notebooks in the Trash too, so bring back an orphan by hand.
    expect(gone?.id).toBe('sub2');
    lonely.subjectId = 'missing';
    const told = await service.restoreNotebook(lonely, 'Найденные');
    expect(told).toBeNull();
    const home = service.subject(service.notebook('nb3')?.subjectId ?? '');
    expect(home?.name).toBe('Найденные');
  });

  it('a subject gone for good takes all its notebooks in the Trash along', async () => {
    const { service, repos, nb, subj } = await library();
    await service.deleteNotebook(nb('nb1'));
    await service.deleteSubject(subj('sub1'));
    await service.deleteSubjectForever(service.trash().subjects[0] as Subject);
    expect(service.trashCount).toBe(0);
    expect((await repos.notebooks.all()).map((n) => n.id)).toEqual(['nb3']);
    expect((await repos.subjects.all()).map((s) => s.id)).toEqual(['sub2']);
    expect(await repos.pages.ofNotebook('nb1')).toEqual([]);
  });

  it('empties the Trash', async () => {
    const { service, repos, nb, subj } = await library();
    await service.deleteNotebook(nb('nb3'));
    await service.deleteSubject(subj('sub1'));
    await service.emptyTrash();
    expect(service.trashCount).toBe(0);
    expect(await repos.notebooks.all()).toEqual([]);
    expect((await repos.subjects.all()).map((s) => s.id)).toEqual(['sub2']);
  });
});

describe('files of what is in the Trash', () => {
  const photo = new Blob([fakeJpeg(100, randomFrom(3))], { type: 'image/jpeg' });

  it('stay until it is deleted for good, however often a cleanup runs', async () => {
    const { service, repos, db, nb } = await library();
    // Straight to storage: a file saved since the app started is spared by design.
    await db.put('blobs', { id: 'photo', blob: photo } as BlobRecord);
    await repos.pages.save(imagePage('pg1', 'nb1', 'photo'));
    await service.deleteNotebook(nb('nb1'));
    // A fresh repository, as a cleanup after a restart would see it.
    await repos.blobs.sweep(new Set());
    expect(await repos.blobs.get('photo')).not.toBeNull();
    await service.deleteNotebookForever(service.trash().notebooks[0] as Notebook);
    expect(await repos.blobs.get('photo')).toBeNull();
  });

  it('stay while another page shares them', async () => {
    const { service, repos, db, nb } = await library();
    await db.put('blobs', { id: 'photo', blob: photo } as BlobRecord);
    await repos.pages.save(imagePage('pg1', 'nb1', 'photo'), imagePage('pg2', 'nb2', 'photo'));
    await service.deleteNotebook(nb('nb1'));
    await service.deleteNotebookForever(service.trash().notebooks[0] as Notebook);
    expect(await repos.blobs.get('photo')).not.toBeNull();
    await service.deleteNotebook(nb('nb2'));
    await service.deleteNotebookForever(service.trash().notebooks[0] as Notebook);
    expect(await repos.blobs.get('photo')).toBeNull();
  });
});

describe('after 30 days', () => {
  it('removes only what has had its time, with a fake clock', async () => {
    const { service, repos, nb, subj, setNow } = await library();
    await service.deleteNotebook(nb('nb1'));
    setNow(START + 10 * DAY_MS);
    await service.deleteSubject(subj('sub2'));

    expect(await service.purgeExpired(START + 29 * DAY_MS)).toBe(0);
    expect(await service.purgeExpired(START + 30 * DAY_MS)).toBe(1);
    expect((await repos.notebooks.all()).map((n) => n.id).sort()).toEqual(['nb2', 'nb3']);
    expect(await repos.pages.ofNotebook('nb1')).toEqual([]);

    expect(await service.purgeExpired(START + 40 * DAY_MS)).toBe(2);
    expect(service.trashCount).toBe(0);
    expect((await repos.subjects.all()).map((s) => s.id)).toEqual(['sub1']);
  });

  describe('the purger', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    function purger(purgeExpired: () => Promise<number>, others = false) {
      const onPurged = vi.fn();
      const onError = vi.fn();
      const it = new TrashPurger({
        library: { purgeExpired },
        tabs: { othersOpen: () => Promise.resolve(others) },
        now: () => 123,
        onPurged,
        onError,
      });
      return { it, onPurged, onError };
    }

    it('runs on start and hourly, and redraws only when something went', async () => {
      const purge = vi.fn().mockResolvedValueOnce(0).mockResolvedValueOnce(2);
      const { it: run, onPurged } = purger(purge);
      run.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(purge).toHaveBeenCalledTimes(1);
      expect(onPurged).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
      expect(purge).toHaveBeenCalledTimes(2);
      expect(onPurged).toHaveBeenCalledTimes(1);
      run.stop();
    });

    it('waits while another tab is open', async () => {
      const purge = vi.fn().mockResolvedValue(1);
      await purger(purge, true).it.run();
      expect(purge).not.toHaveBeenCalled();
    });

    it('never throws', async () => {
      const { it: run, onError } = purger(() => Promise.reject(new Error('disk')));
      await run.run();
      expect(onError).toHaveBeenCalled();
    });
  });
});

describe('links, search and counts', () => {
  it('a link to something in the Trash is broken, and works again after a restore', async () => {
    const { service, nb } = await library();
    nb('nb1').marks = [{ id: 'an1', pageId: 'pg1', name: 'Интеграл' }];
    const links = new LinkDirectory(service);
    const toAnchor = { kind: 'anchor', nb: 'nb1', id: 'an1' } as const;
    const toPage = { kind: 'page', nb: 'nb1', id: 'pg1' } as const;
    const toNotebook = { kind: 'notebook', nb: 'nb1' } as const;
    expect(links.isBroken(toAnchor)).toBe(false);

    await service.deleteNotebook(nb('nb1'));
    for (const link of [toAnchor, toPage, toNotebook]) expect(links.isBroken(link)).toBe(true);
    expect(links.describe(toAnchor)).toBeNull();
    expect(links.search('Интеграл')).toEqual([]);
    expect(links.search('Лекции').map((e) => e.target)).not.toContainEqual(toNotebook);
    expect(links.notebooksOf('sub1').map((n) => n.id)).toEqual(['nb2']);

    await service.restoreNotebook(service.trash().notebooks[0] as Notebook, 'x');
    for (const link of [toAnchor, toPage, toNotebook]) expect(links.isBroken(link)).toBe(false);
    expect(links.search('Интеграл')).toHaveLength(1);
  });

  it('a link into a deleted subject breaks too, and comes back with it', async () => {
    const { service, subj } = await library();
    const links = new LinkDirectory(service);
    await service.deleteSubject(subj('sub2'));
    expect(links.isBroken({ kind: 'notebook', nb: 'nb3' })).toBe(true);
    expect(links.subjects().map((s) => s.id)).toEqual(['sub1']);
    await service.restoreSubject(service.trash().subjects[0] as Subject);
    expect(links.isBroken({ kind: 'notebook', nb: 'nb3' })).toBe(false);
  });

  it('shelf figures leave the Trash out', async () => {
    const { service, nb } = await library();
    await service.deleteNotebook(nb('nb1'));
    expect(service.notebooks).toHaveLength(2);
    expect(service.sortedSubjects()).toHaveLength(2);
  });
});

describe('backups and the Trash', () => {
  it('a backup keeps it, with the dates', async () => {
    const source = await library();
    await source.service.deleteNotebook(source.nb('nb1'));
    source.setNow(START + 3 * DAY_MS);
    await source.service.deleteSubject(source.subj('sub2'));
    const target = shelf();
    await target.service.restore(await target.service.readFile((await source.backup.createBackup()).file));
    const restored = new LibraryService(target.repos, () => 'x');
    await restored.load();
    expect(restored.trash().notebooks.map((n) => [n.id, n.deletedAt])).toEqual([['nb1', START]]);
    expect(restored.trash().subjects.map((s) => [s.id, s.deletedAt])).toEqual([['sub2', START + 3 * DAY_MS]]);
    expect(restored.deletedWith(restored.trash().subjects[0] as Subject).map((n) => n.id)).toEqual(['nb3']);
  });

  it('an old backup without the fields restores with an empty Trash', async () => {
    const source = shelf();
    await source.repos.subjects.save(subject());
    await source.repos.notebooks.save(notebook());
    const target = shelf();
    await target.service.restore(await target.service.readFile((await source.service.createBackup()).file));
    const restored = new LibraryService(target.repos, () => 'x');
    await restored.load();
    expect(restored.trashCount).toBe(0);
    expect(restored.notebooks).toHaveLength(1);
  });

  it('a stored subject brought back by a restored notebook is saved as not deleted', async () => {
    const store = shelf();
    await store.repos.subjects.save(subject({ deletedAt: START }));
    await store.repos.notebooks.save(notebook());
    const service = new LibraryService(store.repos, () => 'x');
    await service.load();
    expect(service.subject('sub1')).toBeDefined();
    expect((await store.repos.subjects.all())[0]?.deletedAt).toBeUndefined();
  });

  it('rejects a backup with a nonsense deletion date', async () => {
    const source = shelf();
    await source.db.put('subjects', { ...subject(), deletedAt: 'yesterday' } as unknown as Subject);
    expect(await source.repos.subjects.all()).toEqual([]);
  });
});
