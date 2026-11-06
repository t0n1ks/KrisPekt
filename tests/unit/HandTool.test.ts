import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HAND_HOLD_MS, LINK_TIP_WINDOW_MS, PAGE_CHIP_IDLE_MS } from '../../src/core/constants';
import type { Page, Point, ToolKind } from '../../src/core/types';
import { HandRules } from '../../src/domain/HandRules';
import { LassoHandToggle } from '../../src/domain/LassoHandToggle';
import { LinkTapTip } from '../../src/domain/LinkTapTip';
import { OneTimeHints } from '../../src/domain/OneTimeHints';
import { PageChipFade } from '../../src/domain/PageChipFade';
import { ToolbarLayout } from '../../src/domain/ToolbarLayout';
import { ToolRules } from '../../src/domain/ToolRules';
import { TouchClassifier } from '../../src/domain/TouchClassifier';
import { PreferencesStore } from '../../src/storage/PreferencesStore';
import { HandTool } from '../../src/tools/HandTool';
import type { ToolContext } from '../../src/tools/ToolContext';
import { ToolManager } from '../../src/tools/ToolManager';

describe('who opens links, cards and markers', () => {
  const tools: ToolKind[] = ['pen', 'hl', 'eraser', 'lasso', 'text', 'hand'];
  const others = tools.filter((tool) => tool !== 'hand');

  it.each(['pen', 'mouse', 'touch'])('the Hand opens them with a %s, whatever fingers do', (pointer) => {
    expect(ToolRules.opensTargets('hand', pointer, false)).toBe(true);
    expect(ToolRules.opensTargets('hand', pointer, true)).toBe(true);
  });

  it.each(others)('the %s never opens them with a stylus or a mouse', (tool) => {
    for (const fingerDraws of [false, true]) {
      expect(ToolRules.opensTargets(tool, 'pen', fingerDraws)).toBe(false);
      expect(ToolRules.opensTargets(tool, 'mouse', fingerDraws)).toBe(false);
    }
  });

  it.each(others)('with the %s, a finger opens them only when it does not draw', (tool) => {
    expect(ToolRules.opensTargets(tool, 'touch', false)).toBe(true);
    expect(ToolRules.opensTargets(tool, 'touch', true)).toBe(false);
  });

  it('only the tools that leave marks earn the tip', () => {
    expect(tools.filter((tool) => ToolRules.writes(tool))).toEqual(['pen', 'hl']);
  });

  it('a selection stays between the lasso and the Hand only', () => {
    expect(tools.filter((tool) => ToolRules.keepsSelection(tool))).toEqual(['lasso', 'hand']);
  });
});

describe('what a press with the Hand does', () => {
  it.each(['pen', 'mouse'])('a %s takes an object at once', (pointer) => {
    expect(HandRules.press(pointer, 'object')).toBe('grab');
  });

  it('a finger has to hold still on an object first', () => {
    expect(HandRules.press('touch', 'object')).toBe('hold');
  });

  it.each(['pen', 'mouse', 'touch'])(
    'a %s on empty paper scrolls, and takes a selection at once',
    (pointer) => {
      expect(HandRules.press(pointer, 'empty')).toBe('pan');
      expect(HandRules.press(pointer, 'selection')).toBe('move');
      expect(HandRules.press(pointer, 'handle')).toBe('scale');
    },
  );

  it('a finger moving too soon scrolls, after the hold it moves the object', () => {
    expect(HandRules.fingerDrag(HAND_HOLD_MS - 1, 20)).toBe('pan');
    expect(HandRules.fingerDrag(HAND_HOLD_MS, 20)).toBe('move');
  });

  it('a finger that has hardly moved is still undecided', () => {
    expect(HandRules.fingerDrag(10, 3)).toBe('wait');
    expect(HandRules.fingerDrag(HAND_HOLD_MS * 4, 3)).toBe('wait');
  });

  it('a tap selects an object, lets go on empty paper, and keeps a selection', () => {
    expect(HandRules.tap('object')).toBe('select');
    expect(HandRules.tap('empty')).toBe('deselect');
    expect(HandRules.tap('selection')).toBe('keep');
    expect(HandRules.tap('handle')).toBe('keep');
  });

  describe('the object under a point', () => {
    const box = () => ({ x0: 10, y0: 10, x1: 50, y1: 30 });
    const text = { id: 't' } as never;
    const image = { id: 'i', x: 0, y: 0, w: 100, h: 100 } as never;
    const card = { id: 'c', x: 40, y: 40, w: 50, h: 20 } as never;

    it('text lies over cards, and cards over photos', () => {
      const page = { texts: [text], cards: [card], images: [image] };
      expect(HandRules.objectAt(page, 20, 20, box)?.id).toBe('t');
      expect(HandRules.objectAt(page, 60, 50, box)?.id).toBe('c');
      expect(HandRules.objectAt(page, 80, 90, box)?.id).toBe('i');
    });

    it('ink and a PDF background are not objects', () => {
      const page = { texts: [], cards: [], images: [], strokes: [{ id: 's' }], bgBlob: 'pdf' };
      expect(HandRules.objectAt(page, 20, 20, box)).toBeNull();
    });
  });
});

