import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../../src/app/EventBus';
import { DEFAULT_PREFS, MAX_TOOL_PRESETS } from '../../src/core/constants';
import type { Preferences, ToolPreset } from '../../src/core/types';
import { ToolbarLayout } from '../../src/domain/ToolbarLayout';
import { ToolbarOverflow, type OverflowItem } from '../../src/domain/ToolbarOverflow';
import { ToolPresets } from '../../src/domain/ToolPresets';
import { ToolPresetController } from '../../src/editor/ToolPresetController';
import { PreferencesStore } from '../../src/storage/PreferencesStore';
import { ToolbarPrefsParser } from '../../src/storage/ToolbarPrefsParser';

const prefs = (): Preferences => PreferencesStore.sanitize({});
const fountain: ToolPreset = { id: 'a1', tool: 'pen', brush: 'fountain', c: '#0000ff', s: 3 };
const pencil: ToolPreset = { id: 'a2', tool: 'pen', brush: 'pencil', c: '#808080', s: 2 };

function controller(p = prefs()): { p: Preferences; c: ToolPresetController; bus: EventBus } {
  const bus = new EventBus();
  let n = 0;
  return { p, c: new ToolPresetController(p, () => 'new' + ++n, bus), bus };
}

describe('tool presets', () => {
  it('capture what makes each tool what it is', () => {
    const p = prefs();
    p.brush = 'fountain';
    p.brushes.fountain = { c: '#112233', s: 5 };
    p.er = { mode: 'whole', r: 30 };
    p.txt = { fs: 24, c: '#445566', b: true };
    expect(ToolPresets.capture(p, 'pen', 'x')).toEqual({
      id: 'x',
      tool: 'pen',
      brush: 'fountain',
      c: '#112233',
      s: 5,
    });
    expect(ToolPresets.capture(p, 'hl', 'x')).toEqual({ id: 'x', tool: 'hl', ...p.hl });
    expect(ToolPresets.capture(p, 'eraser', 'x')).toEqual({ id: 'x', tool: 'eraser', mode: 'whole', r: 30 });
    expect(ToolPresets.capture(p, 'text', 'x')).toEqual({
      id: 'x',
      tool: 'text',
      fs: 24,
      c: '#445566',
      b: true,
    });
  });

  it('the lasso cannot be pinned: it has no settings', () => {
    expect(ToolPresets.isPinnable('lasso')).toBe(false);
    expect(ToolPresets.isPinnable('hand')).toBe(false);
    expect(ToolPresets.isPinnable('pen')).toBe(true);
  });

  it('activating a preset makes its settings the working ones', () => {
    const { p, c } = controller();
    p.presets = [fountain];
    expect(c.activate('a1')).toBe(true);
    expect(p.brush).toBe('fountain');
    expect(p.brushes.fountain).toEqual({ c: '#0000ff', s: 3 });
    expect(c.active).toEqual(fountain);
    expect(c.activate('nope')).toBe(false);
  });

  it('changing a setting while active updates the preset, and tells the toolbar', () => {
    const { p, c, bus } = controller();
    const changed = vi.fn();
    bus.on('toolbar-changed', changed);
    p.presets = [fountain, pencil];
    c.activate('a1');
    c.sync();
    expect(changed).not.toHaveBeenCalled();
    p.brushes.fountain.s = 7;
    c.sync();
    expect(p.presets[0]).toEqual({ ...fountain, s: 7 });
    expect(p.presets[1]).toEqual(pencil);
    expect(changed).toHaveBeenCalledOnce();
  });

  it('changing the brush while active changes the brush of the preset', () => {
    const { p, c } = controller();
    p.presets = [fountain];
    c.activate('a1');
    p.brush = 'brush';
    c.sync();
    expect(p.presets[0]).toMatchObject({ brush: 'brush', ...p.brushes.brush });
  });

  it('a preset does not change the base tools', () => {
    const { p, c } = controller();
    p.brushes.fountain = { c: '#111111', s: 1 };
    p.brush = 'ballpoint';
    p.presets = [fountain];
    c.activate('a1');
    p.brushes.fountain.s = 9;
    c.sync();
    expect(c.base.brush).toBe('ballpoint');
    expect(c.base.brushes.fountain).toEqual({ c: '#111111', s: 1 });
    c.leave();
    expect(p.brush).toBe('ballpoint');
    expect(p.brushes.fountain).toEqual({ c: '#111111', s: 1 });
    expect(p.presetBase).toBeUndefined();
  });

  it('switching between presets does not leak settings from one to the other', () => {
    const { p, c } = controller();
    const ballpoint = { ...p.brushes.ballpoint };
    p.presets = [fountain, { id: 'a3', tool: 'pen', brush: 'ballpoint', c: '#ff0000', s: 4 }];
    c.activate('a3');
    c.activate('a1');
    expect(c.active?.id).toBe('a1');
    expect(c.base.brushes.ballpoint).toEqual(ballpoint);
    c.leave();
    expect(p.brushes.ballpoint).toEqual(ballpoint);
  });

  it('a reload puts the base settings back and no preset is in use', () => {
    const { p, c } = controller();
    p.brush = 'ballpoint';
    p.presets = [fountain];
    c.activate('a1');
    const loaded = PreferencesStore.sanitize(JSON.parse(JSON.stringify(p)));
    expect(loaded.brush).toBe('ballpoint');
    expect(loaded.presetBase).toBeUndefined();
    expect(loaded.brushes.fountain).toEqual(DEFAULT_PREFS.brushes.fountain);
    expect(loaded.presets).toEqual([fountain]);
  });

  it('selecting another tool leaves the preset; the same tool keeps it', () => {
    const { p, c } = controller();
    p.presets = [fountain];
    c.activate('a1');
    c.toolChanged('pen');
    expect(c.active?.id).toBe('a1');
    c.toolChanged('hl');
    expect(c.active).toBeNull();
  });

  it('pinning takes the current settings and goes on from there', () => {
    const { p, c } = controller();
    p.brush = 'pencil';
    const preset = c.pinCurrent('pen');
    expect(preset).toMatchObject({ tool: 'pen', brush: 'pencil', ...p.brushes.pencil });
    expect(c.active?.id).toBe(preset?.id);
  });

  it('holds at most twelve', () => {
    const { p, c } = controller();
    for (let i = 0; i < MAX_TOOL_PRESETS; i++) expect(c.add('hl')).not.toBeNull();
    expect(p.presets).toHaveLength(12);
    expect(c.add('hl')).toBeNull();
    expect(c.duplicate(p.presets?.[0]?.id ?? '')).toBe(false);
    expect(p.presets).toHaveLength(12);
  });

  it('duplicates next to the original, on the bar too', () => {
    const { p, c } = controller();
    p.presets = [fountain, pencil];
    expect(c.duplicate('a1')).toBe(true);
    expect(p.presets.map((x) => x.id)).toEqual(['a1', 'new1', 'a2']);
    expect(p.presets[1]).toEqual({ ...fountain, id: 'new1' });
    const { order } = ToolbarLayout.resolve(p.toolbar, p.presets);
    expect(order.indexOf('preset:new1')).toBe(order.indexOf('preset:a1') + 1);
  });

  it('unpinning removes it from the list and the bar, and leaves it if in use', () => {
    const { p, c } = controller();
    p.brush = 'ballpoint';
    p.presets = [fountain, pencil];
    p.toolbar = ToolbarLayout.defaults(p.presets);
    c.activate('a1');
    c.unpin('a1');
    expect(p.presets.map((x) => x.id)).toEqual(['a2']);
    expect(p.toolbar.order).not.toContain('preset:a1');
    expect(c.active).toBeNull();
    expect(p.brush).toBe('ballpoint');
  });

  it('the width hint goes from 0 to 1 over the range of the tool', () => {
    expect(ToolPresets.widthHint({ ...pencil, s: 0.6 })).toBe(0);
    expect(ToolPresets.widthHint({ ...pencil, s: 6 })).toBe(1);
    expect(ToolPresets.widthHint({ id: 'e', tool: 'eraser', mode: 'part', r: 33 })).toBeCloseTo(0.5);
    expect(ToolPresets.colorOf({ id: 'e', tool: 'eraser', mode: 'part', r: 33 })).toBeNull();
  });
});

