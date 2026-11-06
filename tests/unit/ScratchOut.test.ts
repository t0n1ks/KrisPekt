import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_PREFS,
  SCRATCH_HINT_COUNT,
  SCRATCH_LEVELS,
  SCRATCH_LEVEL_NAMES,
} from '../../src/core/constants';
import type { Box, Page, ScratchLevel, Stroke, TextItem } from '../../src/core/types';
import { History } from '../../src/domain/History';
import { RichText } from '../../src/domain/RichText';
import { RichTextLayout, type LaidGlyph } from '../../src/domain/RichTextLayout';
import { ScratchRegion } from '../../src/domain/ScratchRegion';
import { ScratchTargets, type ScratchPageView } from '../../src/domain/ScratchTargets';
import { ScribbleDetector } from '../../src/domain/ScribbleDetector';
import { TextErasure } from '../../src/domain/TextErasure';
import { ScratchOutController, type ScratchReport } from '../../src/editor/ScratchOutController';
import { PreferencesStore } from '../../src/storage/PreferencesStore';
import { page as pageFixture } from './fixtures';

type XY = readonly [number, number];

/** A repeatable shake, so that a failure can be reproduced. */
function shaky(points: readonly XY[], amount: number, seed = 7): XY[] {
  let state = seed;
  const next = (): number => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296 - 0.5;
  };
  return points.map(([x, y]) => [x + next() * amount, y + next() * amount]);
}

/** Straight legs through the corners, sampled about every `step` px, as x, y, pressure triples. */
function polyline(corners: readonly XY[], step = 1.5): XY[] {
  const out: XY[] = [];
  corners.forEach(([x, y], i) => {
    const [nx, ny] = corners[i + 1] ?? [x, y];
    const n = Math.max(1, Math.round(Math.hypot(nx - x, ny - y) / step));
    for (let k = 0; k < n; k++) out.push([x + ((nx - x) * k) / n, y + ((ny - y) * k) / n]);
  });
  const last = corners[corners.length - 1];
  if (last) out.push(last);
  return out;
}

function triples(points: readonly XY[]): Float32Array {
  const out: number[] = [];
  for (const [x, y] of points) out.push(x, y, 0.5);
  return Float32Array.from(out);
}

function rotated(points: readonly XY[], degrees: number): XY[] {
  const a = (degrees * Math.PI) / 180;
  return points.map(([x, y]) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)]);
}

/** Back and forth across a width, moving on by `drop` each time: how a word is usually crossed out. */
function zigzagAcross(x: number, y: number, width: number, legs: number, drop: number): XY[] {
  return polyline(Array.from({ length: legs + 1 }, (_, i): XY => [i % 2 ? x + width : x, y + i * drop]));
}

/** Up and down, moving along by `advance` per leg. */
function sawtooth(x: number, y: number, height: number, legs: number, advance: number): XY[] {
  return polyline(Array.from({ length: legs + 1 }, (_, i): XY => [x + i * advance, i % 2 ? y : y + height]));
}

/** A curve from a function of a parameter. */
function curve(f: (t: number) => XY, to: number, steps: number): XY[] {
  return Array.from({ length: steps + 1 }, (_, i) => f((to * i) / steps));
}

const H = 20;

/** Arches of an "m" or "м": up the same leg and over, again and again. */
function archesWord(humps: number): XY[] {
  const width = H * 0.9;
  return curve((t) => [t * width, H * (1 - Math.abs(Math.sin(t * Math.PI)))], humps, humps * 24);
}

function zWord(count: number): XY[] {
  const corners: XY[] = [];
  for (let i = 0; i < count; i++) {
    const x = i * H * 1.2;
    corners.push([x, 0], [x + H, 0], [x, H], [x + H, H]);
  }
  return polyline(corners);
}

/** "ж" in one go: spokes out from the middle and back, tall and wide. */
function zhe(): XY[] {
  const m: XY = [H * 0.6, H / 2];
  return polyline([[0, 0], m, [0, H], m, [H * 0.6, 0], m, [H * 0.6, H], m, [H * 1.2, 0], m, [H * 1.2, H]]);
}

