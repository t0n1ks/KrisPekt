import { describe, expect, it, vi } from 'vitest';
import { TextLayout } from '../../src/canvas/TextLayout';
import type { TextItem, TextParagraph } from '../../src/core/types';
import { ItemTransform } from '../../src/domain/ItemTransform';
import { PastedText } from '../../src/domain/PastedText';
import { RichText } from '../../src/domain/RichText';
import { RichTextLayout } from '../../src/domain/RichTextLayout';
import { SelectionClipboard } from '../../src/domain/SelectionClipboard';
import { TEXT_MIN_WIDTH, TEXT_PAGE_MARGIN, TextBoxRules } from '../../src/domain/TextBoxRules';
import { TextEditHistory } from '../../src/domain/TextEditHistory';
import { ValidationError } from '../../src/storage/validation/guards';
import { parsePage, parseText } from '../../src/storage/validation/records';
import { PreferencesStore } from '../../src/storage/PreferencesStore';
import { page } from './fixtures';

/** Every character is half as wide as the font size; bold ones are 20 % wider. */
const measurer = () => ({
  font: '',
  measureText(text: string) {
    const size = Number(/([\d.]+)px/.exec(this.font)?.[1] ?? 10);
    const k = this.font.includes('700') ? 0.6 : 0.5;
    return { width: text.length * size * k };
  },
});

const PAGE = { width: 800, height: 1100 };
const base = { fs: 20, c: '#111111' };
const plain = (...lines: string[]): TextParagraph[] => lines.map((t) => ({ runs: [{ t }] }));
const rich = (paras: TextParagraph[], over: Partial<TextItem> = {}): TextItem => ({
  id: 't1',
  x: 10,
  y: 20,
  w: 200,
  t: RichText.plainText(paras),
  fs: 20,
  c: '#111111',
  paras,
  ...over,
});
const texts = (laidLines: { runs: { text: string }[] }[]): string[] =>
  laidLines.map((line) => line.runs.map((run) => run.text).join(''));

describe('auto-sizing rules', () => {
  it('a new box is small: about three characters, on one line, around the tap', () => {
    const box = TextBoxRules.placeNew(100, 200, 20, PAGE);
    expect(box.w).toBe(60);
    expect(box.x).toBe(100);
    expect(box.y).toBeCloseTo(200 - 13.5);
  });

  it('a tap at the very top or left of a page stays inside it (was above the page edge)', () => {
    const box = TextBoxRules.placeNew(0, 1, 20, PAGE);
    expect(box.y).toBe(0);
    expect(box.x).toBe(0);
  });

  it('a tap at the far corner still leaves room for a line and the margin', () => {
    const box = TextBoxRules.placeNew(799, 1099, 20, PAGE);
    expect(box.x + box.w).toBeLessThanOrEqual(PAGE.width - TEXT_PAGE_MARGIN);
    expect(box.y + 27).toBeCloseTo(PAGE.height);
  });

  it('auto-width follows the text', () => {
    expect(TextBoxRules.autoWidth(0, 100, 20, PAGE)).toBe(60);
    expect(TextBoxRules.autoWidth(300.2, 100, 20, PAGE)).toBe(303);
  });

  it('auto-width stops at the right page margin', () => {
    expect(TextBoxRules.autoWidth(5000, 100, 20, PAGE)).toBe(PAGE.width - TEXT_PAGE_MARGIN - 100);
  });
});

describe('resizing and moving', () => {
  const start = { x: 100, y: 50, w: 200 };

  it('the right side changes only the width, within the page', () => {
    expect(TextBoxRules.resized(start, 'right', 50, PAGE)).toEqual({ x: 100, y: 50, w: 250 });
    expect(TextBoxRules.resized(start, 'right', 5000, PAGE).w).toBe(700);
  });

  it('the left side keeps the right edge in place', () => {
    const box = TextBoxRules.resized(start, 'left', 40, PAGE);
    expect(box.x).toBe(140);
    expect(box.x + box.w).toBe(300);
    expect(TextBoxRules.resized(start, 'left', -500, PAGE).x).toBe(0);
  });

  it('there is a minimum width', () => {
    expect(TextBoxRules.resized(start, 'right', -5000, PAGE).w).toBe(TEXT_MIN_WIDTH);
    const left = TextBoxRules.resized(start, 'left', 5000, PAGE);
    expect(left.w).toBe(TEXT_MIN_WIDTH);
    expect(left.x + left.w).toBe(300);
  });

  it('boxes stay inside the page', () => {
    expect(TextBoxRules.keptInside({ x: -50, y: -9, w: 100 }, 40, PAGE)).toEqual({ x: 0, y: 0, w: 100 });
    expect(TextBoxRules.keptInside({ x: 790, y: 1090, w: 100 }, 40, PAGE)).toEqual({
      x: 700,
      y: 1060,
      w: 100,
    });
  });

  it('a box taller than the page stays at the top, so its start can be read', () => {
    expect(TextBoxRules.keptInside({ x: 0, y: 300, w: 100 }, 5000, PAGE).y).toBe(0);
  });
});

