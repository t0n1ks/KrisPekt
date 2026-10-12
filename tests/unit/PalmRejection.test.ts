import { describe, expect, it } from 'vitest';
import { Camera } from '../../src/canvas/Camera';
import { PageLayout } from '../../src/canvas/PageLayout';
import { DEFAULT_PREFS, PREFS_KEY } from '../../src/core/constants';
import { TouchClassifier, type TouchSample } from '../../src/domain/TouchClassifier';
import { GestureController } from '../../src/input/GestureController';
import { InputLog, type InputSample } from '../../src/input/InputLog';
import { PreferencesStore } from '../../src/storage/PreferencesStore';
import { page } from './fixtures';

/** A classifier with settings that tests can flip. */
function classifier(options: { twoFingerScroll?: boolean; twoFingerUndo?: boolean } = {}) {
  const settings = { twoFingerScroll: false, twoFingerUndo: true, ...options };
  const c = new TouchClassifier({
    twoFingerScroll: () => settings.twoFingerScroll,
    twoFingerUndo: () => settings.twoFingerUndo,
  });
  return { c, settings };
}

/** A finger-sized contact (10 × 10 px). */
function touch(id: number, x: number, y: number, time: number, size = 10): TouchSample {
  return { id, x, y, width: size, height: size, time };
}

describe('TouchClassifier: contact size', () => {
  it('treats a large contact as a palm for its whole life', () => {
    const { c } = classifier();
    expect(c.touchDown(touch(1, 100, 100, 0, 40), false)).toEqual([
      expect.objectContaining({ id: 1, from: null, to: 'palm' }),
    ]);
    // Shrinking or moving far does not bring it back.
    expect(c.touchMove(touch(1, 100, 300, 500, 8))).toEqual([]);
    expect(c.roleOf(1)).toBe('palm');
  });

  it('uses either dimension', () => {
    const { c } = classifier();
    c.touchDown({ id: 1, x: 0, y: 0, width: 12, height: 29, time: 0 }, false);
    expect(c.roleOf(1)).toBe('palm');
  });

  it('turns a panning finger that spreads past the threshold into a palm and stops the pan', () => {
    const { c } = classifier();
    c.touchDown(touch(1, 100, 100, 0, 12), false);
    expect(c.touchMove(touch(1, 100, 130, 100, 14))).toEqual([
      expect.objectContaining({ id: 1, from: 'pending', to: 'pan' }),
    ]);
    expect(c.touchMove(touch(1, 100, 140, 120, 34))).toEqual([
      expect.objectContaining({ id: 1, from: 'pan', to: 'palm' }),
    ]);
    expect(c.touchMove(touch(1, 100, 200, 140, 12))).toEqual([]);
  });

  it('drops a pinch when one contact spreads into a palm', () => {
    const { c } = classifier();
    c.touchDown(touch(1, 100, 100, 0), false);
    c.touchDown(touch(2, 200, 100, 10), false);
    const changes = c.touchMove(touch(2, 210, 100, 50, 40));
    expect(changes.map((ch) => [ch.id, ch.from, ch.to])).toEqual([
      [2, 'pinch', 'palm'],
      [1, 'pinch', 'held'],
    ]);
  });
});