function signature(): XY[] {
  return curve(
    (t) => [t * 16 + Math.sin(t * 2.2) * 14, H / 2 + Math.sin(t * 3.1) * H * 0.6 + Math.cos(t * 1.3) * 5],
    12,
    220,
  );
}

const WRITING: Record<string, XY[]> = {
  'cursive m': archesWord(1),
  mmm: archesWord(3),
  'мимими (six arches)': archesWord(6),
  'a long row of arches': archesWord(14),
  ш: sawtooth(0, 0, H, 5, H * 0.3),
  'www, ordinary width': sawtooth(0, 0, H, 12, H * 0.25),
  'wwwwww, a long one': sawtooth(0, 0, H, 24, H * 0.25),
  м: sawtooth(0, 0, H, 4, H * 0.3),
  z: zWord(1),
  zz: zWord(2),
  zzz: zWord(3),
  zzzzzz: zWord(6),
  ж: zhe(),
  'a wavy line': curve((t) => [t * 10, Math.sin(t) * 6], 30, 200),
  'a tall wavy line': curve((t) => [t * 6, Math.sin(t) * H], 30, 300),
  'a straight strike-through': polyline([
    [0, 10],
    [120, 12],
  ]),
  'an underline with a return': polyline([
    [0, 0],
    [100, 1],
    [0, 3],
  ]),
  'a double underline': polyline([
    [0, 0],
    [100, 1],
    [0, 4],
    [100, 5],
  ]),
  'a signature': signature(),
  'a circle round a word, three times': curve((t) => [60 * Math.cos(t), 18 * Math.sin(t)], Math.PI * 6, 240),
  'a spiral': curve((t) => [(4 + t * 3) * Math.cos(t), (4 + t * 3) * Math.sin(t)], Math.PI * 8, 300),
  'a row of loops': curve((t) => [t * 2.4 + 9 * Math.cos(t), 9 * Math.sin(t)], Math.PI * 12, 300),
  'wide hatching': sawtooth(0, 0, 30, 10, 12),
  'a dot': polyline([
    [5, 5],
    [5.4, 5.2],
  ]),
};

const SCRIBBLES: Record<string, XY[]> = {
  'back and forth across a word': zigzagAcross(0, 0, 80, 8, 2.5),
  'back and forth, in a wide flat band': zigzagAcross(0, 0, 120, 10, 1.5),
  'over a single letter': zigzagAcross(0, 0, 16, 8, 2),
  'back and forth over a full line': zigzagAcross(0, 0, 300, 12, 2),
  'up and down, tightly, across a word': sawtooth(0, 0, 24, 24, 2.6),
  'up and down over one letter': sawtooth(0, 0, 18, 10, 1.6),
};

const metricsOf = (points: readonly XY[]) => ScribbleDetector.measure(triples(points));
const isScribble = (points: readonly XY[], level: ScratchLevel = 'normal', minExtent = 6): boolean =>
  ScribbleDetector.isScribble(metricsOf(points), SCRATCH_LEVELS[level], minExtent);

describe('scribble shape: writing is never a scribble', () => {
  for (const [name, points] of Object.entries(WRITING)) {
    it.each(SCRATCH_LEVEL_NAMES)(`${name} (%s)`, (level) => {
      expect(isScribble(points, level), JSON.stringify(metricsOf(points))).toBe(false);
    });
    it(`${name}, tilted and shaky`, () => {
      const hand = shaky(rotated(points, 8), 0.5);
      expect(isScribble(hand), JSON.stringify(metricsOf(hand))).toBe(false);
    });
  }

  it('a narrow "www" stays writing at normal and low, and only high lets it through', () => {
    const narrow = sawtooth(0, 0, H, 12, H * 0.18);
    expect(isScribble(narrow, 'normal')).toBe(false);
    expect(isScribble(narrow, 'low')).toBe(false);
    expect(isScribble(narrow, 'high')).toBe(true);
  });
});

