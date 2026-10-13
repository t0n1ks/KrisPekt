import { describe, expect, it } from 'vitest';
import { PageCache } from '../../src/canvas/PageCache';
import { PageLayout } from '../../src/canvas/PageLayout';
import { GAP, MM } from '../../src/core/constants';
import type { Box, Stroke, TextItem } from '../../src/core/types';
import { History } from '../../src/domain/History';
import { ItemTransform } from '../../src/domain/ItemTransform';
import { PageRepair } from '../../src/domain/PageRepair';
import { SelectionPlacement } from '../../src/domain/SelectionPlacement';
import { page } from './fixtures';

const A4_W = 210 * MM;
const A4_H = 297 * MM;

/** Three A4 pages stacked like the editor lays them out. */
function stack(): { x: number; y: number; w: number; h: number }[] {
  return [0, 1, 2].map((i) => ({ x: -A4_W / 2, y: i * (A4_H + GAP), w: A4_W, h: A4_H }));
}

describe('SelectionPlacement.targetIndex', () => {
  const pages = stack();

  it('picks the page under the centre', () => {
    expect(SelectionPlacement.targetIndex(pages, { x: 0, y: A4_H + GAP + 100 })).toBe(1);
    expect(SelectionPlacement.targetIndex(pages, { x: 0, y: 10 })).toBe(0);
  });

  it('picks the nearest page when the centre is in the gap', () => {
    expect(SelectionPlacement.targetIndex(pages, { x: 0, y: A4_H + 5 })).toBe(0);
    expect(SelectionPlacement.targetIndex(pages, { x: 0, y: A4_H + GAP - 5 })).toBe(1);
  });

  it('picks the first and last page beyond the ends of the stack', () => {
    expect(SelectionPlacement.targetIndex(pages, { x: 0, y: -500 })).toBe(0);
    expect(SelectionPlacement.targetIndex(pages, { x: 3000, y: 10 * A4_H })).toBe(2);
    expect(SelectionPlacement.targetIndex([], { x: 0, y: 0 })).toBe(-1);
  });
});

describe('SelectionPlacement.clampShift', () => {
  it('leaves a group inside the page alone (same-page move)', () => {
    expect(SelectionPlacement.clampShift({ x: 50, y: 60, w: 100, h: 40 }, 800, 1100)).toEqual({ x: 0, y: 0 });
  });

  it('shifts a group past the right/bottom edge back in', () => {
    expect(SelectionPlacement.clampShift({ x: 750, y: 1080, w: 100, h: 40 }, 800, 1100)).toEqual({
      x: -50,
      y: -20,
    });
  });

  it('shifts negative coordinates to the edge', () => {
    expect(SelectionPlacement.clampShift({ x: -30, y: -200, w: 100, h: 40 }, 800, 1100)).toEqual({
      x: 30,
      y: 200,
    });
  });

  it('aligns a group larger than the page to its top-left corner, without scaling', () => {
    expect(SelectionPlacement.clampShift({ x: 40, y: -10, w: 900, h: 1500 }, 800, 1100)).toEqual({
      x: -40,
      y: 10,
    });
  });
});

describe('moving items between pages', () => {
  it('converts page-local coordinates through the layout and finds the target page', () => {
    const p1 = page({ id: 'p1' });
    const p2 = page({ id: 'p2' });
    const layout = new PageLayout();
    layout.update([p1, p2]);
    // A point 40 px below page 1's bottom edge, given in page 1 coordinates…
    const local = { x: 100, y: A4_H + GAP + 40 };
    const world = { x: layout.pos(p1).x + local.x, y: layout.pos(p1).y + local.y };
    expect(layout.nearestPage(world)).toBe(p2);
    // …is 40 px below page 2's top edge.
    expect(layout.toPage(p2, world)).toEqual({ x: 100, y: 40 });
    expect(layout.nearestPage({ x: 0, y: A4_H + 2 })).toBe(p1);
  });

  it('splits selected items off and maps them with scale and offset', () => {
    const p = page();
    const { picked, rest } = ItemTransform.split(p, new Set(['tx1']));
    expect(picked.texts.map((t) => t.id)).toEqual(['tx1']);
    expect(rest.texts).toEqual([]);
    expect(rest.strokes).toHaveLength(1);
    const [moved] = ItemTransform.map(picked, { ox: 75, oy: 58, k: 2, dx: 10, dy: -1000 }).texts;
    expect(moved).toMatchObject({ x: 85, y: -942, w: 1200, fs: 40 });
    // The original is untouched (history snapshots share it).
    expect(p.texts[0]).toMatchObject({ x: 75, y: 58, fs: 20 });
  });
});