describe('TouchClassifier: writing session', () => {
  it('pen hover keeps the session alive', () => {
    const { c } = classifier();
    c.penEvent('hover', 0);
    c.penEvent('hover', 1000);
    c.penEvent('hover', 2000);
    expect(c.inSession(3400)).toBe(true);
    expect(c.inSession(3500)).toBe(false);
  });

  it('blocks single-finger pans during a session and allows them 1.5 s after', () => {
    const { c } = classifier();
    c.penEvent('hover', 0);
    c.touchDown(touch(1, 100, 100, 1000), false);
    expect(c.roleOf(1)).toBe('held');
    expect(c.touchMove(touch(1, 100, 200, 1200))).toEqual([]);
    c.touchUp(1, 1300);

    c.touchDown(touch(2, 100, 100, 1500), false);
    expect(c.roleOf(2)).toBe('pending');
    expect(c.touchMove(touch(2, 100, 140, 1600))).toEqual([expect.objectContaining({ id: 2, to: 'pan' })]);
  });

  it('keeps finger drawing off during a session but lets two fingers pinch', () => {
    const { c } = classifier();
    c.penEvent('up', 0);
    c.touchDown(touch(1, 100, 100, 200), true);
    expect(c.roleOf(1)).toBe('held');
    c.touchDown(touch(2, 200, 100, 220), true);
    expect([c.roleOf(1), c.roleOf(2)]).toEqual(['pinch', 'pinch']);
  });

  it('ignores every touch while the pen is down', () => {
    const { c } = classifier();
    c.penEvent('down', 0);
    c.touchDown(touch(1, 100, 100, 10), false);
    c.touchDown(touch(2, 200, 100, 20), false);
    expect([c.roleOf(1), c.roleOf(2)]).toEqual(['palm', 'palm']);
  });

  it('a pen-down turns every finger into a palm', () => {
    const { c } = classifier();
    c.touchDown(touch(1, 100, 100, 0), true);
    expect(c.roleOf(1)).toBe('draw');
    const result = c.penEvent('down', 50);
    expect(result.changes).toEqual([expect.objectContaining({ id: 1, from: 'draw', to: 'palm' })]);
  });

  it('a pen hover stops a finger that is drawing', () => {
    const { c } = classifier();
    c.touchDown(touch(1, 100, 100, 0), true);
    expect(c.penEvent('hover', 30).changes).toEqual([
      expect.objectContaining({ id: 1, from: 'draw', to: 'palm' }),
    ]);
  });
});

describe('TouchClassifier: delayed pan start', () => {
  it('does not pan before 80 ms even after a long move', () => {
    const { c } = classifier();
    c.touchDown(touch(1, 100, 100, 0), false);
    expect(c.touchMove(touch(1, 100, 140, 40))).toEqual([]);
    expect(c.touchMove(touch(1, 100, 150, 80))).toEqual([expect.objectContaining({ to: 'pan' })]);
  });

  it('does not pan before the finger has moved 10 px', () => {
    const { c } = classifier();
    c.touchDown(touch(1, 100, 100, 0), false);
    expect(c.touchMove(touch(1, 100, 109, 200))).toEqual([]);
    expect(c.roleOf(1)).toBe('pending');
  });

  it('a pen event within 80 ms makes the touch a palm', () => {
    const { c } = classifier();
    c.touchDown(touch(1, 100, 100, 0), false);
    c.touchMove(touch(1, 100, 130, 40));
    expect(c.penEvent('hover', 60).changes).toEqual([
      expect.objectContaining({ id: 1, from: 'pending', to: 'palm' }),
    ]);
    expect(c.touchMove(touch(1, 100, 200, 300))).toEqual([]);
  });

  it('a pen event before 10 px makes the touch a palm', () => {
    const { c } = classifier();
    c.touchDown(touch(1, 100, 100, 0), false);
    c.touchMove(touch(1, 100, 105, 300));
    expect(c.penEvent('down', 320).changes).toEqual([expect.objectContaining({ id: 1, to: 'palm' })]);
  });

  it('a short still touch is a tap; a palm or a moved finger is not', () => {
    const { c } = classifier();
    c.touchDown(touch(1, 100, 100, 0), false);
    expect(c.touchUp(1, 150).tap).toEqual({ x: 100, y: 100 });
    c.touchDown(touch(2, 100, 100, 1000, 40), false);
    expect(c.touchUp(2, 1100).tap).toBeNull();
    c.touchDown(touch(3, 100, 100, 2000), false);
    c.touchMove(touch(3, 100, 120, 2100));
    expect(c.touchUp(3, 2150).tap).toBeNull();
  });

  it('with "scroll with two fingers only" a single finger never pans, but two still pinch', () => {
    const { c } = classifier({ twoFingerScroll: true });
    c.touchDown(touch(1, 100, 100, 0), false);
    expect(c.touchMove(touch(1, 100, 300, 500))).toEqual([]);
    c.touchDown(touch(2, 200, 100, 600), false);
    expect(c.roleOf(2)).toBe('pinch');
  });
});

