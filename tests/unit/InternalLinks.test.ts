// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { LinkGeometry } from '../../src/canvas/LinkGeometry';
import { LinkMarkPainter } from '../../src/canvas/LinkMarkPainter';
import { PAPER } from '../../src/core/constants';
import type {
  Anchor,
  Box,
  InkLink,
  InternalLink,
  LinkTarget,
  Notebook,
  Page,
  Stroke,
} from '../../src/core/types';
import { AnchorMarks } from '../../src/domain/AnchorMarks';
import { History } from '../../src/domain/History';
import { ItemBindings } from '../../src/domain/ItemBindings';
import { LinkDirectory, type LibrarySource } from '../../src/domain/LinkDirectory';
import { LinkRules } from '../../src/domain/LinkRules';
import { NavigationStack } from '../../src/domain/NavigationStack';
import { PdfLinkMap } from '../../src/domain/PdfLinkMap';
import { RichText } from '../../src/domain/RichText';
import { SelectionClipboard } from '../../src/domain/SelectionClipboard';
import { TableOfContents } from '../../src/domain/TableOfContents';
import { BindingKeeper } from '../../src/editor/BindingKeeper';
import { PageOperations } from '../../src/editor/PageOperations';
import { PagePressTargets } from '../../src/editor/PagePressTargets';
import { Viewport } from '../../src/editor/Viewport';
import { SystemBackGuard } from '../../src/input/SystemBackGuard';
import { PreferencesStore } from '../../src/storage/PreferencesStore';
import { parseBackup } from '../../src/storage/validation/backup';
import { parsePage } from '../../src/storage/validation/records';
import { defaultAnchorName } from '../../src/ui/editor/AnchorController';
import { backupJson, notebook, page, subject } from './fixtures';

const RECT = { x: 1, y: 2, w: 3, h: 4 };

function anchor(overrides: Partial<Anchor> = {}): Anchor {
  return { id: 'an1', name: 'Theorem', items: ['st1'], rect: RECT, ...overrides };
}

function inkLink(overrides: Partial<InkLink> = {}): InkLink {
  return {
    id: 'ink1',
    items: ['st1'],
    rect: RECT,
    link: { kind: 'page', nb: 'nb1', id: 'pg1' },
    ...overrides,
  };
}

/** A box for each item: strokes by the first point, one unit big. */
function geometry(): LinkGeometry {
  const bbox = (stroke: Stroke): Box => {
    const [x = 0, y = 0] = stroke.p;
    return { x0: x, y0: y, x1: x + 1, y1: y + 1 };
  };
  const texts = {
    box: (t: { x: number; y: number }): Box => ({ x0: t.x, y0: t.y, x1: t.x + 10, y1: t.y + 10 }),
    migrated: (t: unknown) => t,
    glyphs: () => [
      { start: 0, end: 1, x0: 100, y0: 100, x1: 110, y1: 120 },
      { start: 1, end: 2, x0: 110, y0: 100, x1: 120, y1: 120 },
    ],
  };
  return new LinkGeometry({ bbox } as never, texts as never);
}

function keeperFor(
  pages: Page[],
  nb: Notebook,
): { keeper: BindingKeeper; bump: ReturnType<typeof vi.fn>; dirty: ReturnType<typeof vi.fn> } {
  const bump = vi.fn();
  const dirty = vi.fn();
  const keeper = new BindingKeeper({
    session: { notebook: nb, pages, bump } as never,
    geometry: geometry(),
    markNotebookDirty: dirty,
  });
  return { keeper, bump, dirty };
}

function library(notebooks: Notebook[]): LibrarySource {
  const subjects = [subject()];
  return {
    notebook: (id) => notebooks.find((nb) => nb.id === id),
    subject: (id) => subjects.find((s) => s.id === id),
    sortedSubjects: () => subjects,
    notebooksOf: (id) => notebooks.filter((nb) => nb.subjectId === id),
  };
}