describe('scribble shape: crossing out is recognised', () => {
  for (const [name, points] of Object.entries(SCRIBBLES)) {
    it(name, () => {
      expect(isScribble(points), JSON.stringify(metricsOf(points))).toBe(true);
    });
    it.each([-35, 20, 90])(`${name}, tilted by %i degrees`, (degrees) => {
      const hand = rotated(points, degrees);
      expect(isScribble(hand), JSON.stringify(metricsOf(hand))).toBe(true);
    });
    it(`${name}, shaky`, () => {
      const hand = shaky(points, 0.8);
      expect(isScribble(hand), JSON.stringify(metricsOf(hand))).toBe(true);
    });
  }

  it('is too small to count below the smallest size', () => {
    const tiny = zigzagAcross(0, 0, 4, 8, 0.4);
    expect(isScribble(tiny, 'normal', 4)).toBe(true);
    expect(isScribble(tiny, 'normal', 8)).toBe(false);
  });

  it('counts the reversals along the direction of motion', () => {
    expect(metricsOf(zigzagAcross(0, 0, 80, 8, 2)).reversals).toBe(7);
    expect(metricsOf(sawtooth(0, 0, 24, 24, 2)).reversals).toBe(23);
    expect(metricsOf(zWord(3)).reversals).toBe(0);
  });
});

describe('sensitivity', () => {
  it('a coarse zigzag has the shape of a narrow "www": writing at normal, a scribble at high', () => {
    const coarse = zigzagAcross(0, 0, 16, 6, 3);
    expect(isScribble(coarse, 'normal')).toBe(false);
    expect(isScribble(coarse, 'high')).toBe(true);
  });

  it.each([
    ['few passes', zigzagAcross(0, 0, 80, 4, 3), { low: false, normal: false, high: true }],
    ['some passes', zigzagAcross(0, 0, 80, 5, 3), { low: false, normal: true, high: true }],
    ['many passes', zigzagAcross(0, 0, 80, 10, 2), { low: true, normal: true, high: true }],
  ] as const)('%s', (_name, points, expected) => {
    for (const level of SCRATCH_LEVEL_NAMES) expect(isScribble(points, level)).toBe(expected[level]);
  });

  it('asks for more coverage at low and less at high', () => {
    expect(SCRATCH_LEVELS.low.minCoverage).toBeGreaterThan(SCRATCH_LEVELS.normal.minCoverage);
    expect(SCRATCH_LEVELS.high.minCoverage).toBeLessThan(SCRATCH_LEVELS.normal.minCoverage);
  });
});

/** A letter as a small stroke: a closed-ish shape filling a box. */
function letter(id: string, x: number, y = 0, size = 16): Stroke {
  return ink(
    id,
    polyline([
      [x, y + size],
      [x + size * 0.4, y],
      [x + size * 0.8, y + size],
      [x + size * 0.15, y + size * 0.6],
      [x + size * 0.7, y + size * 0.6],
    ]),
  );
}

function ink(id: string, points: readonly XY[]): Stroke {
  return { id, k: 'pen', c: '#112233', s: 2, p: triples(points) };
}

function boxOf(stroke: Stroke): Box {
  let box: Box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (let i = 0; i < stroke.p.length; i += 3) {
    const x = stroke.p[i] ?? 0;
    const y = stroke.p[i + 1] ?? 0;
    box = {
      x0: Math.min(box.x0, x),
      y0: Math.min(box.y0, y),
      x1: Math.max(box.x1, x),
      y1: Math.max(box.y1, y),
    };
  }
  return box;
}

/** Every character 10 px wide: enough to test without a canvas. */
const measurer = {
  font: '',
  measureText: (text: string) => ({
    width: text.length * 10,
    fontBoundingBoxAscent: 16,
    fontBoundingBoxDescent: 4,
  }),
};
const layout = new RichTextLayout(measurer);

function textGlyphs(item: TextItem, near: Box): LaidGlyph[] {
  const laid = layout.layout(RichText.paragraphsOf(item), item.w, item);
  const local = { x0: near.x0 - item.x, y0: near.y0 - item.y, x1: near.x1 - item.x, y1: near.y1 - item.y };
  return layout.glyphs(laid, local).map((glyph) => ({
    ...glyph,
    x0: glyph.x0 + item.x,
    x1: glyph.x1 + item.x,
    y0: glyph.y0 + item.y,
    y1: glyph.y1 + item.y,
    baseline: glyph.baseline + item.y,
  }));
}