describe('TouchClassifier: reverting an accidental scroll', () => {
  function panned(): TouchClassifier {
    const { c } = classifier();
    c.touchDown(touch(1, 100, 100, 0), false);
    c.touchMove(touch(1, 100, 150, 100));
    expect(c.roleOf(1)).toBe('pan');
    return c;
  }

  it('reverts when the pen lands during the pan', () => {
    const c = panned();
    const result = c.penEvent('down', 200);
    expect(result.revertPan).toBe(true);
    expect(result.changes).toEqual([expect.objectContaining({ id: 1, from: 'pan', to: 'palm' })]);
  });

  it('reverts when the pen lands within 700 ms after the pan ended', () => {
    const c = panned();
    c.touchUp(1, 300);
    expect(c.penEvent('down', 1000).revertPan).toBe(true);
    // Only once.
    c.penEvent('up', 1050);
    expect(c.penEvent('down', 1100).revertPan).toBe(false);
  });

  it('does not revert later than 700 ms', () => {
    const c = panned();
    c.touchUp(1, 300);
    expect(c.penEvent('down', 1001).revertPan).toBe(false);
  });

  it('a hover stops the pan, and a pen-down soon after reverts it', () => {
    const c = panned();
    expect(c.penEvent('hover', 200).changes).toEqual([expect.objectContaining({ from: 'pan', to: 'palm' })]);
    expect(c.penEvent('down', 600).revertPan).toBe(true);
  });

  it('GestureController puts the camera back where the pan started', () => {
    const camera = new Camera();
    camera.resize({ left: 0, top: 0, width: 800, height: 1000 }, 1);
    const layout = new PageLayout();
    layout.update([page({ id: 'a' }), page({ id: 'b' })]);
    const gestures = new GestureController({
      camera,
      layout,
      renderer: { request: () => undefined, render: () => undefined, setPinching: () => undefined },
    });
    camera.y = 100;
    camera.clampTo(layout);
    const start = camera.snapshot();
    gestures.beginPan(1, { x: 400, y: 500 });
    gestures.move(1, { x: 400, y: 300 });
    expect(camera.y).not.toBe(start.y);
    gestures.revertPan();
    expect(camera.snapshot()).toEqual(start);
    expect(gestures.hasTouch(1)).toBe(false);
  });
});

describe('TouchClassifier: several contacts', () => {
  it('ignores three or more touches until all lift', () => {
    const { c } = classifier();
    c.touchDown(touch(1, 100, 100, 0), false);
    c.touchDown(touch(2, 200, 100, 10), false);
    const changes = c.touchDown(touch(3, 300, 100, 20), false);
    expect(changes.map((ch) => ch.to)).toEqual(['grip', 'grip', 'grip']);
    c.touchUp(3, 100);
    c.touchUp(2, 110);
    expect(c.roleOf(1)).toBe('grip');
    c.touchDown(touch(4, 100, 100, 120), false);
    expect(c.roleOf(4)).toBe('grip');
    c.touchUp(1, 130);
    c.touchUp(4, 140);
    c.touchDown(touch(5, 100, 100, 3000), false);
    expect(c.roleOf(5)).toBe('pending');
  });

  it('the palm filter and the grip rule also apply to finger drawing', () => {
    const { c } = classifier();
    c.touchDown(touch(1, 100, 100, 0, 50), true);
    expect(c.roleOf(1)).toBe('palm');
    c.touchDown(touch(2, 100, 100, 10), true);
    c.touchDown(touch(3, 200, 100, 20), true);
    expect([c.roleOf(1), c.roleOf(2), c.roleOf(3)]).toEqual(['grip', 'grip', 'grip']);
  });

  it('leaves the pinch partner pending (not a tap) after a pinch', () => {
    const { c } = classifier();
    c.touchDown(touch(1, 100, 100, 0), false);
    c.touchDown(touch(2, 200, 100, 10), false);
    const lifted = c.touchUp(1, 100);
    expect(lifted.role).toBe('pinch');
    expect(lifted.changes).toEqual([expect.objectContaining({ id: 2, from: 'pinch', to: 'pending' })]);
    expect(c.touchUp(2, 150).tap).toBeNull();
  });
});

