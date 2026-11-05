import { describe, expect, it, vi } from 'vitest';
import { History } from '../../src/domain/History';
import { Database } from '../../src/storage/Database';
import { NotebookRepository } from '../../src/storage/NotebookRepository';
import { PageRepository } from '../../src/storage/PageRepository';
import { RecordReader } from '../../src/storage/RecordReader';
import { SaveQueue } from '../../src/storage/SaveQueue';
import { notebook, page } from './fixtures';

function storage() {
  const db = Database.inMemory();
  const reader = new RecordReader(() => undefined);
  const pages = new PageRepository(db, reader);
  const notebooks = new NotebookRepository(db, reader);
  const onError = vi.fn();
  return { db, pages, notebooks, onError, queue: new SaveQueue(pages, onError) };
}

describe('page order regressions', () => {
  it('shows a page once even if the stored order lists it twice', async () => {
    const { pages } = storage();
    await pages.save(page({ id: 'p1' }), page({ id: 'p2' }));
    const ordered = await pages.loadOrdered(notebook({ pageIds: ['p1', 'p2', 'p1'] }));
    expect(ordered.map((p) => p.id)).toEqual(['p1', 'p2']);
  });

  it('writes new pages and the page order in one transaction', async () => {
    const { db, queue } = storage();
    queue.setNotebook(notebook({ pageIds: ['p1'] }));
    queue.markPageDirty(page({ id: 'p1' }));
    const write = vi.spyOn(db, 'writeAcross');
    await queue.flush();
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0]?.[0].map((w) => w.store).sort()).toEqual(['notebooks', 'pages']);
  });

  it('retries a page order that failed to save', async () => {
    const { db, notebooks, onError, queue } = storage();
    const nb = notebook({ pageIds: ['p2', 'p1'] });
    queue.setNotebook(nb);
    queue.markNotebookDirty();
    vi.spyOn(db, 'writeAcross').mockRejectedValueOnce(new Error('disk full'));
    await queue.flush();
    expect(onError).toHaveBeenCalledTimes(1);
    await queue.flush();
    expect((await notebooks.all())[0]?.pageIds).toEqual(['p2', 'p1']);
  });

  it('forgets a whole undo step when one of its pages is deleted', () => {
    const a = page({ id: 'a' });
    const b = page({ id: 'b' });
    const history = new History();
    // A selection moved from a to b is one step over both pages.
    history.record(a, b);
    history.dropPage('a');
    expect(history.canUndo).toBe(false);
  });
});