function textBox(item: TextItem): Box {
  const height = layout.layout(RichText.paragraphsOf(item), item.w, item).height;
  return { x0: item.x, y0: item.y, x1: item.x + item.w, y1: item.y + height };
}

function view(strokes: readonly Stroke[], texts: readonly TextItem[] = []): ScratchPageView {
  return {
    strokes,
    texts,
    strokeBox: boxOf,
    textBox,
    richText: (item) => (item.paras ? item : { ...item, paras: RichText.paragraphsOf(item) }),
    glyphs: textGlyphs,
  };
}

function erasedBy(scribble: readonly XY[], strokes: readonly Stroke[], minCoverage = 0.6): string[] {
  const region = ScratchRegion.around(triples(scribble), 2);
  return ScratchTargets.plan(view(strokes), region, minCoverage).strokes.map((s) => s.id);
}

describe('the region of a scribble', () => {
  const region = ScratchRegion.around(triples(zigzagAcross(0, 0, 100, 8, 3)), 2);

  it('holds the gaps between the legs, and a margin', () => {
    expect(region.contains(50, 12)).toBe(true);
    expect(region.contains(50, -3)).toBe(true);
    expect(region.contains(101, 12)).toBe(true);
  });

  it('ends not far from the scribble', () => {
    expect(region.contains(50, 40)).toBe(false);
    expect(region.contains(130, 12)).toBe(false);
    expect(region.contains(-30, 12)).toBe(false);
  });

  it('holds a tilted scribble, not the corners of its bounding box', () => {
    const tilted = ScratchRegion.around(triples(rotated(zigzagAcross(0, 0, 100, 8, 2), 45)), 1);
    const [x, y] = rotated([[50, 8]], 45)[0] ?? [0, 0];
    expect(tilted.contains(x, y)).toBe(true);
    expect(tilted.contains(70, 5)).toBe(false);
  });

  it('measures a stroke by its length inside', () => {
    const half = ink(
      'half',
      polyline([
        [50, 12],
        [150, 12],
      ]),
    );
    expect(region.strokeCoverage(half.p, boxOf(half))).toBeCloseTo(0.5, 0);
  });
});

describe('what a scribble takes away', () => {
  const word = [letter('a', 0), letter('b', 20), letter('c', 40)];
  const neighbours = [letter('x', 90), letter('y', 110)];

  it('a letter', () => {
    expect(erasedBy(zigzagAcross(20, 2, 14, 8, 1.6), [...word, ...neighbours])).toEqual(['b']);
  });

  it('a word, and not the word beside it', () => {
    expect(erasedBy(zigzagAcross(0, 2, 56, 8, 1.6), [...word, ...neighbours])).toEqual(['a', 'b', 'c']);
  });

  it('a full line', () => {
    expect(erasedBy(zigzagAcross(0, 2, 124, 10, 1.4), [...word, ...neighbours])).toEqual([
      'a',
      'b',
      'c',
      'x',
      'y',
    ]);
  });

  it('a dot or a diacritic inside', () => {
    const dot = ink(
      'dot',
      polyline([
        [20, 8],
        [20.4, 8.2],
      ]),
    );
    const point = { ...ink('point', [[30, 8]]) };
    expect(erasedBy(zigzagAcross(10, 2, 30, 8, 1.6), [dot, point])).toEqual(['dot', 'point']);
  });

  it('keeps a long line that it only touches', () => {
    const underline = ink(
      'under',
      polyline([
        [-100, 15],
        [300, 15],
      ]),
    );
    const frame = ink(
      'frame',
      polyline([
        [-5, -5],
        [70, -5],
        [70, 25],
        [-5, 25],
        [-5, -5],
      ]),
    );
    const arrow = ink(
      'arrow',
      polyline([
        [30, 8],
        [400, 200],
      ]),
    );
    expect(erasedBy(zigzagAcross(0, 2, 56, 8, 1.6), [underline, frame, arrow])).toEqual([]);
  });

  it('keeps a stroke with less than the coverage it asks for', () => {
    const half = ink(
      'half',
      polyline([
        [28, 8],
        [84, 8],
      ]),
    );
    expect(erasedBy(zigzagAcross(0, 2, 56, 8, 1.6), [half], 0.6)).toEqual([]);
    expect(erasedBy(zigzagAcross(0, 2, 56, 8, 1.6), [half], 0.4)).toEqual(['half']);
  });

  it('has nothing to take on an empty area', () => {
    const plan = ScratchTargets.plan(
      view([letter('far', 500, 500)]),
      ScratchRegion.around(triples(zigzagAcross(0, 0, 56, 8, 2)), 2),
      0.6,
    );
    expect(ScratchTargets.isEmpty(plan)).toBe(true);
    expect(plan.near).toBe(0);
  });
});