describe('anchors', () => {
  it('are named after their text, or after the page without any', () => {
    expect(defaultAnchorName('\n  Chapter 1\nmore', 'Page 3')).toBe('Chapter 1');
    expect(defaultAnchorName(null, 'Page 3')).toBe('Page 3');
    expect(defaultAnchorName('   ', 'Page 3')).toBe('Page 3');
    expect(defaultAnchorName('x'.repeat(200), 'P').length).toBeLessThanOrEqual(80);
  });

  it('from a lasso selection follow their items when these move', () => {
    const p = page({ anchors: [anchor()] });
    const nb = notebook({ pageIds: [p.id] });
    keeperFor([p], nb).keeper.pageChanged(p);
    expect(p.anchors[0]?.rect).toEqual({ x: 10.123000144958496, y: 20.45599937438965, w: 1, h: 1 });
    p.strokes = [{ ...(p.strokes[0] as Stroke), p: new Float32Array([50, 60, 0.5]) }];
    keeperFor([p], nb).keeper.pageChanged(p);
    expect(p.anchors[0]?.rect).toEqual({ x: 50, y: 60, w: 1, h: 1 });
  });

  it('from a stretch of text cover its glyphs, and the box when these are gone', () => {
    const p = page();
    const within = anchor({ items: ['tx1'], range: [0, 2] });
    expect(geometry().anchorBox(p, within)).toEqual({ x0: 100, y0: 100, x1: 120, y1: 120 });
    const past = anchor({ items: ['tx1'], range: [5, 9] });
    expect(geometry().anchorBox(p, past)).toEqual({ x0: 75, y0: 58, x1: 85, y1: 68 });
  });

  it('of a whole page cover the page and outlive anything on it', () => {
    const p = page({ anchors: [anchor({ items: [] })] });
    expect(geometry().anchorBox(p, p.anchors[0] as Anchor)).toEqual({
      x0: 0,
      y0: 0,
      x1: expect.any(Number),
      y1: expect.any(Number),
    });
    p.strokes = [];
    keeperFor([p], notebook()).keeper.pageChanged(p);
    expect(p.anchors).toHaveLength(1);
  });

  it('use the stored rect when their items cannot be measured', () => {
    const p = page({ strokes: [] });
    expect(geometry().anchorBox(p, anchor())).toEqual({ x0: 1, y0: 2, x1: 4, y1: 6 });
  });

  it('go when their last item goes, and keep what else they cover', () => {
    const second: Stroke = { id: 'st2', k: 'pen', c: '#000000', s: 1, p: new Float32Array([5, 5, 1]) };
    const p = page({
      strokes: [second],
      anchors: [anchor({ items: ['st1', 'st2'] }), anchor({ id: 'an2' })],
    });
    keeperFor([p], notebook()).keeper.pageChanged(p);
    expect(p.anchors.map((a) => a.id)).toEqual(['an1']);
    expect(p.anchors[0]?.items).toEqual(['st2']);
  });

  it('are listed by page and then from the top down', () => {
    const pages = [
      {
        id: 'a',
        anchors: [
          anchor({ id: 'low', rect: { ...RECT, y: 90 } }),
          anchor({ id: 'high', rect: { ...RECT, y: 10 } }),
          anchor({ id: 'whole', items: [], rect: { ...RECT, y: 500 } }),
        ],
      },
      { id: 'b', anchors: [anchor({ id: 'next' })] },
    ];
    expect(AnchorMarks.of(pages).map((m) => m.id)).toEqual(['whole', 'high', 'low', 'next']);
  });

  it('are kept on the notebook, saved, and redraw links only when one could change', () => {
    const linked = page({ inkLinks: [inkLink()] });
    const nb = notebook();
    const { keeper, bump, dirty } = keeperFor([linked], nb);
    keeper.opened();
    expect(bump).toHaveBeenCalledTimes(1);
    expect(dirty).not.toHaveBeenCalled();
    keeper.pageChanged(linked);
    expect(bump).toHaveBeenCalledTimes(1);
    linked.anchors = [anchor()];
    keeper.pageChanged(linked);
    expect(nb.marks?.map((m) => m.id)).toEqual(['an1']);
    expect(dirty).toHaveBeenCalledTimes(1);
    expect(bump).toHaveBeenCalledTimes(2);
  });

  it('move to another page with all of their items, and only then', () => {
    const source = page({
      anchors: [anchor(), anchor({ id: 'both', items: ['st1', 'st2'] }), anchor({ id: 'whole', items: [] })],
      inkLinks: [inkLink()],
    });
    const target = page({ id: 'pg2', strokes: [] });
    ItemBindings.carry(source, target, new Set(['st1']));
    expect(target.anchors.map((a) => a.id)).toEqual(['an1']);
    expect(target.inkLinks.map((l) => l.id)).toEqual(['ink1']);
    expect(source.anchors.map((a) => a.id)).toEqual(['both', 'whole']);
  });

  it('follow a stroke the eraser cut in two', () => {
    const p = page({ anchors: [anchor()], inkLinks: [inkLink()] });
    ItemBindings.replaceItem(p, 'st1', ['part1', 'part2']);
    expect(p.anchors[0]?.items).toEqual(['part1', 'part2']);
    expect(p.inkLinks[0]?.items).toEqual(['part1', 'part2']);
    ItemBindings.replaceItem(p, 'part1', []);
    expect(p.inkLinks[0]?.items).toEqual(['part2']);
  });
});