describe('the Hand tool', () => {
  const hit = (pt: Point): 'handle' | 'inside' | null => (pt.x === 500 ? 'inside' : null);
  const image = { id: 'im', x: 0, y: 0, w: 100, h: 100 };
  const page = { strokes: [], texts: [], images: [image], cards: [] } as unknown as Page;

  function setup() {
    const selection = {
      hit,
      set: vi.fn(),
      clear: vi.fn(),
      setOffset: vi.fn(),
      setScaleFromDrag: vi.fn(),
      apply: vi.fn(),
      resetTransform: vi.fn(),
      itemBox: () => null,
    };
    const pan = { begin: vi.fn(), move: vi.fn(), release: vi.fn(), stop: vi.fn() };
    const drawing = { commitStroke: vi.fn(), scratchOut: vi.fn(), recordUndo: vi.fn() };
    const ctx = {
      camera: {
        z: 2,
        toWorld: (x: number, y: number): Point => ({ x, y }),
        toLocal: (x: number, y: number): Point => ({ x, y }),
      },
      layout: { pageAt: (x: number) => (x < 400 ? page : null), toPage: (_p: Page, w: Point) => w },
      texts: { contentBox: () => ({ x0: 0, y0: 0, x1: 0, y1: 0 }) },
      selection,
      pan,
      requestLive: vi.fn(),
      requestRender: vi.fn(),
      ...drawing,
    } as unknown as ToolContext;
    return { tool: new HandTool(ctx), selection, pan, drawing };
  }
  const event = (x: number, y: number, pointerType = 'pen'): PointerEvent =>
    ({ pointerId: 1, pointerType, clientX: x, clientY: y }) as PointerEvent;

  it('a stylus on empty paper scrolls, and leaves no mark', () => {
    const { tool, pan, drawing, selection } = setup();
    tool.onPointerDown(event(600, 10), { x: 600, y: 10 });
    tool.onPointerMove(event(600, 90));
    tool.onPointerUp(event(600, 90));
    expect(pan.begin).toHaveBeenCalledOnce();
    expect(pan.move).toHaveBeenCalledOnce();
    expect(pan.release).toHaveBeenCalledOnce();
    expect(selection.clear).not.toHaveBeenCalled();
    expect(drawing.commitStroke).not.toHaveBeenCalled();
    expect(drawing.scratchOut).not.toHaveBeenCalled();
    expect(drawing.recordUndo).not.toHaveBeenCalled();
    expect(tool.activePointer).toBeNull();
  });

  it('a stylus tap on empty paper lets go of the selection', () => {
    const { tool, selection } = setup();
    tool.onPointerDown(event(600, 10), { x: 600, y: 10 });
    tool.onPointerUp(event(600, 10));
    expect(selection.clear).toHaveBeenCalledOnce();
  });

  it('a stylus tap on an object selects it', () => {
    const { tool, selection, pan } = setup();
    tool.onPointerDown(event(50, 50), { x: 50, y: 50 });
    tool.onPointerUp(event(50, 50));
    expect(selection.set).toHaveBeenCalledWith(page, new Set(['im']));
    expect(pan.begin).not.toHaveBeenCalled();
    expect(selection.apply).not.toHaveBeenCalled();
  });

  it('a stylus drag selects the object and moves it, in page px, applied on release', () => {
    const { tool, selection } = setup();
    tool.onPointerDown(event(50, 50), { x: 50, y: 50 });
    tool.onPointerMove(event(90, 70));
    expect(selection.set).toHaveBeenCalledOnce();
    expect(selection.setOffset).toHaveBeenLastCalledWith(20, 10);
    tool.onPointerUp(event(90, 70));
    expect(selection.apply).toHaveBeenCalledOnce();
    expect(selection.set).toHaveBeenCalledOnce();
  });

  it('dropping out of a move puts the object back', () => {
    const { tool, selection } = setup();
    tool.onPointerDown(event(50, 50), { x: 50, y: 50 });
    tool.onPointerMove(event(90, 70));
    tool.onPointerCancel();
    expect(selection.resetTransform).toHaveBeenCalledOnce();
    expect(selection.apply).not.toHaveBeenCalled();
    expect(tool.activePointer).toBeNull();
  });

  it('a second finger finishes a move rather than losing it', () => {
    const { tool, selection } = setup();
    tool.onPointerDown(event(50, 50, 'touch'), { x: 50, y: 50 });
    tool.onPointerMove(event(90, 70, 'touch'));
    tool.onInterrupt();
    expect(selection.apply).toHaveBeenCalledOnce();
  });

  it('a finger tap selects, and on empty paper lets go', () => {
    const { tool, selection } = setup();
    tool.onTap({ x: 50, y: 50 });
    expect(selection.set).toHaveBeenCalledOnce();
    tool.onTap({ x: 600, y: 50 });
    expect(selection.clear).toHaveBeenCalledOnce();
  });

  it('a finger tap inside a selection keeps it', () => {
    const { tool, selection } = setup();
    tool.onTap({ x: 500, y: 50 });
    expect(selection.set).not.toHaveBeenCalled();
    expect(selection.clear).not.toHaveBeenCalled();
  });

  it('only a held finger can pick up, and only an object', () => {
    const { tool } = setup();
    expect(tool.holdableAt({ x: 50, y: 50 })).toBe(true);
    expect(tool.holdableAt({ x: 600, y: 50 })).toBe(false);
    expect(tool.holdableAt({ x: 500, y: 50 })).toBe(false);
    expect(tool.acceptsTouchAt({ x: 500, y: 50 })).toBe(true);
    expect(tool.acceptsTouchAt({ x: 50, y: 50 })).toBe(false);
  });

  it('fingers do not draw with it even when finger drawing is on', () => {
    const { tool } = setup();
    const prefs = { fingerDraw: true } as never;
    const manager = new ToolManager([tool], () => prefs, vi.fn());
    expect(manager.navigates).toBe(true);
    expect(manager.acceptsTouchAt({ x: 50, y: 50 })).toBe(false);
  });
});

