import { describe, expect, it, vi } from 'vitest';
import { LinkGeometry } from '../../src/canvas/LinkGeometry';
import type { Anchor, InternalLink, Page, Point, TextItem } from '../../src/core/types';
import { AnchorMarks } from '../../src/domain/AnchorMarks';
import { PagePressTargets } from '../../src/editor/PagePressTargets';
import { AnchorController } from '../../src/ui/editor/AnchorController';

const RECT = { x: 100, y: 200, w: 50, h: 20 };
const TARGET: InternalLink = { kind: 'anchor', nb: 'nb1', id: 'an1' };

function anchor(overrides: Partial<Anchor> = {}): Anchor {
  return { id: 'an1', name: 'Theorem', items: ['st1'], rect: RECT, ...overrides };
}

function page(overrides: Partial<Page> = {}): Page {
  return {
    id: 'pg1',
    nbId: 'nb1',
    w: 210,
    h: 297,
    locked: false,
    bg: 'plain',
    bgBlob: null,
    strokes: [],
    texts: [],
    images: [],
    cards: [],
    anchors: [],
    inkLinks: [],
    updatedAt: 1,
    ...overrides,
  };
}

function text(paras: TextItem['paras'] = [], t = ''): TextItem {
  return { id: 'tx1', x: 0, y: 0, w: 100, t, fs: 14, c: '#000000', paras };
}

function setup(
  p: Page,
  answers: { name?: string | null; links?: number; confirm?: boolean } = {},
): {
  controller: AnchorController;
  toast: ReturnType<typeof vi.fn>;
  remember: ReturnType<typeof vi.fn>;
  confirm: ReturnType<typeof vi.fn>;
  record: ReturnType<typeof vi.fn>;
  ask: ReturnType<typeof vi.fn>;
} {
  const toast = vi.fn();
  const remember = vi.fn();
  const confirm = vi.fn().mockResolvedValue(answers.confirm ?? true);
  const record = vi.fn();
  const ask = vi.fn().mockResolvedValue(answers.name === undefined ? 'Named' : answers.name);
  const controller = new AnchorController({
    i18n: { t: (key: string, vars?: Record<string, unknown>) => `${key}${JSON.stringify(vars ?? '')}` },
    dialog: { ask },
    dialogs: { confirm },
    countLinks: () => Promise.resolve(answers.links ?? 0),
    session: { pages: [p], has: () => true, indexOf: () => 0, touch: vi.fn() },
    undo: { record },
    geometry: { anchorBox: () => ({ x0: 1, y0: 2, x1: 3, y1: 4 }) },
    clipboard: { copy: vi.fn() },
    makeId: () => 'new1',
    toast,
    remember,
  } as never);
  return { controller, toast, remember, confirm, record, ask };
}

describe('Make link', () => {
  it('asks for a name, saves the bookmark, says so and puts it first in the recent list', async () => {
    const p = page({ texts: [text([], 'Chapter one\nmore')] });
    const { controller, toast, remember, ask, record } = setup(p);
    expect(await controller.addToItems(p, new Set(['tx1']))).toBe(true);
    expect(ask).toHaveBeenCalledWith(expect.stringContaining('linkMakeTitle'), 'Chapter one');
    expect(p.anchors.map((a) => a.name)).toEqual(['Named']);
    expect(record).toHaveBeenCalledOnce();
    expect(remember).toHaveBeenCalledWith({ kind: 'anchor', nb: 'nb1', id: 'new1' });
    expect(toast.mock.calls[0]?.[0]).toContain('bookmarkSaved');
    expect(toast.mock.calls[0]?.[0]).toContain('Named');
  });

  it('names a card after itself', async () => {
    const p = page();
    const { controller, ask } = setup(p);
    await controller.addToCard(p, { id: 'c1', kind: 'link', title: 'Site' } as never);
    expect(ask).toHaveBeenCalledWith(expect.anything(), 'Site');
    expect(p.anchors[0]?.items).toEqual(['c1']);
  });

  it('does nothing when the name is cancelled', async () => {
    const p = page();
    const { controller, toast, remember, record } = setup(p, { name: null });
    expect(await controller.addToPage(p)).toBe(false);
    expect(p.anchors).toEqual([]);
    expect(toast).not.toHaveBeenCalled();
    expect(remember).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });
});

describe('removing a bookmark', () => {
  it('asks nothing when no link leads there', async () => {
    const p = page({ anchors: [anchor()] });
    const { controller, confirm, record } = setup(p);
    await controller.remove('an1');
    expect(confirm).not.toHaveBeenCalled();
    expect(record).toHaveBeenCalledOnce();
    expect(p.anchors).toEqual([]);
  });

  it('warns how many links stop working, and it is one undo step', async () => {
    const p = page({ anchors: [anchor()] });
    const { controller, confirm, record } = setup(p, { links: 3 });
    await controller.remove('an1');
    expect(confirm.mock.calls[0]?.[1]).toContain('"n":3');
    expect(record).toHaveBeenCalledOnce();
    expect(record).toHaveBeenCalledWith(p);
    expect(p.anchors).toEqual([]);
  });

  it('keeps it when the warning is declined', async () => {
    const p = page({ anchors: [anchor()] });
    const { controller, record } = setup(p, { links: 1, confirm: false });
    await controller.remove('an1');
    expect(p.anchors).toHaveLength(1);
    expect(record).not.toHaveBeenCalled();
  });

  it('from a selection takes only what the selection covers, in one step', async () => {
    const whole = anchor({ id: 'an2', items: [] });
    const other = anchor({ id: 'an3', items: ['st9'] });
    const p = page({ anchors: [anchor(), whole, other] });
    const { controller, record } = setup(p);
    await controller.removeOn(p, new Set(['st1']), null);
    expect(p.anchors.map((a) => a.id)).toEqual(['an2', 'an3']);
    expect(record).toHaveBeenCalledOnce();
  });

  it('a marker offers rename, copy link and remove', () => {
    const p = page({ anchors: [anchor()] });
    const { controller } = setup(p);
    const entries = controller.markerEntries(p, anchor());
    const labels = entries.flatMap((entry) => (entry === '-' ? [] : [entry.label.split('"')[0]]));
    expect(labels).toEqual(['bookmarkRename', 'cardCopyLink', 'bookmarkDelete']);
  });
});