describe('a link', () => {
  it('compares by where it leads', () => {
    const a: LinkTarget = { kind: 'anchor', nb: 'n', id: 'x' };
    expect(LinkRules.same(a, { kind: 'anchor', nb: 'n', id: 'x' })).toBe(true);
    expect(LinkRules.same(a, { kind: 'page', nb: 'n', id: 'x' })).toBe(false);
    expect(LinkRules.same(a, { kind: 'url', href: 'https://a.b/' })).toBe(false);
    expect(LinkRules.same(undefined, undefined)).toBe(true);
    expect(LinkRules.same(a, undefined)).toBe(false);
  });

  it('in a text run is validated by kind and ids', () => {
    const run = (link: unknown): unknown =>
      page({
        texts: [
          {
            id: 't',
            x: 0,
            y: 0,
            w: 9,
            t: 'a',
            fs: 12,
            c: '#000000',
            paras: [{ runs: [{ t: 'a', link }] }],
          } as never,
        ],
      });
    const parse = (link: unknown): Page => parsePage(JSON.parse(JSON.stringify(run(link), jsonPoints)));
    const good = parse({ kind: 'anchor', nb: 'nb1', id: 'an1', extra: 'dropped' });
    expect(good.texts[0]?.paras?.[0]?.runs[0]?.link).toEqual({ kind: 'anchor', nb: 'nb1', id: 'an1' });
    expect(parse({ kind: 'notebook', nb: 'nb1' }).texts).toHaveLength(1);
    expect(() => parse({ kind: 'anchor', nb: 'nb1' })).toThrow();
    expect(() => parse({ kind: 'anchor', nb: '../x', id: 'a' })).toThrow();
    expect(() => parse({ kind: 'file', nb: 'nb1', id: 'a' })).toThrow();
    expect(() => parse({ kind: 'url', href: 'java' + 'script:alert(1)' })).toThrow();
  });

  it('on a card can only be a web address', () => {
    const card = {
      id: 'c',
      kind: 'link',
      x: 0,
      y: 0,
      w: 100,
      h: 50,
      title: 'x',
      link: { kind: 'page', nb: 'nb1', id: 'pg1' },
    };
    expect(() =>
      parsePage(JSON.parse(JSON.stringify(page({ cards: [card as never] }), jsonPoints))),
    ).toThrow();
  });

  it('on ink needs items', () => {
    const parse = (ink: unknown): Page =>
      parsePage(JSON.parse(JSON.stringify(page({ inkLinks: [ink as InkLink] }), jsonPoints)));
    expect(parse(inkLink()).inkLinks).toHaveLength(1);
    expect(() => parse(inkLink({ items: [] }))).toThrow();
    expect(() => parse(inkLink({ items: ['bad id!'] }))).toThrow();
  });

  it('without a target is broken, and valid again when the target is back', () => {
    const nb = notebook({ pageIds: ['pg1'], marks: [{ id: 'an1', pageId: 'pg1', name: 'T' }] });
    const directory = new LinkDirectory(library([nb]));
    const link: InternalLink = { kind: 'anchor', nb: 'nb1', id: 'an1' };
    expect(directory.isBroken(link)).toBe(false);
    expect(directory.resolve(link)?.pageId).toBe('pg1');
    nb.marks = [];
    expect(directory.isBroken(link)).toBe(true);
    nb.marks = [{ id: 'an1', pageId: 'pg1', name: 'T' }];
    expect(directory.isBroken(link)).toBe(false);
    nb.pageIds = [];
    expect(directory.isBroken(link)).toBe(true);
    expect(directory.isBroken({ kind: 'page', nb: 'nb1', id: 'pg1' })).toBe(true);
    expect(directory.isBroken({ kind: 'notebook', nb: 'nb1' })).toBe(false);
    expect(directory.isBroken({ kind: 'notebook', nb: 'gone' })).toBe(true);
    expect(directory.isBroken({ kind: 'url', href: 'https://a.b/' })).toBe(false);
  });

  it('keeps leading to a page however the pages are ordered', () => {
    const nb = notebook({ pageIds: ['a', 'b', 'c'], marks: [{ id: 'm', pageId: 'c', name: 'T' }] });
    const directory = new LinkDirectory(library([nb]));
    const link: InternalLink = { kind: 'anchor', nb: 'nb1', id: 'm' };
    expect(directory.describe(link)?.pageNumber).toBe(3);
    nb.pageIds = ['c', 'a', 'b'];
    expect(directory.resolve(link)?.pageId).toBe('c');
    expect(directory.describe(link)?.pageNumber).toBe(1);
  });

  it('can be taken out of a text, and only that link', () => {
    const one: InternalLink = { kind: 'page', nb: 'n', id: 'a' };
    const two: InternalLink = { kind: 'page', nb: 'n', id: 'b' };
    const paras = [
      {
        runs: [
          { t: 'one', link: one },
          { t: 'two', link: two },
        ],
      },
      { runs: [{ t: 'three', link: one }] },
    ];
    const runs = RichText.withoutLink(paras, one).flatMap((para) => para.runs);
    expect(runs.map((run) => run.t).join('')).toBe('onetwothree');
    expect(runs.filter((run) => run.link).map((run) => run.t)).toEqual(['two']);
  });

  it('remembers the recently used, newest first and without repeats', () => {
    const at = (id: string): InternalLink => ({ kind: 'page', nb: 'n', id });
    let list: InternalLink[] = [];
    for (const id of ['a', 'b', 'a', 'c', 'd', 'e', 'f', 'g']) list = LinkRules.pushRecent(list, at(id));
    expect(list.map((l) => (l.kind === 'page' ? l.id : ''))).toEqual(['g', 'f', 'e', 'd', 'c', 'a']);
  });

  it('only keeps valid recent targets in preferences', () => {
    const storage = {
      getItem: () =>
        JSON.stringify({ recentLinks: [{ kind: 'page', nb: 'n', id: 'a' }, { kind: 'evil' }, 7] }),
      setItem: vi.fn(),
    };
    const prefs = new PreferencesStore(storage as never).load();
    expect(prefs.recentLinks).toEqual([{ kind: 'page', nb: 'n', id: 'a' }]);
    expect(prefs.anchorMarkers).toBe(true);
  });
});