describe('a finger taken by the tool', () => {
  const options = { twoFingerScroll: () => false, twoFingerUndo: () => false };
  const sample = (time: number) => ({ id: 1, x: 0, y: 0, width: 8, height: 8, time });

  it('becomes the tool’s only while still undecided', () => {
    const classifier = new TouchClassifier(options);
    classifier.touchDown(sample(0), false);
    expect(classifier.claim(1)).toBe(true);
    expect(classifier.roleOf(1)).toBe('draw');
    expect(classifier.claim(1)).toBe(false);
    expect(classifier.claim(9)).toBe(false);
  });

  it('is not taken during a writing session', () => {
    const classifier = new TouchClassifier(options);
    classifier.penEvent('hover', 0);
    classifier.touchDown(sample(10), false);
    expect(classifier.claim(1)).toBe(false);
  });

  it('one finger may scroll once the setting lets it, which the Hand always does', () => {
    const navigating = { twoFingerScroll: () => false, twoFingerUndo: () => false };
    const classifier = new TouchClassifier(navigating);
    classifier.touchDown(sample(0), false);
    const moved = classifier.touchMove({ ...sample(200), x: 40 });
    expect(moved.map((change) => change.to)).toEqual(['pan']);
  });
});

describe('the button shared by the lasso and the Hand', () => {
  it('a tap with one in use gives the other', () => {
    expect(LassoHandToggle.afterTap('lasso', 'lasso')).toBe('hand');
    expect(LassoHandToggle.afterTap('hand', 'hand')).toBe('lasso');
  });

  it('from another tool a tap comes back to the last one used, the lasso at first', () => {
    expect(LassoHandToggle.afterTap('pen', undefined)).toBe('lasso');
    expect(LassoHandToggle.afterTap('pen', 'hand')).toBe('hand');
    expect(LassoHandToggle.afterTap(null, 'hand')).toBe('hand');
  });

  it('shows the one in use, or else the last one used', () => {
    expect(LassoHandToggle.shown('hand', 'lasso')).toBe('hand');
    expect(LassoHandToggle.shown('lasso', 'hand')).toBe('lasso');
    expect(LassoHandToggle.shown('pen', 'hand')).toBe('hand');
    expect(LassoHandToggle.shown(null, undefined)).toBe('lasso');
  });

  it('with the Hand on a button of its own, the shared button stays the lasso', () => {
    expect(LassoHandToggle.shown('hand', 'hand', true)).toBe('lasso');
    expect(LassoHandToggle.shown('pen', 'hand', true)).toBe('lasso');
    expect(LassoHandToggle.shown('lasso', 'hand', true)).toBe('lasso');
    expect(LassoHandToggle.afterTap('pen', 'hand', true)).toBe('lasso');
    expect(LassoHandToggle.afterTap('hand', 'hand', true)).toBe('lasso');
    expect(LassoHandToggle.afterTap('lasso', 'lasso', true)).toBe('hand');
  });

  it('the lasso button stands in for a hidden Hand button, so the bar has no second Hand', () => {
    expect(LassoHandToggle.itemOnBar('hand', new Set(['hand']))).toBe('lasso');
    expect(LassoHandToggle.itemOnBar('hand', new Set(['lasso', 'hand']))).toBe('lasso');
    expect(LassoHandToggle.itemOnBar('hand', new Set(['lasso']))).toBe('hand');
    expect(LassoHandToggle.itemOnBar('hand', new Set())).toBe('hand');
    expect(LassoHandToggle.itemOnBar('pen', new Set(['pen', 'hand']))).toBe('pen');
  });

  it('in the toolbar the Hand starts hidden, and a layout from before it stays as it was', () => {
    expect(ToolbarLayout.defaults([]).hidden).toEqual(['hand']);
    const old = ToolbarLayout.resolve({ order: ['pen', 'lasso', 'undo', 'redo'], hidden: ['ruler'] }, []);
    expect(old.hidden).toEqual(['ruler', 'hand']);
    expect(old.order).toContain('hand');
  });

  it('a Hand that was asked for stays on the bar', () => {
    const shown = ToolbarLayout.withHidden(ToolbarLayout.defaults([]), 'hand', false);
    expect(ToolbarLayout.resolve(shown, []).hidden).toEqual([]);
    expect(ToolbarLayout.toolOf('hand')).toBe('hand');
    expect(ToolbarLayout.canHide(shown, 'hand', [])).toBe(true);
  });
});