describe('History with multi-page entries', () => {
  it('undoes and redoes a cross-page move as one step that restores both pages', () => {
    const p1 = page({ id: 'p1' });
    const p2 = page({ id: 'p2', texts: [] });
    const pages = new Map([
      ['p1', p1],
      ['p2', p2],
    ]);
    const find = (id: string) => pages.get(id);
    const history = new History();
    history.record(p1, p2);
    const text = p1.texts[0];
    if (!text) throw new Error('fixture');
    p1.texts = [];
    p2.texts = [{ ...text, y: 40 }];

    const undone = history.undo(find);
    expect(undone?.pages).toEqual([p1, p2]);
    expect(p1.texts).toEqual([text]);
    expect(p2.texts).toEqual([]);
    expect(history.canUndo).toBe(false);

    history.redo(find);
    expect(p1.texts).toEqual([]);
    expect(p2.texts).toEqual([{ ...text, y: 40 }]);
    history.undo(find);
    expect(p1.texts).toEqual([text]);
    expect(p2.texts).toEqual([]);
  });

  it('keeps the rest of an entry when one of its pages is deleted', () => {
    const p1 = page({ id: 'p1' });
    const history = new History();
    history.record(p1, page({ id: 'p2' }));
    p1.strokes = [];
    history.dropPage('p2');
    expect(history.undo((id) => (id === 'p1' ? p1 : undefined))?.pages).toEqual([p1]);
    expect(p1.strokes).toHaveLength(1);
  });
});

describe('PageRepair', () => {
  const boxes = {
    stroke: (s: Stroke): Box => {
      const xs = Array.from(s.p).filter((_, i) => i % 3 === 0);
      const ys = Array.from(s.p).filter((_, i) => i % 3 === 1);
      return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
    },
    text: (t: TextItem): Box => ({ x0: t.x, y0: t.y, x1: t.x + t.w, y1: t.y + 27 }),
  };

  it('moves an item lying completely outside its page back inside', () => {
    const lost = page({
      strokes: [
        { id: 'st1', k: 'pen', c: '#000000', s: 2, p: new Float32Array([100, 1300, 0.5, 140, 1320, 0.5]) },
      ],
      texts: [{ id: 'tx1', x: 75, y: A4_H + 200, w: 300, t: 'lost', fs: 20, c: '#000000' }],
    });
    expect(PageRepair.repair(lost, boxes)).toBe(2);
    expect(Array.from(lost.strokes[0]?.p ?? [])).toEqual([
      100,
      expect.closeTo(A4_H - 20, 3),
      0.5,
      140,
      expect.closeTo(A4_H, 3),
      0.5,
    ]);
    expect(lost.texts[0]?.y).toBeCloseTo(A4_H - 27, 3);
    expect(lost.texts[0]?.x).toBe(75);
  });

  it('leaves items that are inside or only partly outside', () => {
    const partly = page({
      texts: [{ id: 'tx1', x: A4_W - 100, y: 50, w: 300, t: 'edge', fs: 20, c: '#000000' }],
    });
    const before = partly.texts;
    expect(PageRepair.repair(partly, boxes)).toBe(0);
    expect(partly.texts).toEqual(before);
    expect(partly.strokes[0]?.p[1]).toBeCloseTo(20.456, 3);
  });
});

describe('PageCache validity', () => {
  it('never reuses a bitmap with a stale revision or skip key, whatever the scale', () => {
    const entry = { revision: 7, skipKey: '' };
    expect(PageCache.isReusable(entry, 7, '')).toBe(true);
    expect(PageCache.isReusable(entry, 8, '')).toBe(false);
    expect(PageCache.isReusable(entry, 7, 's3')).toBe(false);
    expect(PageCache.isReusable({ revision: 7, skipKey: 's3' }, 7, 's4')).toBe(false);
    expect(PageCache.isReusable({ revision: 7, skipKey: 'e1' }, 7, '')).toBe(false);
  });

  it('keeps the revision with the bitmap separately from the scale', () => {
    expect(PageCache.key(1.5, 7, '')).not.toBe(PageCache.key(2, 7, ''));
    expect(PageCache.key(1.5, 7, '')).not.toBe(PageCache.key(1.5, 8, ''));
  });
});