describe('the link picker search', () => {
  const nb = notebook({
    title: 'Физика',
    pageIds: ['a', 'b'],
    marks: [
      { id: 'm1', pageId: 'b', name: 'Ёмкость конденсатора' },
      { id: 'm2', pageId: 'a', name: 'Закон Ома' },
    ],
  });
  const other = notebook({
    id: 'nb2',
    title: 'Theorems',
    pageIds: [],
    marks: [{ id: 'm3', pageId: 'x', name: 'Ohm' }],
  });
  const directory = new LinkDirectory(library([nb, other]));

  it('finds anchors by any part of their name, ignoring case and accents', () => {
    const found = directory.search('емкость');
    expect(found.map((e) => e.name)).toEqual(['Ёмкость конденсатора']);
    expect(found[0]?.pageNumber).toBe(2);
    expect(found[0]?.notebook).toBe('Физика');
    expect(found[0]?.subject).toBe('Математика');
  });

  it('finds across notebooks, anchors before notebooks', () => {
    expect(directory.search('o').map((e) => e.target.kind)).toEqual(['anchor', 'notebook']);
    expect(directory.search('физ').map((e) => e.target)).toEqual([{ kind: 'notebook', nb: 'nb1' }]);
  });

  it('finds nothing for an empty query', () => {
    expect(directory.search('   ')).toEqual([]);
  });

  it('lists the anchors of a page for browsing', () => {
    expect(directory.anchorsOn(nb, 'a').map((e) => e.name)).toEqual(['Закон Ома']);
    expect(directory.subjects().map((s) => s.id)).toEqual(['sub1']);
  });
});

describe('the way back', () => {
  const spot = (n: number): { nbId: string; pageId: string; dy: number; x: number; z: number } => ({
    nbId: 'nb' + n,
    pageId: 'p',
    dy: n,
    x: 0,
    z: 1,
  });

  it('returns in reverse order', () => {
    const stack = new NavigationStack();
    stack.push(spot(1));
    stack.push(spot(2));
    expect(stack.pop()?.dy).toBe(2);
    expect(stack.pop()?.dy).toBe(1);
    expect(stack.pop()).toBeNull();
  });

  it('forgets the oldest steps past twenty', () => {
    const stack = new NavigationStack();
    for (let n = 0; n < 25; n++) stack.push(spot(n));
    expect(stack.size).toBe(20);
    let last = 0;
    while (stack.size) last = stack.pop()?.dy ?? -1;
    expect(last).toBe(5);
  });
});