describe('rich text layout', () => {
  const layout = (): RichTextLayout => new RichTextLayout(measurer());

  it('wraps at spaces, and whitespace at a line end takes no room', () => {
    // At 20 px a character is 10 px wide, so 100 px hold 10 characters.
    const { lines } = layout().layout(plain('hello world again'), 100, base);
    expect(texts(lines)).toEqual(['hello', 'world', 'again']);
    expect(texts(layout().layout(plain('1234567890 x'), 100, base).lines)).toEqual(['1234567890', 'x']);
  });

  it('breaks a word too long for a line between characters (it used to run off the page)', () => {
    const { lines } = layout().layout(plain('Ж'.repeat(25)), 100, base);
    expect(texts(lines)).toEqual(['Ж'.repeat(10), 'Ж'.repeat(10), 'Ж'.repeat(5)]);
  });

  it('keeps emoji and combining marks whole when breaking a word', () => {
    const { lines } = layout().layout(plain('😀😀😀😀😀😀😀😀'), 45, base);
    for (const line of texts(lines)) expect(line.length % 2).toBe(0);
  });

  it('breaks after a hyphen but not before a number', () => {
    expect(RichTextLayout.breakPoints('well-known')).toEqual([5, 10]);
    expect(RichTextLayout.breakPoints('a-5')).toEqual([3]);
    expect(RichTextLayout.breakPoints('-5')).toEqual([2]);
    expect(RichTextLayout.breakPoints('and/or')).toEqual([4, 6]);
    expect(RichTextLayout.breakPoints('one two')).toEqual([4, 7]);
  });

  it('height follows the lines, never more, never less', () => {
    const one = layout().layout(plain('short'), 100, base);
    const three = layout().layout(plain('hello world again'), 100, base);
    expect(one.lines).toHaveLength(1);
    expect(one.height).toBeCloseTo(27, 0);
    expect(three.height).toBeCloseTo(one.height * 3, 5);
  });

  it('an empty paragraph has the height of a line', () => {
    expect(layout().layout(plain('a', '', 'b'), 100, base).lines).toHaveLength(3);
  });

  it('a line is as tall as its largest font, and runs share a baseline', () => {
    const paras: TextParagraph[] = [{ runs: [{ t: 'small ' }, { t: 'BIG', fs: 40 }] }];
    const { lines } = layout().layout(paras, 500, base);
    const line = lines[0];
    expect(line?.height).toBeCloseTo(54, 0);
    expect(line?.runs.map((run) => run.style.fs)).toEqual([20, 40]);
    expect(line?.baseline).toBeGreaterThan(30);
  });

  it('measures bold runs in the bold font', () => {
    const paras: TextParagraph[] = [{ runs: [{ t: 'aa' }, { t: 'bb', b: true }] }];
    const line = layout().layout(paras, 500, base).lines[0];
    expect(line?.runs[0]?.width).toBe(20);
    expect(line?.runs[1]?.width).toBe(24);
    expect(line?.runs[1]?.x).toBe(20);
  });

  it('breaks a line inside a word whose letters have different styles only where the word may break', () => {
    const paras: TextParagraph[] = [{ runs: [{ t: 'one tw' }, { t: 'o', b: true }, { t: ' three' }] }];
    expect(texts(layout().layout(paras, 80, base).lines)).toEqual(['one two', 'three']);
  });

  it('aligns lines inside the box', () => {
    const center: TextParagraph[] = [{ align: 'center', runs: [{ t: 'abcd' }] }];
    const right: TextParagraph[] = [{ align: 'right', runs: [{ t: 'abcd' }] }];
    expect(layout().layout(center, 100, base).lines[0]?.runs[0]?.x).toBe(30);
    expect(layout().layout(right, 100, base).lines[0]?.runs[0]?.x).toBe(60);
  });

  it('indents lists and numbers them; another paragraph restarts the count', () => {
    const paras: TextParagraph[] = [
      { list: 'number', runs: [{ t: 'one' }] },
      { list: 'number', runs: [{ t: 'two' }] },
      { runs: [{ t: 'gap' }] },
      { list: 'number', runs: [{ t: 'one' }] },
      { list: 'bullet', runs: [{ t: 'dot' }] },
    ];
    const { lines } = layout().layout(paras, 500, base);
    expect(lines.map((line) => line.marker?.text ?? null)).toEqual(['1.', '2.', null, '1.', '•']);
    expect(lines[0]?.runs[0]?.x).toBe(30);
    expect(lines[2]?.runs[0]?.x).toBe(0);
  });

  it('a wrapped list item keeps its indent, and shows its marker once', () => {
    const paras: TextParagraph[] = [{ list: 'bullet', runs: [{ t: 'hello world' }] }];
    const { lines } = layout().layout(paras, 90, base);
    expect(lines.map((line) => line.runs[0]?.x)).toEqual([30, 30]);
    expect(lines[1]?.marker).toBeNull();
  });

  it('natural width is what the widest paragraph needs', () => {
    expect(layout().naturalWidth(plain('abc', 'abcde'), base)).toBe(50);
    expect(layout().naturalWidth([{ list: 'bullet', runs: [{ t: 'abc' }] }], base)).toBe(60);
    expect(layout().naturalWidth(plain('abc '), base)).toBe(40);
  });
});