describe('one-time hints', () => {
  it('are due until shown, each on its own', () => {
    expect(OneTimeHints.due(undefined, 'handToggle')).toBe(true);
    const counts = OneTimeHints.shown(undefined, 'handToggle');
    expect(OneTimeHints.due(counts, 'handToggle')).toBe(false);
    expect(OneTimeHints.due(counts, 'linkTip')).toBe(true);
  });

  it('are stored as optional, checked fields', () => {
    const clean = PreferencesStore.sanitize({
      hints: { handToggle: 1, linkTip: 'x', evil: 5 },
      lassoSlot: 'hand',
    });
    expect(clean.hints).toEqual({ handToggle: 1, linkTip: 0 });
    expect(clean.lassoSlot).toBe('hand');
    const old = PreferencesStore.sanitize({ hints: 'nope', lassoSlot: 'pen' });
    expect(old.hints).toBeUndefined();
    expect(old.lassoSlot).toBeUndefined();
    expect(PreferencesStore.sanitize({ hints: { linkTip: 1e9 } }).hints?.linkTip).toBe(99);
  });

  it('the tip comes with the second tap in a short time', () => {
    const tip = new LinkTapTip();
    expect(tip.tapped(1000)).toBe(false);
    expect(tip.tapped(1000 + LINK_TIP_WINDOW_MS)).toBe(true);
    expect(tip.tapped(1000 + LINK_TIP_WINDOW_MS + 1)).toBe(false);
  });

  it('two taps far apart earn no tip', () => {
    const tip = new LinkTapTip();
    tip.tapped(0);
    expect(tip.tapped(LINK_TIP_WINDOW_MS + 1)).toBe(false);
  });
});