describe('stored presets and layout', () => {
  it.each([
    ['a bad id', { ...fountain, id: 'a b<' }],
    ['an id that is not text', { ...fountain, id: 5 }],
    ['an unknown tool', { ...fountain, tool: 'laser' }],
    ['the lasso', { id: 'x', tool: 'lasso' }],
    ['an unknown brush', { ...fountain, brush: 'crayon' }],
    ['a colour that is not #RRGGBB', { ...fountain, c: 'red' }],
    ['a width above the range', { ...fountain, s: 11 }],
    ['a width below the range', { ...fountain, s: 0.1 }],
    ['a width that is not a number', { ...fountain, s: '3' }],
    ['an infinite width', { ...fountain, s: Infinity }],
    ['an unknown eraser mode', { id: 'x', tool: 'eraser', mode: 'all', r: 10 }],
    ['a highlighter too thin', { id: 'x', tool: 'hl', c: '#000000', s: 1 }],
    ['a font size too large', { id: 'x', tool: 'text', c: '#000000', fs: 500 }],
    ['not an object', 'preset'],
  ])('leaves out %s', (_name, bad) => {
    expect(ToolbarPrefsParser.presets([bad, pencil])).toEqual([pencil]);
  });

  it('drops unknown fields and repeated ids, and stops at the maximum', () => {
    expect(ToolbarPrefsParser.presets([{ ...fountain, evil: '<img>' }, fountain])).toEqual([fountain]);
    const many = Array.from({ length: 20 }, (_, i) => ({ ...fountain, id: 'p' + i }));
    expect(ToolbarPrefsParser.presets(many)).toHaveLength(MAX_TOOL_PRESETS);
    expect(ToolbarPrefsParser.presets('nope')).toEqual([]);
  });

  it('keeps only the known style flags of a text preset', () => {
    const raw = { id: 'x', tool: 'text', c: '#000000', fs: 20, b: true, i: 'yes', x: true };
    expect(ToolbarPrefsParser.presets([raw])).toEqual([
      { id: 'x', tool: 'text', c: '#000000', fs: 20, b: true },
    ]);
  });

  it('a damaged toolbar falls back to defaults without touching other settings', () => {
    const loaded = PreferencesStore.sanitize({
      toolbar: { order: 'x', hidden: 5 },
      presets: 12,
      favs: ['#123456'],
      fingerDraw: false,
    });
    expect(loaded.toolbar).toBeUndefined();
    expect(loaded.presets).toBeUndefined();
    expect(loaded.favs).toEqual(['#123456']);
    expect(loaded.fingerDraw).toBe(false);
  });

  it('old settings without any of this still load, and gain nothing', () => {
    const loaded = PreferencesStore.sanitize({ favs: ['#123456'] });
    expect(loaded).not.toHaveProperty('presets');
    expect(loaded).not.toHaveProperty('toolbar');
    expect(loaded).not.toHaveProperty('presetBase');
  });

  it('a damaged copy of the base settings cannot break the tools', () => {
    const loaded = PreferencesStore.sanitize({ presetBase: { brush: 'crayon', hl: { c: 'red', s: 999 } } });
    expect(loaded.brush).toBe(DEFAULT_PREFS.brush);
    expect(loaded.hl.c).toBe(DEFAULT_PREFS.hl.c);
    expect(loaded.hl.s).toBeLessThanOrEqual(40);
  });

  it('a layout survives a trip through storage', () => {
    const layout = ToolbarLayout.defaults([fountain]);
    const parsed = ToolbarPrefsParser.toolbar(JSON.parse(JSON.stringify(layout)));
    expect(parsed).toEqual(layout);
  });
});