describe('formatting ranges', () => {
  const hello: TextParagraph[] = plain('hello world');

  it('splits runs around the formatted part', () => {
    const out = RichText.applyStyle(hello, 6, 11, { b: true });
    expect(out[0]?.runs).toEqual([{ t: 'hello ' }, { t: 'world', b: true }]);
    const middle = RichText.applyStyle(hello, 2, 4, { i: true });
    expect(middle[0]?.runs).toEqual([{ t: 'he' }, { t: 'll', i: true }, { t: 'o world' }]);
  });

  it('merges runs that end up the same', () => {
    const on = RichText.applyStyle(hello, 2, 4, { b: true });
    expect(RichText.applyStyle(on, 2, 4, { b: false })[0]?.runs).toEqual([{ t: 'hello world' }]);
    const joined = RichText.applyStyle(RichText.applyStyle(hello, 0, 5, { u: true }), 5, 11, { u: true });
    expect(joined[0]?.runs).toEqual([{ t: 'hello world', u: true }]);
  });

  it('works across paragraphs', () => {
    const out = RichText.applyStyle(plain('abc', 'def', 'ghi'), 2, 10, { c: '#ff0000' });
    expect(out.map((p) => p.runs)).toEqual([
      [{ t: 'ab' }, { t: 'c', c: '#ff0000' }],
      [{ t: 'def', c: '#ff0000' }],
      [{ t: 'gh', c: '#ff0000' }, { t: 'i' }],
    ]);
  });

  it('never changes the value it was given', () => {
    const input = plain('abc');
    const copy = JSON.stringify(input);
    RichText.applyStyle(input, 0, 3, { b: true });
    RichText.applyParagraph(input, 0, 3, { align: 'center' });
    expect(JSON.stringify(input)).toBe(copy);
  });

  it('styles an empty paragraph, so what is typed there is styled', () => {
    expect(RichText.applyStyle(plain(''), 0, 0, { b: true, fs: 30 })[0]?.runs).toEqual([
      { t: '', b: true, fs: 30 },
    ]);
  });

  it('reports what a range has in common', () => {
    const mixed: TextParagraph[] = [
      {
        runs: [
          { t: 'aa', b: true, fs: 30 },
          { t: 'bb', b: true },
        ],
      },
    ];
    expect(RichText.commonStyle(mixed, 0, 4)).toEqual({ b: true });
    expect(RichText.commonStyle(mixed, 0, 2)).toEqual({ b: true, fs: 30 });
  });

  it('a caret takes the style of the character before it', () => {
    const mixed: TextParagraph[] = [{ runs: [{ t: 'aa', b: true }, { t: 'bb' }] }];
    expect(RichText.commonStyle(mixed, 2, 2)).toEqual({ b: true });
    expect(RichText.commonStyle(mixed, 3, 3)).toEqual({});
  });

  it('paragraph settings apply to every paragraph the range touches', () => {
    const out = RichText.applyParagraph(plain('abc', 'def', 'ghi'), 2, 4, { align: 'right' });
    expect(out.map((p) => p.align)).toEqual(['right', 'right', undefined]);
    expect(RichText.applyParagraph(out, 0, 0, { align: null })[0]).toEqual({ runs: [{ t: 'abc' }] });
  });

  it('lists switch on and off', () => {
    const on = RichText.applyParagraph(plain('a', 'b'), 0, 2, { list: 'number' });
    expect(on.map((p) => p.list)).toEqual(['number', 'number']);
    expect(RichText.applyParagraph(on, 0, 2, { list: null }).map((p) => p.list)).toEqual([
      undefined,
      undefined,
    ]);
  });

  it('inserts plain text with line breaks into the middle of styled text', () => {
    const start: TextParagraph[] = [{ align: 'center', runs: [{ t: 'ab', b: true }, { t: 'cd' }] }];
    const out = RichText.replaceRange(start, 1, 3, 'X\nY', { b: true });
    expect(RichText.plainText(out)).toBe('aX\nYd');
    expect(out[0]).toEqual({ align: 'center', runs: [{ t: 'aX', b: true }] });
    expect(out[1]).toEqual({ align: 'center', runs: [{ t: 'Y', b: true }, { t: 'd' }] });
  });

  it('replacing across paragraphs joins them', () => {
    const out = RichText.replaceRange(plain('abc', 'def'), 2, 5, '-', {});
    expect(RichText.plainText(out)).toBe('ab-ef');
    expect(out).toHaveLength(1);
  });

  it('trims trailing spaces and empty paragraphs, and only those', () => {
    const out = RichText.trimmedEnd(plain('  keep  me  ', '', '   '));
    expect(RichText.plainText(out)).toBe('  keep  me');
    expect(RichText.plainText(RichText.trimmedEnd(plain('a', '', 'b')))).toBe('a\n\nb');
  });

  it('a box of only spaces and empty lines is blank', () => {
    expect(RichText.isBlank(plain('  ', ''))).toBe(true);
    expect(RichText.isBlank(plain(' a'))).toBe(false);
  });
});