describe('the page button', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  const pen = (event: string) => ({ pointerType: 'pen', event, buttons: 1, role: null });

  function fade() {
    let faded = false;
    const chip = new PageChipFade((value) => (faded = value));
    return { chip, isFaded: () => faded };
  }

  it('fades while the stylus writes, and only comes back after the idle time', () => {
    const { chip, isFaded } = fade();
    chip.input(pen('down'), true);
    expect(isFaded()).toBe(true);
    vi.advanceTimersByTime(PAGE_CHIP_IDLE_MS * 3);
    expect(isFaded()).toBe(true);
    chip.input(pen('up'), true);
    vi.advanceTimersByTime(PAGE_CHIP_IDLE_MS - 1);
    expect(isFaded()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(isFaded()).toBe(false);
  });

  it('a hovering stylus fades it too, and each hover keeps it away', () => {
    const { chip, isFaded } = fade();
    chip.input(pen('hover'), true);
    expect(isFaded()).toBe(true);
    vi.advanceTimersByTime(PAGE_CHIP_IDLE_MS - 1);
    chip.input(pen('hover'), true);
    vi.advanceTimersByTime(PAGE_CHIP_IDLE_MS - 1);
    expect(isFaded()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(isFaded()).toBe(false);
  });

  it('a finger only counts while it draws, so it can still reach the button', () => {
    const { chip, isFaded } = fade();
    chip.input({ pointerType: 'touch', event: 'down', buttons: 1, role: 'pending' }, true);
    expect(isFaded()).toBe(false);
    chip.input({ pointerType: 'touch', event: 'down', buttons: 1, role: 'draw' }, true);
    expect(isFaded()).toBe(true);
  });

  it('a mouse counts with its button down, not when it passes by', () => {
    const { chip, isFaded } = fade();
    chip.input({ pointerType: 'mouse', event: 'move', buttons: 0, role: null }, true);
    expect(isFaded()).toBe(false);
    chip.input({ pointerType: 'mouse', event: 'down', buttons: 1, role: null }, true);
    expect(isFaded()).toBe(true);
  });

  it('the Hand does not write, so the button stays', () => {
    const { chip, isFaded } = fade();
    chip.input(pen('down'), false);
    expect(isFaded()).toBe(false);
  });

  it('a stroke that ended while the tool changed still brings it back', () => {
    const { chip, isFaded } = fade();
    chip.input(pen('down'), true);
    chip.input(pen('up'), false);
    vi.advanceTimersByTime(PAGE_CHIP_IDLE_MS);
    expect(isFaded()).toBe(false);
  });

  it('comes back at once on reset', () => {
    const { chip, isFaded } = fade();
    chip.input(pen('down'), true);
    chip.reset();
    expect(isFaded()).toBe(false);
  });
});