describe('crossing out typed text', () => {
  const item = (t: string, extra: Partial<TextItem> = {}): TextItem => ({
    id: 't1',
    x: 0,
    y: 0,
    w: 400,
    t,
    fs: 20,
    c: '#000000',
    ...extra,
  });

  /** A scribble over characters [from, to) of the first line, 10 px each. */
  const over = (from: number, to: number): ScratchRegion =>
    ScratchRegion.around(triples(zigzagAcross(from * 10 + 1, 8, (to - from) * 10 - 2, 8, 1)), 1);

  const edit = (text: TextItem, from: number, to: number) =>
    ScratchTargets.plan(view([], [text]), over(from, to), 0.6).texts[0];
  const textOf = (text: TextItem, from: number, to: number): string | null => {
    const paras = edit(text, from, to)?.paras;
    return paras ? RichText.plainText(paras) : null;
  };

  it('takes out the word and one space, not its neighbours', () => {
    expect(textOf(item('one two three'), 4, 7)).toBe('one three');
  });

  it('takes out the last word with the space before it', () => {
    expect(textOf(item('one two'), 4, 7)).toBe('one');
  });

  it('takes out only the characters when a small part of a word is covered', () => {
    expect(textOf(item('wonderful'), 0, 2)).toBe('nderful');
  });

  it('takes the whole word when most of it is covered', () => {
    expect(textOf(item('one wonderful day'), 4, 10)).toBe('one day');
  });

  it('deletes the box when all of it is covered', () => {
    const covered = edit(item('one two'), 0, 7);
    expect(covered).toBeDefined();
    expect(covered?.paras).toBeNull();
  });

  it('keeps the formatting of the rest, run by run', () => {
    // As wide as its text, so that the centring moves nothing.
    const rich = item('one two three', {
      w: 130,
      paras: [
        {
          align: 'center',
          runs: [
            { t: 'one ', b: true },
            { t: 'two ', c: '#ff0000' },
            { t: 'three', i: true, fs: 14 },
          ],
        },
      ],
    });
    expect(edit(rich, 4, 7)?.paras).toEqual([
      {
        align: 'center',
        runs: [
          { t: 'one ', b: true },
          { t: 'three', i: true, fs: 14 },
        ],
      },
    ]);
  });

  it('leaves text it does not reach alone', () => {
    const plan = ScratchTargets.plan(
      view([], [item('one two')]),
      ScratchRegion.around(triples(zigzagAcross(600, 500, 60, 8, 1)), 1),
      0.6,
    );
    expect(plan.texts).toEqual([]);
  });

  it('names what goes for the fade-out', () => {
    expect(
      edit(item('one two three'), 4, 7)
        ?.gone.map((g) => g.text)
        .join(''),
    ).toBe('two ');
  });

  it('removes a paragraph left with nothing, with its break', () => {
    expect(TextErasure.ranges('one\ntwo\nthree', [[4, 7]])).toEqual([[4, 8]]);
    expect(TextErasure.ranges('one\ntwo', [[4, 7]])).toEqual([[3, 7]]);
    const paras = [{ runs: [{ t: 'one' }] }, { runs: [{ t: 'two' }] }, { runs: [{ t: 'three' }] }];
    expect(RichText.plainText(TextErasure.removed(paras, [[4, 8]]))).toBe('one\nthree');
  });

  it('handles several words in one go', () => {
    const cuts = TextErasure.ranges('a bb cc d', [
      [2, 4],
      [5, 7],
    ]);
    expect(RichText.plainText(TextErasure.removed([{ runs: [{ t: 'a bb cc d' }] }], cuts))).toBe('a d');
  });

  it('knows the offsets across lines and paragraphs', () => {
    const laid = layout.layout(
      [{ runs: [{ t: 'ab' }] }, { runs: [{ t: 'cd ' }, { t: 'ef', b: true }] }],
      400,
      { fs: 20, c: '#000000' },
    );
    const glyphs = layout.glyphs(laid, { x0: 0, y0: 0, x1: 400, y1: 400 });
    expect(glyphs.map((g) => [g.text, g.start])).toEqual([
      ['a', 0],
      ['b', 1],
      ['c', 3],
      ['d', 4],
      [' ', 5],
      ['e', 6],
      ['f', 7],
    ]);
  });
});