describe('old text items', () => {
  const old: TextItem = {
    id: 'old',
    x: 5,
    y: 6,
    w: 100,
    t: 'hello world\nsecond-line text',
    fs: 20,
    c: '#123456',
  };

  it('load unchanged, with no new fields', () => {
    expect(parseText({ ...old })).toEqual(old);
    expect(parseText({ ...old }).paras).toBeUndefined();
    expect(parseText({ ...old }).auto).toBeUndefined();
  });

  it('render exactly as they did: whitespace wrapping and the same positions', () => {
    const layout = new TextLayout(measurer());
    const lh = 20 * 1.35;
    const off = (lh - 20) / 2;
    expect(layout.runs(old)).toEqual([
      { text: 'hello', x: 5, top: 6 + off, size: 20, color: '#123456' },
      { text: 'world', x: 5, top: 6 + lh + off, size: 20, color: '#123456' },
      { text: 'second-line', x: 5, top: 6 + 2 * lh + off, size: 20, color: '#123456' },
      { text: 'text', x: 5, top: 6 + 3 * lh + off, size: 20, color: '#123456' },
    ]);
    expect(layout.box(old)).toEqual({ x0: 5, y0: 6, x1: 105, y1: 6 + 4 * lh });
  });

  it('become rich when edited, with their text in place', () => {
    const layout = new TextLayout(measurer());
    const migrated = layout.migrated(old);
    expect(migrated.paras).toEqual(plain('hello world', 'second-line text'));
    expect(migrated.auto).toBeUndefined();
    expect(migrated.w).toBe(100);
    const first = layout.laid(migrated).lines[0];
    const oldBaseline = 6 + (20 * 1.35 - 20) / 2 + (20 * 970) / 1275;
    expect(migrated.y + (first?.baseline ?? 0)).toBeCloseTo(oldBaseline, 5);
  });

  it('are not touched by a rich item having been migrated', () => {
    const layout = new TextLayout(measurer());
    const already = rich(plain('x'));
    expect(layout.migrated(already)).toBe(already);
  });
});