describe('the system back button', () => {
  function guarded(blocked = false): {
    guard: SystemBackGuard;
    history: { pushState: ReturnType<typeof vi.fn>; back: ReturnType<typeof vi.fn> };
    pop: () => void;
    steps: { n: number };
    goBack: ReturnType<typeof vi.fn>;
  } {
    const steps = { n: 0 };
    const events = new EventTarget();
    const history = { pushState: vi.fn(), back: vi.fn() };
    const holder: { guard?: SystemBackGuard } = {};
    const goBack = vi.fn(() => {
      steps.n--;
      holder.guard?.sync();
    });
    const guard = new SystemBackGuard({
      history,
      events,
      hasSteps: () => steps.n > 0,
      goBack,
      blocked: () => blocked,
    });
    holder.guard = guard;
    return { guard, history, pop: () => events.dispatchEvent(new Event('popstate')), steps, goBack };
  }

  it('walks back through the steps before it can leave', () => {
    const { guard, history, pop, steps, goBack } = guarded();
    steps.n = 2;
    guard.sync();
    guard.sync();
    expect(history.pushState).toHaveBeenCalledTimes(1);
    pop();
    expect(goBack).toHaveBeenCalledTimes(1);
    expect(history.pushState).toHaveBeenCalledTimes(2);
    pop();
    expect(goBack).toHaveBeenCalledTimes(2);
    expect(history.pushState).toHaveBeenCalledTimes(2);
    pop();
    expect(goBack).toHaveBeenCalledTimes(2);
  });

  it('never puts anything in the address', () => {
    const { guard, history, steps } = guarded();
    steps.n = 1;
    guard.sync();
    expect(history.pushState.mock.calls[0]).toHaveLength(2);
  });

  it('takes its entry away when the steps run out some other way', () => {
    const { guard, history, pop, steps, goBack } = guarded();
    steps.n = 1;
    guard.sync();
    steps.n = 0;
    guard.sync();
    expect(history.back).toHaveBeenCalledTimes(1);
    pop();
    expect(goBack).not.toHaveBeenCalled();
  });

  it('leaves the page alone while a dialog is up, and stays armed', () => {
    const { guard, history, pop, steps, goBack } = guarded(true);
    steps.n = 1;
    guard.sync();
    pop();
    expect(goBack).not.toHaveBeenCalled();
    expect(history.pushState).toHaveBeenCalledTimes(2);
  });
});

describe('going to a place', () => {
  /** A viewport 800 x 600 with a 1000 px tall page at y 100; real camera maths are in Camera's tests. */
  function viewportAt(y: number): {
    viewport: Viewport;
    camera: { x: number; y: number; z: number; setZoom: ReturnType<typeof vi.fn> };
  } {
    const camera = {
      x: 0,
      y,
      z: 1,
      width: 800,
      height: 600,
      topPad: 60,
      setZoom: vi.fn(),
      clampTo: vi.fn(),
    };
    const layout = { pos: () => ({ x: 0, y: 100 }) };
    const viewport = new Viewport(
      camera as never,
      layout as never,
      {} as never,
      { request: vi.fn() } as never,
    );
    return { viewport, camera };
  }
  const box = (y0: number, y1: number): Box => ({ x0: 100, y0, x1: 200, y1 });

  it('scrolls only as far as needed, and never touches the zoom', () => {
    const { viewport, camera } = viewportAt(0);
    viewport.reveal({} as Page, box(100, 150));
    expect(camera.y).toBe(0);
    viewport.reveal({} as Page, box(800, 850));
    expect(camera.y).toBe(840);
    expect(camera.setZoom).not.toHaveBeenCalled();
  });

  it('goes back through setZoom, which a locked camera ignores', () => {
    const { viewport, camera } = viewportAt(0);
    viewport.showAt({} as Page, { dy: 40, x: 12, z: 2 });
    expect(camera.setZoom).toHaveBeenCalledWith(2);
    expect(camera.y).toBe(140);
    expect(camera.x).toBe(12);
  });
});

describe('deleted targets and undo', () => {
  it('a scratched-out link goes with its ink, and undo brings both back', () => {
    const p = page({ inkLinks: [inkLink()] });
    const history = new History();
    history.record(p);
    p.strokes = [];
    keeperFor([p], notebook()).keeper.pageChanged(p);
    expect(p.inkLinks).toEqual([]);
    history.undo((id) => (id === p.id ? p : undefined));
    expect(p.strokes).toHaveLength(1);
    expect(p.inkLinks.map((l) => l.id)).toEqual(['ink1']);
  });

  it('a deleted anchor makes links broken, until undo restores it', () => {
    const p = page({ anchors: [anchor()] });
    const nb = notebook();
    const { keeper } = keeperFor([p], nb);
    keeper.opened();
    const directory = new LinkDirectory(library([nb]));
    const link: InternalLink = { kind: 'anchor', nb: 'nb1', id: 'an1' };
    expect(directory.isBroken(link)).toBe(false);
    const history = new History();
    history.record(p);
    p.anchors = [];
    keeper.pageChanged(p);
    expect(directory.isBroken(link)).toBe(true);
    history.undo((id) => (id === p.id ? p : undefined));
    keeper.pageChanged(p);
    expect(directory.isBroken(link)).toBe(false);
  });

  it('a notebook keeps its steps while a link leads elsewhere', () => {
    const a = page({ id: 'a', anchors: [anchor()] });
    const history = new History();
    history.use('nbA');
    history.record(a);
    a.anchors = [];
    history.use('nbB');
    expect(history.undo(() => undefined)).toBeFalsy();
    history.use('nbA');
    history.undo((id) => (id === 'a' ? a : undefined));
    expect(a.anchors).toHaveLength(1);
  });

  it('blobs in steps of a notebook left behind stay in use', () => {
    const a = page({ id: 'a', images: [{ id: 'i', x: 0, y: 0, w: 1, h: 1, blob: 'kept' }] });
    const history = new History();
    history.use('nbA');
    history.record(a);
    history.use('nbB');
    expect(history.blobIds().has('kept')).toBe(true);
    history.clear();
    expect(history.blobIds().size).toBe(0);
  });
});