describe('toolbar layout', () => {
  it('has a default order with presets after the tools', () => {
    expect(ToolbarLayout.defaults([fountain]).order).toEqual([
      'pen',
      'hl',
      'eraser',
      'lasso',
      'hand',
      'text',
      'preset:a1',
      'colors',
      'ruler',
      'image',
      'attach',
      'undo',
      'redo',
    ]);
  });

  it('removes unknown items, repeats and hidden essentials', () => {
    const layout = ToolbarLayout.resolve(
      { order: ['redo', 'evil', 'redo', 'pen'], hidden: ['undo', 'evil', 'ruler', 'ruler'] },
      [],
    );
    expect(layout.order).not.toContain('evil');
    expect(layout.order.filter((id) => id === 'redo')).toHaveLength(1);
    expect(layout.hidden).toEqual(['ruler', 'hand']);
  });

  it('keeps the user order, and brings back base items it does not know', () => {
    const { order } = ToolbarLayout.resolve({ order: ['redo', 'pen'], hidden: [] }, []);
    expect(order.indexOf('redo')).toBeLessThan(order.indexOf('pen'));
    expect(order).toEqual(
      expect.arrayContaining(['hl', 'eraser', 'lasso', 'text', 'colors', 'ruler', 'image', 'attach', 'undo']),
    );
    expect(order).toHaveLength(12);
  });

  it('a new preset lands after the last tool or preset', () => {
    const start = ToolbarLayout.defaults([fountain]);
    const { order } = ToolbarLayout.resolve(start, [fountain, pencil]);
    expect(order.indexOf('preset:a2')).toBe(order.indexOf('preset:a1') + 1);
  });

  it('a preset gone from the list is gone from the layout', () => {
    const start = ToolbarLayout.defaults([fountain]);
    expect(ToolbarLayout.resolve(start, []).order).not.toContain('preset:a1');
  });

  it('moves an item, within bounds', () => {
    const order = ['a', 'b', 'c'];
    expect(ToolbarLayout.moved(order, 'a', 2)).toEqual(['b', 'c', 'a']);
    expect(ToolbarLayout.moved(order, 'c', 0)).toEqual(['c', 'a', 'b']);
    expect(ToolbarLayout.moved(order, 'c', -5)).toEqual(['c', 'a', 'b']);
    expect(ToolbarLayout.moved(order, 'a', 99)).toEqual(['b', 'c', 'a']);
    expect(ToolbarLayout.moved(order, 'x', 1)).toEqual(order);
  });

  it('undo and redo cannot be hidden', () => {
    const layout = ToolbarLayout.defaults([]);
    expect(ToolbarLayout.canHide(layout, 'undo', [])).toBe(false);
    expect(ToolbarLayout.canHide(layout, 'redo', [])).toBe(false);
    expect(ToolbarLayout.canHide(layout, 'ruler', [])).toBe(true);
  });

  it('the last thing to write with cannot be hidden', () => {
    const layout = ToolbarLayout.defaults([fountain]);
    expect(ToolbarLayout.canHide(layout, 'pen', [fountain])).toBe(true);
    const noPen = ToolbarLayout.withHidden(layout, 'pen', true);
    expect(ToolbarLayout.canHide(noPen, 'preset:a1', [fountain])).toBe(false);
    expect(ToolbarLayout.canHide(ToolbarLayout.defaults([]), 'pen', [])).toBe(false);
  });

  it('shows and hides', () => {
    const hidden = ToolbarLayout.withHidden(ToolbarLayout.defaults([]), 'ruler', true);
    expect(hidden.hidden).toEqual(['hand', 'ruler']);
    expect(ToolbarLayout.withHidden(hidden, 'ruler', false).hidden).toEqual(['hand']);
  });

  it('reset gives the default order, shows all but the Hand and keeps the presets', () => {
    const presets = [fountain];
    const reset = ToolbarLayout.defaults(presets);
    expect(reset.hidden).toEqual(['hand']);
    expect(reset.order).toContain('preset:a1');
  });
});