describe('visible text box', () => {
  it('is what the lasso goes by: an old wide box with a short text', () => {
    const layout = new TextLayout(measurer());
    const old: TextItem = { id: 'a', x: 100, y: 0, w: 420, t: 'Hi', fs: 20, c: '#000000' };
    const box = layout.contentBox(old);
    expect(box.x0).toBe(100);
    expect(box.x1).toBe(120);
    // The rule: the middle of this box is inside the lasso. The middle of the whole box is far off.
    expect((box.x0 + box.x1) / 2).toBe(110);
    expect((layout.box(old).x0 + layout.box(old).x1) / 2).toBe(310);
  });

  it('follows the alignment of rich text', () => {
    const layout = new TextLayout(measurer());
    const item = rich([{ align: 'right', runs: [{ t: 'ab' }] }]);
    expect(layout.contentBox(item).x0).toBe(10 + 180);
    expect(layout.contentBox(item).x1).toBe(10 + 200);
  });
});

describe('drawing', () => {
  const sink = () => ({ text: vi.fn(), fillRect: vi.fn() });

  it('emits styled runs on one baseline', () => {
    const layout = new TextLayout(measurer());
    const out = sink();
    layout.emit(
      out,
      rich([
        {
          runs: [
            { t: 'ab', b: true },
            { t: 'cd', i: true, c: '#ff0000', fs: 30 },
          ],
        },
      ]),
    );
    const [first, second] = out.text.mock.calls.map((call) => call[0]);
    expect(first).toMatchObject({ text: 'ab', bold: true, size: 20, color: '#111111' });
    expect(second).toMatchObject({ text: 'cd', italic: true, size: 30, color: '#ff0000' });
    expect(first.bold && second.bold).toBeFalsy();
    expect(first.baseline).toBe(second.baseline);
  });

  it('underlines and strikes as rectangles, so every export gets the same', () => {
    const layout = new TextLayout(measurer());
    const out = sink();
    layout.emit(out, rich([{ runs: [{ t: 'ab', u: true }, { t: 'cd', s: true }, { t: 'ef' }] }]));
    expect(out.fillRect).toHaveBeenCalledTimes(2);
    const [[ux, uy, uw], [sx, sy, sw]] = out.fillRect.mock.calls;
    expect(ux).toBe(10);
    expect(uw).toBe(20);
    expect(sx).toBe(30);
    expect(sw).toBe(20);
    expect(uy).toBeGreaterThan(sy);
  });

  it('draws list markers', () => {
    const layout = new TextLayout(measurer());
    const out = sink();
    layout.emit(out, rich([{ list: 'number', runs: [{ t: 'x' }] }]));
    expect(out.text.mock.calls.map((call) => call[0].text)).toEqual(['1.', 'x']);
  });

  it('old items draw with no baseline and no decoration', () => {
    const layout = new TextLayout(measurer());
    const out = sink();
    layout.emit(out, { id: 'a', x: 0, y: 0, w: 100, t: 'x', fs: 10, c: '#000000' });
    expect(out.text.mock.calls[0]?.[0].baseline).toBeUndefined();
    expect(out.fillRect).not.toHaveBeenCalled();
  });

  it('forgets layouts when fonts arrive', () => {
    const m = measurer();
    const layout = new TextLayout(m);
    const item = rich(plain('hello world'), { w: 60 });
    expect(layout.laid(item).lines).toHaveLength(2);
    m.measureText = () => ({ width: 1 });
    expect(layout.laid(item).lines).toHaveLength(2);
    layout.reset();
    expect(layout.laid(item).lines).toHaveLength(1);
  });
});

describe('moving and scaling rich text', () => {
  it('scales the sizes that runs set themselves, and keeps the rest', () => {
    const item = rich([{ runs: [{ t: 'a', fs: 20 }, { t: 'b' }] }]);
    const out = ItemTransform.map(
      { strokes: [], texts: [item], images: [], cards: [] },
      { ox: 0, oy: 0, k: 2, dx: 0, dy: 0 },
    ).texts[0];
    expect(out?.fs).toBe(40);
    expect(out?.w).toBe(400);
    expect(out?.paras?.[0]?.runs).toEqual([{ t: 'a', fs: 40 }, { t: 'b' }]);
  });

  it('keeps sizes within the limits', () => {
    const item = rich([{ runs: [{ t: 'a', fs: 150 }] }]);
    const out = ItemTransform.map(
      { strokes: [], texts: [item], images: [], cards: [] },
      { ox: 0, oy: 0, k: 3, dx: 0, dy: 0 },
    ).texts[0];
    expect(out?.paras?.[0]?.runs[0]?.fs).toBe(200);
  });

  it('a pure move shares the paragraphs, keeps the auto flag and changes no size', () => {
    const paras = plain('x');
    const out = ItemTransform.map(
      { strokes: [], texts: [rich(paras, { auto: true })], images: [], cards: [] },
      ItemTransform.translation(5, 6),
    ).texts[0];
    expect(out).toMatchObject({ x: 15, y: 26, auto: true, fs: 20 });
    expect(out?.paras).toBe(paras);
  });
});