describe('AnchorMarks.on', () => {
  it('needs all of the anchor inside the selection', () => {
    const p = page({ anchors: [anchor({ items: ['a', 'b'] })] });
    expect(AnchorMarks.on(p, new Set(['a']))).toEqual([]);
    expect(AnchorMarks.on(p, new Set(['a', 'b', 'c']))).toHaveLength(1);
  });

  it('with a range takes the stretches that overlap it', () => {
    const p = page({ anchors: [anchor({ items: ['tx1'], range: [2, 5] })] });
    const ids = new Set(['tx1']);
    expect(AnchorMarks.on(p, ids, [4, 9])).toHaveLength(1);
    expect(AnchorMarks.on(p, ids, [5, 9])).toEqual([]);
    expect(AnchorMarks.on(p, ids, null)).toHaveLength(1);
  });

  it('a bookmark on the whole box is found from any range', () => {
    const p = page({ anchors: [anchor({ items: ['tx1'] })] });
    expect(AnchorMarks.on(p, new Set(['tx1']), [1, 2])).toHaveLength(1);
  });
});

describe('AnchorMarks.incoming', () => {
  it('counts ink and words, and a word split into runs once', () => {
    const p = page({
      inkLinks: [
        { id: 'i1', items: ['s'], rect: RECT, link: TARGET },
        { id: 'i2', items: ['s'], rect: RECT, link: { kind: 'url', href: 'https://example.com/' } },
      ],
      texts: [
        text([
          {
            runs: [
              { t: 'a', link: TARGET },
              { t: 'b', b: true, link: TARGET },
              { t: ' plain ' },
              { t: 'c', link: TARGET },
            ],
          },
          { runs: [{ t: 'd', link: { kind: 'anchor', nb: 'nb1', id: 'other' } }] },
        ]),
      ],
    });
    expect(AnchorMarks.incoming([p], [TARGET])).toBe(3);
  });

  it('adds up over several places and pages', () => {
    const second: InternalLink = { kind: 'anchor', nb: 'nb1', id: 'an2' };
    const on = (link: InternalLink): Page =>
      page({ inkLinks: [{ id: 'i', items: ['s'], rect: RECT, link }] });
    expect(AnchorMarks.incoming([on(TARGET), on(second)], [TARGET, second])).toBe(2);
    expect(AnchorMarks.incoming([], [TARGET])).toBe(0);
  });
});

describe('a press on a marker', () => {
  const geometry = new LinkGeometry(
    { bbox: () => ({ x0: 100, y0: 200, x1: 150, y1: 220 }) } as never,
    {} as never,
  );

  function targets(
    p: Page,
    options: { markers?: boolean; z?: number; tool?: string } = {},
  ): PagePressTargets {
    return new PagePressTargets({
      camera: { z: options.z ?? 1, toWorld: (x: number, y: number): Point => ({ x, y }) },
      layout: { pageAt: () => p, toPage: (_p: Page, at: Point) => at },
      texts: { linkAt: () => null },
      geometry,
      markersOn: () => options.markers ?? true,
      tool: () => options.tool ?? 'pen',
      overSelection: () => false,
    } as never);
  }
  const marked = (): Page => page({ anchors: [anchor()], strokes: [{ id: 'st1' } as never] });

  it('finds the bookmark, with a finger-sized reach at any zoom', () => {
    // The marker of a stroke at x 100 is at x 87..96, y 200..213.
    expect(targets(marked()).at({ x: 90, y: 205 })?.kind).toBe('anchor');
    expect(targets(marked()).at({ x: 72, y: 205 })?.kind).toBe('anchor');
    expect(targets(marked()).at({ x: 60, y: 205 })).toBeNull();
    expect(targets(marked(), { z: 2 }).at({ x: 72, y: 205 })).toBeNull();
    expect(targets(marked(), { z: 0.5 }).at({ x: 60, y: 205 })?.kind).toBe('anchor');
  });

  it('does not take a press on what the bookmark marks', () => {
    expect(targets(marked()).at({ x: 105, y: 205 })).toBeNull();
  });

  it('the corner of the page marks a whole-page bookmark', () => {
    const p = page({ anchors: [anchor({ items: [] })] });
    expect(targets(p).at({ x: 8, y: 8 })?.kind).toBe('anchor');
    expect(targets(p).at({ x: 300, y: 300 })).toBeNull();
  });

  it('works with the text tool, but not with markers off', () => {
    expect(targets(marked(), { tool: 'text' }).at({ x: 90, y: 205 })?.kind).toBe('anchor');
    expect(targets(marked(), { markers: false }).at({ x: 90, y: 205 })).toBeNull();
  });
});