interface Harness {
  controller: ScratchOutController;
  page: Page;
  history: History;
  reports: ScratchReport[];
  fade: ReturnType<typeof vi.fn>;
  hint: ReturnType<typeof vi.fn>;
  prefs: ReturnType<typeof PreferencesStore.sanitize>;
}

function harness(pageOverrides: Partial<Page>): Harness {
  const page = pageFixture({ strokes: [], texts: [], ...pageOverrides });
  const history = new History();
  const prefs = PreferencesStore.sanitize({});
  const reports: ScratchReport[] = [];
  const fade = vi.fn();
  const hint = vi.fn();
  const controller = new ScratchOutController({
    prefs,
    savePrefs: () => undefined,
    strokeBox: boxOf,
    textBox,
    richText: (item) => (item.paras ? item : { ...item, paras: RichText.paragraphsOf(item) }),
    glyphs: textGlyphs,
    naturalWidth: (item) => RichText.length(RichText.paragraphsOf(item)) * 10,
    hiddenTextOn: () => null,
    recordUndo: (p) => history.record(p),
    touch: () => undefined,
    fade,
    report: (report) => reports.push(report),
    hint,
  });
  return { controller, page, history, reports, fade, hint, prefs };
}

const scribbleOver = (x: number, width: number): Stroke => ink('scribble', zigzagAcross(x, 2, width, 8, 1.6));