describe('copies', () => {
  it('of a page have anchors with new ids, bound to the copied items', () => {
    const original = page({ anchors: [anchor(), anchor({ id: 'whole', items: [] })], inkLinks: [inkLink()] });
    let added: Page[] = [];
    let next = 0;
    const ops = new PageOperations({
      session: { nb: { base: { w: 210, h: 297 } }, insert: (_a: Page, pages: Page[]) => (added = pages) },
      viewport: { relayout: vi.fn(), scrollTo: vi.fn() },
      saveQueue: { flush: vi.fn() },
      makeId: () => 'new' + next++,
      settle: vi.fn(),
      onPagesChanged: vi.fn(),
    } as never);
    ops.duplicate(original);
    const copy = added[0] as Page;
    const stroke = copy.strokes[0] as Stroke;
    expect(stroke.id).not.toBe('st1');
    expect(copy.anchors.map((a) => a.id)).not.toContain('an1');
    expect(copy.anchors[0]?.items).toEqual([stroke.id]);
    expect(copy.anchors[1]?.items).toEqual([]);
    expect(copy.inkLinks[0]?.id).not.toBe('ink1');
    expect(copy.inkLinks[0]?.items).toEqual([stroke.id]);
    expect(copy.inkLinks[0]?.link).toEqual(original.inkLinks[0]?.link);
    expect(original.anchors[0]?.id).toBe('an1');
  });

  it('of lassoed items bring their ink links, and never anchors', () => {
    const clipboard = new SelectionClipboard();
    const stroke = page().strokes[0] as Stroke;
    clipboard.copy({ strokes: [stroke], texts: [], images: [], cards: [] }, { x0: 0, y0: 0, x1: 1, y1: 1 }, [
      inkLink(),
    ]);
    let next = 0;
    const pasted = clipboard.pasted(1, 1, () => 'n' + next++);
    expect(pasted?.inkLinks[0]?.items).toEqual([pasted?.strokes[0]?.id]);
    expect(pasted?.inkLinks[0]?.id).not.toBe('ink1');
    expect(pasted).not.toHaveProperty('anchors');
  });
});

describe('a backup', () => {
  const withLinks = (): Record<string, unknown> => {
    const p = backupJson().pages as Record<string, unknown>[];
    const pageJson = {
      ...p[0],
      anchors: [anchor()],
      inkLinks: [inkLink()],
    };
    return backupJson({ pages: [pageJson] });
  };

  it('keeps anchors and links, and works out the list of anchors itself', () => {
    const notebooks = [{ ...notebook(), marks: [{ id: 'fake', pageId: 'pg1', name: 'forged' }] }];
    const doc = parseBackup({ ...withLinks(), notebooks });
    expect(doc.pages[0]?.anchors[0]?.id).toBe('an1');
    expect(doc.pages[0]?.inkLinks[0]?.link).toEqual({ kind: 'page', nb: 'nb1', id: 'pg1' });
    expect(doc.notebooks[0]?.marks).toEqual([{ id: 'an1', pageId: 'pg1', name: 'Theorem' }]);
  });

  it('round-trips with ids unchanged, so that restoring into existing data needs no remapping', () => {
    const first = parseBackup(withLinks());
    const again = parseBackup({ ...backupJson(), ...JSON.parse(JSON.stringify(first, jsonPoints)) });
    expect(again.pages[0]?.anchors).toEqual(first.pages[0]?.anchors);
    expect(again.pages[0]?.inkLinks).toEqual(first.pages[0]?.inkLinks);
    expect(again.notebooks[0]?.marks).toEqual(first.notebooks[0]?.marks);
  });

  it('from before anchors loads as it was', () => {
    const doc = parseBackup(backupJson());
    expect(doc.pages[0]?.anchors).toEqual([]);
    expect(doc.pages[0]?.inkLinks).toEqual([]);
    expect(doc.notebooks[0]?.marks).toBeUndefined();
  });

  it.each([
    ['a bad anchor id', { anchors: [anchor({ id: 'a b' })] }],
    ['a nameless anchor', { anchors: [anchor({ name: '   ' })] }],
    ['a long anchor name', { anchors: [anchor({ name: 'x'.repeat(500) })] }],
    ['an upside-down range', { anchors: [anchor({ range: [5, 1] })] }],
    ['a range over several items', { anchors: [anchor({ items: ['a', 'b'], range: [0, 1] })] }],
    ['a rect out of bounds', { anchors: [anchor({ rect: { x: 1e9, y: 0, w: 1, h: 1 } })] }],
    ['an unknown link kind', { inkLinks: [{ ...inkLink(), link: { kind: 'file', nb: 'nb1', id: 'x' } }] }],
    [
      'an unsafe link',
      { inkLinks: [{ ...inkLink(), link: { kind: 'url', href: 'java' + 'script:alert(1)' } }] },
    ],
  ])('with %s is rejected', (_name, fields) => {
    const pages = [{ ...(backupJson().pages as Record<string, unknown>[])[0], ...fields }];
    expect(() => parseBackup(backupJson({ pages }))).toThrow();
  });

  it('with an unknown field in an anchor drops it', () => {
    const pages = [
      { ...(backupJson().pages as Record<string, unknown>[])[0], anchors: [{ ...anchor(), x: 1 }] },
    ];
    expect(parseBackup(backupJson({ pages })).pages[0]?.anchors[0]).not.toHaveProperty('x');
  });
});

