import { describe, expect, it } from 'vitest';
import { BitmapCache } from '../../src/canvas/BitmapCache';
import { LibraryService } from '../../src/services/LibraryService';
import { BlobRepository } from '../../src/storage/BlobRepository';
import { Database } from '../../src/storage/Database';
import { NotebookRepository } from '../../src/storage/NotebookRepository';
import { PageRepository } from '../../src/storage/PageRepository';
import { RecordReader } from '../../src/storage/RecordReader';
import { SubjectRepository } from '../../src/storage/SubjectRepository';
import { notebook, page, subject } from './fixtures';

/** The library over an in-memory database. */
function library(): { service: LibraryService; blobs: BlobRepository; db: Database } {
  const db = Database.inMemory();
  const reader = new RecordReader(() => undefined);
  const blobs = new BlobRepository(db, reader);
  const repos = {
    subjects: new SubjectRepository(db, reader),
    notebooks: new NotebookRepository(db, reader),
    pages: new PageRepository(db, reader),
    blobs,
  };
  const service = new LibraryService(repos, () => 'id' + Math.random().toString(36).slice(2, 10));
  return { service, blobs, db };
}

const photo = (blob: string) => ({ id: 'im' + blob, x: 0, y: 0, w: 10, h: 10, blob });

describe('regressions found before attachments', () => {
  it('deleting a notebook keeps a blob another notebook still uses', async () => {
    const { service, blobs, db } = library();
    await db.put('subjects', subject());
    await blobs.save('shared', new Blob(['x'], { type: 'image/png' }));
    await db.put('notebooks', notebook({ id: 'nba', pageIds: ['pa'] }));
    await db.put('notebooks', notebook({ id: 'nbb', pageIds: ['pb'] }));
    await db.put('pages', page({ id: 'pa', nbId: 'nba', images: [photo('shared')] }));
    await db.put('pages', page({ id: 'pb', nbId: 'nbb', images: [photo('shared')] }));
    await service.load();
    const first = service.notebooks.find((nb) => nb.id === 'nba');
    if (!first) throw new Error('notebook missing');
    await service.deleteNotebook(first);
    expect(await blobs.get('shared')).not.toBeNull();
  });

  it('deleting a notebook still removes a blob nothing else uses', async () => {
    const { service, blobs, db } = library();
    await db.put('subjects', subject());
    await db.put('blobs', { id: 'own', blob: new Blob(['x'], { type: 'image/png' }) });
    await db.put('notebooks', notebook({ id: 'nba', pageIds: ['pa'] }));
    await db.put('pages', page({ id: 'pa', nbId: 'nba', images: [photo('own')] }));
    await service.load();
    const first = service.notebooks.find((nb) => nb.id === 'nba');
    if (!first) throw new Error('notebook missing');
    await service.deleteNotebook(first);
    expect(await blobs.get('own')).toBeNull();
  });

  it('a page using more bitmaps than the cache holds settles instead of reloading forever', async () => {
    const db = Database.inMemory();
    const blobs = new BlobRepository(db, new RecordReader(() => undefined));
    const ids = ['a', 'b', 'c'];
    for (const id of ids) await blobs.save(id, new Blob([id], { type: 'image/png' }));
    let decodes = 0;
    const cache = new BitmapCache(
      blobs,
      () => {
        decodes++;
        return Promise.resolve({} as ImageBitmap);
      },
      2,
      () => 0,
    );
    // What the renderer does: paint the page, and paint it again each time a bitmap arrives.
    for (let frame = 0; frame < 12; frame++) {
      await Promise.all(ids.map((id) => (cache.get(id), cache.load(id))));
    }
    expect(ids.every((id) => cache.get(id) !== null)).toBe(true);
    expect(decodes).toBe(ids.length);
  });
});