describe('scratching out', () => {
  it('removes the targets and asks for the scribble not to be added', () => {
    const { controller, page, fade, reports } = harness({ strokes: [letter('a', 0), letter('z', 100)] });
    const scribble = scribbleOver(0, 16);
    expect(controller.tryErase(page, scribble, 1)).toBe(true);
    expect(page.strokes.map((s) => s.id)).toEqual(['z']);
    expect(fade).toHaveBeenCalledOnce();
    expect(fade.mock.calls[0]?.[1]).toContain(scribble);
    expect(reports[0]).toMatchObject({ decision: 'erased', coverage: { hit: 1 } });
  });

  it('one undo step brings it all back, without the scribble; redo takes it away again', () => {
    const { controller, page, history } = harness({ strokes: [letter('a', 0), letter('z', 100)] });
    controller.tryErase(page, scribbleOver(0, 16), 1);
    const find = (id: string): Page | undefined => (id === page.id ? page : undefined);
    expect(history.undo(find)).not.toBeNull();
    expect(page.strokes.map((s) => s.id)).toEqual(['a', 'z']);
    expect(history.canUndo).toBe(false);
    history.redo(find);
    expect(page.strokes.map((s) => s.id)).toEqual(['z']);
  });

  it('undo also brings back text, and never changes an item in place', () => {
    const text: TextItem = { id: 't', x: 0, y: 0, w: 400, t: 'one two three', fs: 20, c: '#000000' };
    const { controller, page, history } = harness({ texts: [text] });
    controller.tryErase(page, ink('s', zigzagAcross(41, 8, 28, 8, 1)), 1);
    expect(page.texts[0]?.t).toBe('one three');
    expect(text.t).toBe('one two three');
    history.undo((id) => (id === page.id ? page : undefined));
    expect(page.texts[0]).toBe(text);
  });

  it('a fully covered box goes, and images never do', () => {
    const image = { id: 'i', x: 0, y: 0, w: 200, h: 200, blob: 'b' };
    const text: TextItem = { id: 't', x: 0, y: 0, w: 400, t: 'hi', fs: 20, c: '#000000' };
    const { controller, page } = harness({ texts: [text], images: [image] });
    expect(controller.tryErase(page, ink('s', zigzagAcross(0, 6, 22, 8, 1.5)), 1)).toBe(true);
    expect(page.texts).toEqual([]);
    expect(page.images).toEqual([image]);
  });

  it('only an image underneath: nothing to delete, the scribble stays', () => {
    const image = { id: 'i', x: 0, y: 0, w: 200, h: 200, blob: 'b' };
    const { controller, page, history } = harness({ images: [image] });
    expect(controller.tryErase(page, scribbleOver(0, 16), 1)).toBe(false);
    expect(page.images).toEqual([image]);
    expect(history.canUndo).toBe(false);
  });

  it('keeps the auto width of a box that has less text now', () => {
    const text: TextItem = {
      id: 't',
      x: 0,
      y: 0,
      w: 130,
      t: 'one two three',
      fs: 20,
      c: '#000000',
      auto: true,
    };
    const { controller, page } = harness({ texts: [text] });
    controller.tryErase(page, ink('s', zigzagAcross(41, 8, 28, 8, 1)), 1);
    expect(page.texts[0]?.w).toBeLessThan(130);
  });

  it('a zigzag on an empty area is an ordinary stroke, with nothing recorded', () => {
    const { controller, page, history, reports, hint } = harness({ strokes: [letter('far', 500, 500)] });
    expect(controller.tryErase(page, scribbleOver(0, 40), 1)).toBe(false);
    expect(page.strokes).toHaveLength(1);
    expect(history.canUndo).toBe(false);
    expect(hint).not.toHaveBeenCalled();
    expect(reports[0]?.decision).toBe('nothing');
  });

  it('writing over ink is left alone, and the page is not even looked at', () => {
    const strokes = [letter('a', 0)];
    const { controller, page, reports } = harness({ strokes });
    expect(controller.tryErase(page, ink('w', sawtooth(0, 0, H, 12, H * 0.25)), 1)).toBe(false);
    expect(page.strokes).toEqual(strokes);
    expect(reports[0]).toMatchObject({ decision: 'writing', coverage: null });
  });

  it('off means off, and the diagnostics still tell the shape', () => {
    const { controller, page, prefs, reports } = harness({ strokes: [letter('a', 0)] });
    prefs.scratch.on = false;
    expect(controller.tryErase(page, scribbleOver(0, 16), 1)).toBe(false);
    expect(page.strokes).toHaveLength(1);
    expect(reports[0]?.decision).toBe('off');
    expect(reports[0]?.metrics.reversals).toBeGreaterThan(0);
  });

  it('the sensitivity decides', () => {
    const few = ink('s', zigzagAcross(0, 2, 16, 4, 3));
    const normal = harness({ strokes: [letter('a', 0)] });
    expect(normal.controller.tryErase(normal.page, few, 1)).toBe(false);
    const high = harness({ strokes: [letter('a', 0)] });
    high.prefs.scratch.level = 'high';
    expect(high.controller.tryErase(high.page, few, 1)).toBe(true);
  });

  it('counts its smallest size on the screen, so zooming in does not make it too small', () => {
    const tiny = ink('s', zigzagAcross(0, 2, 5, 8, 0.5));
    const small = harness({
      strokes: [
        ink(
          'dot',
          polyline([
            [2, 4],
            [3, 5],
          ]),
        ),
      ],
    });
    expect(small.controller.tryErase(small.page, tiny, 1)).toBe(false);
    expect(small.controller.tryErase(small.page, tiny, 4)).toBe(true);
  });

  it('hints the first three times only, and counts them', () => {
    const { controller, page, hint, prefs } = harness({});
    for (let i = 0; i < SCRATCH_HINT_COUNT + 2; i++) {
      page.strokes = [letter('a' + i, 0)];
      expect(controller.tryErase(page, scribbleOver(0, 16), 1)).toBe(true);
    }
    expect(hint).toHaveBeenCalledTimes(SCRATCH_HINT_COUNT);
    expect(prefs.scratch.hints).toBe(SCRATCH_HINT_COUNT);
  });
});