describe('the selection clipboard', () => {
  const items = {
    strokes: [{ id: 's', k: 'pen' as const, c: '#000000', s: 2, p: new Float32Array([1, 2, 1]) }],
    texts: [rich(plain('x'))],
    images: [{ id: 'i', x: 1, y: 2, w: 3, h: 4, blob: 'photo' }],
    cards: [],
  };

  it('starts empty', () => {
    const clip = new SelectionClipboard();
    expect(clip.isEmpty).toBe(true);
    expect(clip.pasted(0, 0, () => 'x')).toBeNull();
  });

  it('pastes moved copies with new ids, as many times as wanted', () => {
    const clip = new SelectionClipboard();
    clip.copy(items, { x0: 0, y0: 0, x1: 10, y1: 10 });
    let n = 0;
    const out = clip.pasted(100, 200, () => 'new' + ++n);
    expect(out?.texts[0]).toMatchObject({ id: 'new2', x: 110, y: 220 });
    expect(out?.strokes[0]?.id).toBe('new1');
    expect(out?.images[0]?.id).toBe('new3');
    expect(clip.pasted(0, 0, () => 'other')?.texts[0]?.x).toBe(10);
    expect(items.texts[0]?.x).toBe(10);
  });

  it('names the images it holds, so they are not cleaned up', () => {
    const clip = new SelectionClipboard();
    clip.copy(items, { x0: 0, y0: 0, x1: 1, y1: 1 });
    expect(clip.blobIds()).toEqual(['photo']);
  });
});

describe('undo steps while typing', () => {
  it('groups a burst of typing into one step', () => {
    const h = new TextEditHistory<string>();
    h.record('', 'typing', 0);
    h.record('a', 'typing', 100);
    h.record('ab', 'typing', 200);
    expect(h.undo('abc')).toBe('');
    expect(h.canUndo).toBe(false);
  });

  it('a pause starts a new step', () => {
    const h = new TextEditHistory<string>();
    h.record('', 'typing', 0);
    h.record('a', 'typing', 5000);
    expect(h.undo('ab')).toBe('a');
    expect(h.undo('a')).toBe('');
  });

  it('the end of a word starts a new step', () => {
    const h = new TextEditHistory<string>();
    h.record('', 'typing', 0);
    h.record('a', 'typing', 10, true);
    h.record('a ', 'typing', 20);
    expect(h.undo('a b')).toBe('a ');
    expect(h.undo('a ')).toBe('');
  });

  it('anything else is a step of its own', () => {
    const h = new TextEditHistory<string>();
    h.record('', 'typing', 0);
    h.record('a', 'other', 10);
    h.record('A', 'typing', 20);
    expect(h.undo('Ab')).toBe('A');
    expect(h.undo('A')).toBe('a');
    expect(h.undo('a')).toBe('');
  });

  it('redo goes forward, and new changes clear it', () => {
    const h = new TextEditHistory<string>();
    h.record('', 'typing', 0);
    expect(h.undo('a')).toBe('');
    expect(h.redo('')).toBe('a');
    expect(h.undo('a')).toBe('');
    h.record('', 'other', 1);
    expect(h.canRedo).toBe(false);
    expect(h.redo('x')).toBeNull();
  });
});

describe('pasted text', () => {
  it('normalises line breaks and tabs', () => {
    expect(PastedText.clean('a\r\nb\rc\td')).toBe('a\nb\nc    d');
  });

  it('removes control and invisible characters, and keeps the rest', () => {
    const zeroWidth = String.fromCharCode(0x200b);
    const rtlOverride = String.fromCharCode(0x202e);
    const nul = String.fromCharCode(0);
    expect(PastedText.clean(`a${nul}b${zeroWidth}c${rtlOverride}d Жё 😀`)).toBe('abcd Жё 😀');
  });

  it('treats markup as the plain text it is', () => {
    const html = '<img src=x onerror=alert(1)><b>hi</b>';
    expect(PastedText.clean(html)).toBe(html);
  });

  it('cuts to the room left without breaking a surrogate pair', () => {
    expect(PastedText.limited('abc', 5)).toBe('abc');
    expect(PastedText.limited('abc', 2)).toBe('ab');
    expect(PastedText.limited('a😀', 2)).toBe('a');
    expect(PastedText.limited('abc', 0)).toBe('');
  });
});