describe('priority overflow', () => {
  const W = 44;
  const G = 2;
  const items = (active = 'pen'): OverflowItem[] =>
    ToolbarLayout.defaults([fountain, pencil]).order.map((id) => ({
      id,
      width: id === 'colors' ? 3 * W : W,
      priority: ToolbarLayout.priority(id),
      always: id === 'undo' || id === 'redo' || id === active,
    }));
  const total = items().reduce((sum, item) => sum + item.width + G, 0);
  const place = (available: number, active?: string) =>
    ToolbarOverflow.compute(items(active), available, W, G);

  it('with room for everything, nothing overflows and the order stays', () => {
    const { bar, overflow } = place(total + W);
    expect(overflow).toEqual([]);
    expect(bar).toEqual(ToolbarLayout.defaults([fountain, pencil]).order);
  });

  it('as the bar narrows, the lowest priority goes first', () => {
    expect(place(total + W - 1).overflow).toEqual(['attach']);
    expect(place(total + W - 1 - (W + G)).overflow).toEqual(['image', 'attach']);
    expect(place(total + W - 1 - 2 * (W + G)).overflow).toEqual(['ruler', 'image', 'attach']);
  });

  it('a wide item that does not fit lets a narrower one take the room', () => {
    // Without the attachment, the image and the ruler, the room left is less than the colours' three buttons.
    const { overflow, bar } = place(total + W - 3 * (W + G) - 1);
    expect(overflow).toContain('colors');
    expect(bar).toContain('ruler');
  });

  it('on the narrowest bar there are still the active tool, undo and redo', () => {
    const { bar, overflow } = place(150);
    expect(bar).toEqual(['pen', 'undo', 'redo']);
    expect(overflow).toHaveLength(items().length - 3);
  });

  it('never goes over the available width while there is a choice', () => {
    for (const width of [200, 320, 390, 600, 768, 1000, 1280]) {
      const { bar } = place(width);
      const used = items()
        .filter((item) => bar.includes(item.id))
        .reduce((sum, item) => sum + item.width + G, W);
      expect(used).toBeLessThanOrEqual(width);
    }
  });

  it('an active tool from the end of the priorities stays, and pushes another out', () => {
    const before = place(250);
    expect(before.bar).not.toContain('image');
    const after = place(250, 'image');
    expect(after.bar).toContain('image');
    expect(after.bar).toHaveLength(before.bar.length);
    expect(after.bar).toContain('pen');
  });

  it('among equals, the one further left stays', () => {
    const { bar } = place(4 * (W + G) + W);
    expect(bar).toContain('pen');
    const one = ToolbarOverflow.compute(
      [
        { id: 'a', width: W, priority: 1, always: false },
        { id: 'b', width: W, priority: 1, always: false },
      ],
      2 * W + G,
      W,
      G,
    );
    expect(one).toEqual({ bar: ['a'], overflow: ['b'] });
  });

  it('keeps the user order on the bar and in the overflow', () => {
    const { bar, overflow } = place(400);
    const order = ToolbarLayout.defaults([fountain, pencil]).order;
    expect(bar).toEqual(order.filter((id) => bar.includes(id)));
    expect(overflow).toEqual(order.filter((id) => overflow.includes(id)));
  });
});