describe('stored settings', () => {
  it('old settings without any of this get the defaults: on, normal', () => {
    expect(PreferencesStore.sanitize({}).scratch).toEqual(DEFAULT_PREFS.scratch);
    expect(DEFAULT_PREFS.scratch).toEqual({ on: true, level: 'normal', hints: 0 });
  });

  it('keeps what is valid', () => {
    const scratch = { on: false, level: 'high', hints: 2 };
    expect(PreferencesStore.sanitize({ scratch }).scratch).toEqual(scratch);
  });

  it.each([
    ['not an object', 'yes'],
    ['a list', [1, 2]],
    ['wrong types', { on: 'no', level: 7, hints: 'many' }],
    ['an unknown level', { level: 'extreme' }],
  ])('falls back on %s, without touching other settings', (_name, scratch) => {
    const loaded = PreferencesStore.sanitize({ scratch, favs: ['#123456'] });
    expect(loaded.scratch).toEqual(DEFAULT_PREFS.scratch);
    expect(loaded.favs).toEqual(['#123456']);
  });

  it('keeps the counter whole and within its range, and drops unknown fields', () => {
    const load = (hints: unknown) => PreferencesStore.sanitize({ scratch: { hints, evil: '<img>' } }).scratch;
    expect(load(-5).hints).toBe(0);
    expect(load(99).hints).toBe(SCRATCH_HINT_COUNT);
    expect(load(1.7).hints).toBe(1);
    expect(load(Infinity).hints).toBe(0);
    expect(load(1)).not.toHaveProperty('evil');
  });
});

describe('speed', () => {
  /** A full page: lines of handwriting, 5,000 strokes of 40 points each. */
  function fullPage(): Stroke[] {
    return Array.from({ length: 5000 }, (_, i) => {
      const x = (i % 100) * 7;
      const y = Math.floor(i / 100) * 18;
      const points = curve((t) => [x + t, y + Math.sin(t) * 6 + 6], 6, 39);
      return ink('s' + i, points);
    });
  }

  it('takes less than a frame on a page of 5,000 strokes', () => {
    const strokes = fullPage();
    const boxes = new Map(strokes.map((stroke) => [stroke, boxOf(stroke)]));
    const scribble = ink('scribble', shaky(zigzagAcross(100, 300, 200, 14, 2), 0.5));
    const times: number[] = [];
    let erased = 0;
    for (let run = 0; run < 21; run++) {
      const page = pageFixture({ strokes, texts: [] });
      const controller = new ScratchOutController({
        prefs: PreferencesStore.sanitize({}),
        savePrefs: () => undefined,
        strokeBox: (stroke) => boxes.get(stroke) ?? boxOf(stroke),
        textBox,
        richText: (item) => item,
        glyphs: textGlyphs,
        naturalWidth: () => 0,
        hiddenTextOn: () => null,
        recordUndo: () => undefined,
        touch: () => undefined,
        fade: () => undefined,
        report: () => undefined,
        hint: () => undefined,
      });
      const start = performance.now();
      const done = controller.tryErase(page, scribble, 1);
      times.push(performance.now() - start);
      expect(done).toBe(true);
      erased = strokes.length - page.strokes.length;
    }
    const median = [...times].sort((a, b) => a - b)[10] ?? Infinity;
    console.info(`scratch out on 5,000 strokes: median ${median.toFixed(2)} ms, ${erased} erased`);
    expect(erased).toBeGreaterThan(0);
    expect(median).toBeLessThan(16);
  });

  it('writing costs next to nothing, however full the page is', () => {
    const stroke = ink('w', sawtooth(0, 0, H, 12, H * 0.25));
    const start = performance.now();
    for (let i = 0; i < 100; i++) ScribbleDetector.measure(stroke.p);
    expect((performance.now() - start) / 100).toBeLessThan(2);
  });
});