describe('TouchClassifier: two-finger undo', () => {
  it('does not undo when the setting is off', () => {
    const { c } = classifier({ twoFingerUndo: false });
    expect(c.allowsUndoTap(10_000)).toBe(false);
  });

  it('undoes when on and the pen has been quiet for 1 s', () => {
    const { c } = classifier();
    expect(c.allowsUndoTap(10)).toBe(true);
    c.penEvent('hover', 5000);
    expect(c.allowsUndoTap(5999)).toBe(false);
    expect(c.allowsUndoTap(6000)).toBe(true);
  });

  it('does not undo while the pen is down', () => {
    const { c } = classifier();
    c.penEvent('down', 0);
    expect(c.allowsUndoTap(5000)).toBe(false);
  });

  it('a palm and a finger never form a pinch, so they cannot undo', () => {
    const { c } = classifier();
    c.touchDown(touch(1, 100, 100, 0, 45), false);
    c.touchDown(touch(2, 200, 100, 10), false);
    expect(c.roleOf(1)).toBe('palm');
    expect(c.roleOf(2)).toBe('pending');
    expect(c.touchUp(2, 100).role).not.toBe('pinch');
  });
});

describe('InputLog', () => {
  const sample = (over: Partial<InputSample> = {}): InputSample => ({
    pointerType: 'touch',
    pointerId: 1,
    event: 'move',
    width: 10,
    height: 10,
    sizeFromTouch: false,
    pressure: 0.5,
    buttons: 1,
    cls: 'finger',
    role: 'pan',
    session: false,
    ...over,
  });

  it('merges repeated events and keeps the newest entries', () => {
    const log = new InputLog(3);
    log.push(sample());
    log.push(sample({ width: 12 }));
    expect(log.entries).toEqual([expect.objectContaining({ width: 12, count: 2 })]);
    for (let id = 2; id <= 5; id++) log.push(sample({ pointerId: id }));
    expect(log.entries.map((e) => e.pointerId)).toEqual([3, 4, 5]);
  });

  it('classifies pointers for display', () => {
    expect(InputLog.classify('pen', null)).toBe('pen');
    expect(InputLog.classify('touch', 'palm')).toBe('palm');
    expect(InputLog.classify('touch', 'grip')).toBe('ignored');
    expect(InputLog.classify('touch', 'held')).toBe('ignored');
    expect(InputLog.classify('touch', 'pan')).toBe('finger');
  });
});

describe('Preferences: touch settings', () => {
  it('default to two-finger undo on and one-finger scrolling', () => {
    localStorage.clear();
    const prefs = new PreferencesStore(localStorage).load();
    expect(prefs.twoFingerUndo).toBe(true);
    expect(prefs.twoFingerScroll).toBe(false);
    expect(DEFAULT_PREFS.twoFingerUndo).toBe(true);
  });

  it('persist and reject invalid values', () => {
    localStorage.clear();
    const store = new PreferencesStore(localStorage);
    const prefs = store.load();
    prefs.twoFingerUndo = false;
    prefs.twoFingerScroll = true;
    store.save(prefs);
    const loaded = new PreferencesStore(localStorage).load();
    expect(loaded.twoFingerUndo).toBe(false);
    expect(loaded.twoFingerScroll).toBe(true);
    localStorage.setItem(PREFS_KEY, JSON.stringify({ twoFingerUndo: 'no', twoFingerScroll: 1 }));
    const fallback = new PreferencesStore(localStorage).load();
    expect(fallback.twoFingerUndo).toBe(true);
    expect(fallback.twoFingerScroll).toBe(false);
  });
});
