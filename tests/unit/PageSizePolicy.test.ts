import { describe, expect, it } from 'vitest';
import { PageSizePolicy } from '../../src/domain/PageSizePolicy';
import { notebook, page } from './fixtures';

const A4 = { w: 210, h: 297 };
const A5 = { w: 148, h: 210 };
let n = 0;
const nextId = (): string => 'new' + ++n;

describe('PageSizePolicy', () => {
  it('a locked page always uses the notebook base size', () => {
    const p = page({ locked: true, w: 100, h: 100 });
    PageSizePolicy.enforceLock(p, A4);
    expect([p.w, p.h]).toEqual([210, 297]);
  });

  it('an unlocked page keeps its own size', () => {
    const p = page({ locked: false, ...A5 });
    PageSizePolicy.enforceLock(p, A4);
    expect([p.w, p.h]).toEqual([148, 210]);
  });

  it('re-locking snaps the page back to the base size', () => {
    const p = page({ locked: false, ...A5 });
    expect(PageSizePolicy.setLocked(p, true, A4)).toBe(true);
    expect(p).toMatchObject({ locked: true, ...A4 });
  });

  it('unlocking keeps the current size', () => {
    const p = page({ locked: true, ...A4 });
    expect(PageSizePolicy.setLocked(p, false, A4)).toBe(true);
    expect(p).toMatchObject({ locked: false, ...A4 });
    expect(PageSizePolicy.setLocked(p, false, A4)).toBe(false);
  });

  it('locked pages cannot be resized; unlocked ones can', () => {
    const locked = page({ locked: true, ...A4 });
    expect(PageSizePolicy.resize(locked, 148, 210)).toBe(false);
    expect([locked.w, locked.h]).toEqual([210, 297]);
    const free = page({ locked: false, ...A4 });
    expect(PageSizePolicy.resize(free, 148, 210)).toBe(true);
    expect([free.w, free.h]).toEqual([148, 210]);
  });

  describe('new page after a reference page', () => {
    const nb = notebook({ base: A4, bg: 'gridm' });

    it('copies the lock: locked reference → base size, locked', () => {
      const p = PageSizePolicy.newPageAfter(nb, page({ locked: true, ...A4, bg: 'dots' }), nextId);
      expect(p).toMatchObject({ locked: true, ...A4, bg: 'dots', nbId: 'nb1', bgBlob: null });
    });

    it('copies the lock: unlocked reference → that page’s own size, unlocked', () => {
      const p = PageSizePolicy.newPageAfter(nb, page({ locked: false, ...A5 }), nextId);
      expect(p).toMatchObject({ locked: false, ...A5 });
    });

    it('scenario: unlock → A5 → "+" gives an unlocked A5; re-lock → new pages are base-sized', () => {
      const first = page({ locked: true, ...A4 });
      PageSizePolicy.setLocked(first, false, nb.base);
      PageSizePolicy.resize(first, A5.w, A5.h);
      const added = PageSizePolicy.newPageAfter(nb, first, nextId);
      expect(added).toMatchObject({ locked: false, ...A5 });
      PageSizePolicy.setLocked(first, true, nb.base);
      expect(first).toMatchObject({ locked: true, ...A4 });
      expect(PageSizePolicy.newPageAfter(nb, first, nextId)).toMatchObject({ locked: true, ...A4 });
    });

    it('a page after a PDF page gets the notebook background instead of the PDF', () => {
      const pdf = page({ locked: false, w: 215.9, h: 279.4, bg: 'plain', bgBlob: 'blob1' });
      const p = PageSizePolicy.newPageAfter(nb, pdf, nextId);
      expect(p).toMatchObject({ locked: false, w: 215.9, h: 279.4, bg: 'gridm', bgBlob: null });
    });

    it('without a reference the page is locked, base-sized, with the notebook background', () => {
      expect(PageSizePolicy.newPageAfter(nb, null, nextId)).toMatchObject({
        locked: true,
        ...A4,
        bg: 'gridm',
      });
    });

    it('new pages are empty', () => {
      const p = PageSizePolicy.newPageAfter(nb, page(), nextId);
      expect([p.strokes, p.texts, p.images]).toEqual([[], [], []]);
    });
  });

  it('changing the base size resizes only locked pages', () => {
    const locked = page({ id: 'a', locked: true, ...A4 });
    const free = page({ id: 'b', locked: false, ...A4 });
    const changed = PageSizePolicy.applyBase([locked, free], A5);
    expect(changed.map((p) => p.id)).toEqual(['a']);
    expect([locked.w, locked.h, free.w, free.h]).toEqual([148, 210, 210, 297]);
  });
});