describe('a table of contents', () => {
  const style = { width: 200, pageLabel: (n: number) => `p. ${n}`, measure: (t: string) => t.length * 5 };

  it('has one linked line per anchor, in page order, with its page number', () => {
    const pages = [
      { id: 'a', anchors: [anchor({ id: 'one', name: 'First' })] },
      { id: 'b', anchors: [] },
      { id: 'c', anchors: [anchor({ id: 'two', name: 'Second' })] },
    ];
    const entries = TableOfContents.entries('nb', pages);
    expect(entries.map((e) => [e.name, e.page])).toEqual([
      ['First', 1],
      ['Second', 3],
    ]);
    const paras = TableOfContents.paragraphs(entries, style);
    expect(paras[1]?.runs[0]?.t).toMatch(/^Second \.+ p\. 3$/);
    expect(paras[1]?.runs[0]?.link).toEqual({ kind: 'anchor', nb: 'nb', id: 'two' });
  });

  it('fits each line to the width with its dots', () => {
    const entries = [{ name: 'Name', page: 12, target: { kind: 'notebook', nb: 'n' } as const }];
    const line = TableOfContents.paragraphs(entries, style)[0]?.runs[0]?.t ?? '';
    expect(style.measure(line)).toBeLessThanOrEqual(200);
    expect(style.measure(line)).toBeGreaterThan(190);
  });

  it('cuts a long name short rather than wrapping', () => {
    const entries = [{ name: 'y'.repeat(300), page: 1, target: { kind: 'notebook', nb: 'n' } as const }];
    const line = TableOfContents.paragraphs(entries, style)[0]?.runs[0]?.t ?? '';
    expect(line).toContain('…');
    expect(line).toContain('...');
    expect(style.measure(line)).toBeLessThanOrEqual(200);
  });

  it('written again reflects the pages as they are now', () => {
    const one = { id: 'a', anchors: [anchor({ id: 'x', name: 'X' })] };
    const two = { id: 'b', anchors: [anchor({ id: 'y', name: 'Y' })] };
    expect(TableOfContents.entries('nb', [one, two]).map((e) => e.page)).toEqual([1, 2]);
    expect(TableOfContents.entries('nb', [two, one]).map((e) => [e.name, e.page])).toEqual([
      ['Y', 1],
      ['X', 2],
    ]);
  });
});

describe('a PDF', () => {
  const pages = [
    { id: 'a', nbId: 'n', anchors: [] },
    { id: 'b', nbId: 'n', anchors: [anchor({ id: 'an' })] },
  ];
  const map = new PdfLinkMap(pages);

  it('sends links to its own pages and anchors to their page', () => {
    expect(map.pageNumber({ kind: 'page', nb: 'n', id: 'b' })).toBe(2);
    expect(map.pageNumber({ kind: 'anchor', nb: 'n', id: 'an' })).toBe(2);
    expect(map.pageNumber({ kind: 'notebook', nb: 'n' })).toBe(1);
  });

  it('has nowhere to send links out of the file', () => {
    expect(map.pageNumber({ kind: 'page', nb: 'other', id: 'b' })).toBeNull();
    expect(map.pageNumber({ kind: 'notebook', nb: 'other' })).toBeNull();
    expect(map.pageNumber({ kind: 'page', nb: 'n', id: 'left-out' })).toBeNull();
    expect(map.pageNumber({ kind: 'anchor', nb: 'n', id: 'gone' })).toBeNull();
    expect(map.pageNumber({ kind: 'url', href: 'https://a.b/' })).toBeNull();
  });
});