describe('validating stored and backed up text', () => {
  const valid = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    id: 'abc',
    x: 1,
    y: 2,
    w: 100,
    t: 'ignored',
    fs: 18,
    c: '#000000',
    auto: true,
    paras: [
      {
        align: 'center',
        list: 'bullet',
        runs: [{ t: 'hi', fs: 20, c: '#ff0000', b: true, i: true, u: true, s: true }],
      },
    ],
    ...over,
  });
  const withRun = (run: Record<string, unknown>): Record<string, unknown> =>
    valid({ paras: [{ runs: [{ t: 'x', ...run }] }] });

  it('accepts a full new item, and takes the plain text from the runs', () => {
    const item = parseText(valid());
    expect(item.t).toBe('hi');
    expect(item.auto).toBe(true);
    expect(item.paras?.[0]).toEqual({
      align: 'center',
      list: 'bullet',
      runs: [{ t: 'hi', fs: 20, c: '#ff0000', b: true, i: true, u: true, s: true }],
    });
  });

  it('drops unknown fields', () => {
    const item = parseText(
      valid({ evil: '<script>', paras: [{ evil: 1, runs: [{ t: 'x', href: '#evil' }] }] }),
    );
    expect(item).not.toHaveProperty('evil');
    expect(item.paras?.[0]).toEqual({ runs: [{ t: 'x' }] });
  });

  it.each([
    ['a font size too large', { fs: 201 }],
    ['a font size too small', { fs: 5 }],
    ['a font size that is not a number', { fs: '18' }],
    ['a colour that is not #rrggbb', { c: 'red' }],
    ['a colour with a url', { c: 'url(http://x)' }],
    ['a bold flag that is not true', { b: 1 }],
    ['an italic flag set to false', { i: false }],
    ['a line break in a run', { t: 'a\nb' }],
    ['text that is not a string', { t: 5 }],
  ])('rejects %s', (_name, run) => {
    expect(() => parseText(withRun(run))).toThrow(ValidationError);
  });

  it.each([
    ['no paragraphs', { paras: [] }],
    ['paragraphs that are not a list', { paras: 'x' }],
    ['a paragraph without runs', { paras: [{ runs: [] }] }],
    ['an unknown alignment', { paras: [{ align: 'justify', runs: [{ t: 'x' }] }] }],
    ['an unknown list', { paras: [{ list: 'roman', runs: [{ t: 'x' }] }] }],
    ['an auto flag that is not true', { auto: 'yes' }],
  ])('rejects %s', (_name, over) => {
    expect(() => parseText(valid(over))).toThrow(ValidationError);
  });

  it('limits the total length and the number of runs', () => {
    const long = Array.from({ length: 3 }, () => ({ runs: [{ t: 'x'.repeat(9000) }] }));
    expect(() => parseText(valid({ paras: long }))).toThrow(ValidationError);
    const many = Array.from({ length: 5000 }, () => ({ runs: [{ t: 'x' }] }));
    expect(() => parseText(valid({ paras: many }))).toThrow(ValidationError);
  });

  it('a page with one bad text is rejected as a whole, as any other bad record', () => {
    expect(() => parsePage(page({ texts: [withRun({ c: 'red' }) as never] }))).toThrow(ValidationError);
  });

  it('survives a trip through a backup file', () => {
    const item = parseText(valid());
    expect(parseText(JSON.parse(JSON.stringify(item)))).toEqual(item);
  });
});

describe('the last used text style', () => {
  it('is stored, and old preferences without it still load', () => {
    const fresh = PreferencesStore.sanitize({ txt: { fs: 18, c: '#000000' } });
    expect(fresh.txt).toEqual({ fs: 18, c: '#000000' });
    const styled = PreferencesStore.sanitize({ txt: { fs: 24, c: '#ff0000', b: true, i: 'yes', evil: 1 } });
    expect(styled.txt).toEqual({ fs: 24, c: '#ff0000', b: true });
  });
});