describe('how links look', () => {
  /** Records what gets drawn. */
  function sink(): { rects: { color: string; w: number }[]; links: LinkTarget[]; paths: number; api: never } {
    const out = { rects: [] as { color: string; w: number }[], links: [] as LinkTarget[], paths: 0 };
    const api = {
      fillRect: (_x: number, _y: number, w: number, _h: number, color: string) =>
        out.rects.push({ color, w }),
      link: (_x: number, _y: number, _w: number, _h: number, target: LinkTarget) => out.links.push(target),
      newPath: () => ({ moveTo: vi.fn(), lineTo: vi.fn(), closePath: vi.fn() }),
      fillPath: () => (out.paths += 1),
    };
    return {
      ...out,
      get paths() {
        return out.paths;
      },
      api: api as never,
    };
  }

  it('working ink links are dotted and clickable; broken ones dashed, in their own colour, and not', () => {
    const wide: Stroke = { id: 'st1', k: 'pen', c: '#000000', s: 1, p: new Float32Array([0, 0, 1]) };
    const box = { bbox: () => ({ x0: 0, y0: 0, x1: 45, y1: 10 }) };
    const shapes = new LinkGeometry(box as never, {} as never);
    const p = page({ strokes: [wide], inkLinks: [inkLink()] });
    const working = sink();
    new LinkMarkPainter(
      shapes,
      () => false,
      () => true,
    ).emitInkLinks(working.api, p, null);
    expect(working.rects[0]?.color).toBe(PAPER.link);
    expect(working.links).toHaveLength(1);
    const broken = sink();
    new LinkMarkPainter(
      shapes,
      () => true,
      () => true,
    ).emitInkLinks(broken.api, p, null);
    expect(broken.rects[0]?.color).toBe(PAPER.linkBroken);
    expect(broken.rects[0]?.w).toBeGreaterThan(working.rects[0]?.w ?? 0);
    expect(broken.links).toHaveLength(0);
  });

  it('bookmark markers can be turned off, and follow items being moved out of sight', () => {
    const p = page({ anchors: [anchor()] });
    const on = sink();
    new LinkMarkPainter(
      geometry(),
      () => false,
      () => true,
    ).emitMarkers(on.api, p, null);
    expect(on.paths).toBe(1);
    const off = sink();
    new LinkMarkPainter(
      geometry(),
      () => false,
      () => false,
    ).emitMarkers(off.api, p, null);
    expect(off.paths).toBe(0);
    const moving = sink();
    new LinkMarkPainter(
      geometry(),
      () => false,
      () => true,
    ).emitMarkers(moving.api, p, new Set(['st1']));
    expect(moving.paths).toBe(0);
  });
});

describe('a press', () => {
  function targets(tool: 'pen' | 'text' | 'eraser' | 'lasso' | 'highlighter', p: Page): PagePressTargets {
    return new PagePressTargets({
      camera: { toWorld: (x: number, y: number) => ({ x, y }) },
      layout: { pageAt: () => p, toPage: (_p: Page, at: unknown) => at },
      texts: { linkAt: () => null },
      geometry: { inkBox: () => ({ x0: 10, y0: 10, x1: 50, y1: 30 }) },
      tool: () => tool,
      overSelection: () => false,
    } as never);
  }
  const linked = (): Page => page({ inkLinks: [inkLink()] });

  it.each(['pen', 'highlighter', 'lasso'] as const)('with the %s on linked ink opens it', (tool) => {
    const hit = targets(tool, linked()).at({ x: 20, y: 20 });
    expect(hit?.kind === 'link' && hit.ink?.id).toBe('ink1');
  });

  it.each(['eraser', 'text'] as const)('with the %s never does', (tool) => {
    expect(targets(tool, linked()).at({ x: 20, y: 20 })).toBeNull();
  });

  it('near linked ink still counts, and away from it does not', () => {
    const t = targets('pen', linked());
    expect(t.at({ x: 8, y: 20 })).not.toBeNull();
    expect(t.at({ x: 200, y: 200 })).toBeNull();
  });
});

function jsonPoints(key: string, value: unknown): unknown {
  return key === 'p' && value instanceof Float32Array ? Array.from(value) : value;
}
