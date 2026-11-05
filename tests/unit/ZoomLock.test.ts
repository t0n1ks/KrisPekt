import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Camera } from '../../src/canvas/Camera';
import { PageLayout } from '../../src/canvas/PageLayout';
import { ZOOM_LOCK_HINT_MS, ZOOM_MAX, ZOOM_MIN } from '../../src/core/constants';
import type { Notebook } from '../../src/core/types';
import { PinchIntent } from '../../src/domain/PinchIntent';
import { I18n } from '../../src/i18n/I18n';
import { GestureController } from '../../src/input/GestureController';
import { BackupService } from '../../src/storage/BackupService';
import { Database } from '../../src/storage/Database';
import { NotebookRepository } from '../../src/storage/NotebookRepository';
import { RecordReader } from '../../src/storage/RecordReader';
import { parseNotebook } from '../../src/storage/validation/records';
import type { MenuItem } from '../../src/ui/dialogs/Menu';
import { ZoomMenu } from '../../src/ui/editor/ZoomMenu';
import { backupJson, notebook, page } from './fixtures';

/** A camera locked at 1.4 over pages of different sizes, and gestures driving it. */
function lockedRig() {
  const camera = new Camera();
  camera.resize({ left: 0, top: 0, width: 1000, height: 800 }, 1);
  const layout = new PageLayout();
  layout.update([page({ id: 'a' }), page({ id: 'b', w: 297, h: 210 }), page({ id: 'c', w: 148, h: 210 })]);
  camera.setZoomLock(1.4);
  camera.clampTo(layout);
  const onZoomBlocked = vi.fn();
  const gestures = new GestureController({
    camera,
    layout,
    renderer: { request: () => undefined, render: () => undefined, setPinching: () => undefined },
    onZoomBlocked,
  });
  return { camera, layout, gestures, onZoomBlocked };
}

const ctrlWheel = (deltaY: number): WheelEvent => new WheelEvent('wheel', { deltaY, ctrlKey: true });

describe('Camera zoom lock', () => {
  it('ignores every request to change the zoom while locked', () => {
    const camera = new Camera();
    camera.setZoomLock(1.4);
    camera.setZoom(3);
    camera.zoomAt({ x: 100, y: 100 }, 0.5);
    expect(camera.z).toBe(1.4);
    expect(camera.zoomLocked).toBe(true);
  });

  it('keeps the position when a locked zoom refuses zoomAt', () => {
    const camera = new Camera();
    camera.setZoomLock(1.4);
    camera.x = 50;
    camera.y = 70;
    camera.zoomAt({ x: 100, y: 100 }, 3);
    expect(camera.toWorld(0, 0)).toEqual({ x: 50, y: 70 });
  });

  it('zooms again after unlocking, from where it was', () => {
    const camera = new Camera();
    camera.setZoomLock(1.4);
    camera.setZoomLock(null);
    expect(camera.z).toBe(1.4);
    camera.setZoom(2);
    expect(camera.z).toBe(2);
  });

  it('clamps a locked value to the allowed range', () => {
    const camera = new Camera();
    camera.setZoomLock(ZOOM_MAX * 10);
    expect(camera.z).toBe(ZOOM_MAX);
  });
});

describe('gestures with a locked zoom', () => {
  it('a pinch does not zoom, reports the attempt once and still pans with the fingers', () => {
    const { camera, gestures, onZoomBlocked } = lockedRig();
    const before = camera.snapshot();
    gestures.beginPinch([1, { x: 400, y: 400 }], [2, { x: 600, y: 400 }]);
    gestures.move(2, { x: 800, y: 400 });
    gestures.move(2, { x: 900, y: 400 });
    expect(camera.z).toBe(1.4);
    expect(onZoomBlocked).toHaveBeenCalledTimes(1);
    gestures.move(1, { x: 400, y: 300 });
    gestures.move(2, { x: 900, y: 300 });
    expect(camera.y).toBeGreaterThan(before.y);
    expect(camera.z).toBe(1.4);
  });

  it('a two-finger scroll moves the page without any hint', () => {
    const { camera, gestures, onZoomBlocked } = lockedRig();
    const startY = camera.y;
    gestures.beginPinch([1, { x: 400, y: 600 }], [2, { x: 520, y: 600 }]);
    for (let y = 590; y >= 300; y -= 10) {
      gestures.move(1, { x: 400, y });
      gestures.move(2, { x: 520, y });
    }
    expect(camera.y).toBeCloseTo(startY + 300 / 1.4);
    expect(camera.z).toBe(1.4);
    expect(onZoomBlocked).not.toHaveBeenCalled();
  });

  it('one-finger panning with inertia state keeps the zoom', () => {
    const { camera, gestures } = lockedRig();
    const startY = camera.y;
    gestures.beginPan(1, { x: 400, y: 600 });
    gestures.move(1, { x: 400, y: 300 });
    expect(camera.y).toBeGreaterThan(startY);
    expect(camera.z).toBe(1.4);
    gestures.stop();
  });

  it('Ctrl + wheel neither zooms nor scrolls, and reports the attempt', () => {
    const { camera, gestures, onZoomBlocked } = lockedRig();
    const before = camera.snapshot();
    gestures.wheel(ctrlWheel(-100), { x: 500, y: 400 });
    expect(camera.snapshot()).toEqual(before);
    expect(onZoomBlocked).toHaveBeenCalledTimes(1);
  });

  it('a plain wheel still scrolls across pages of different sizes at the same zoom', () => {
    const { camera, layout, gestures } = lockedRig();
    const visited = new Set<number>();
    for (let i = 0; i < 100; i++) {
      gestures.wheel(new WheelEvent('wheel', { deltaY: 60 }), { x: 500, y: 400 });
      visited.add(layout.currentIndex(camera.y, camera.height / camera.z));
      expect(camera.z).toBe(1.4);
    }
    expect(visited.size).toBe(3);
  });

  it('a resize keeps the zoom and re-clamps the position', () => {
    const { camera, layout } = lockedRig();
    camera.y = layout.totalHeight;
    camera.resize({ left: 0, top: 0, width: 600, height: 400 }, 2);
    camera.clampTo(layout);
    expect(camera.z).toBe(1.4);
    expect(camera.y).toBeLessThan(layout.totalHeight);
  });

  it('an unlocked pinch zooms, without jumping when it starts', () => {
    const { camera, gestures } = lockedRig();
    camera.setZoomLock(null);
    gestures.beginPinch([1, { x: 400, y: 400 }], [2, { x: 600, y: 400 }]);
    gestures.move(2, { x: 621, y: 400 });
    expect(camera.z).toBeLessThan(1.42);
    gestures.move(2, { x: 800, y: 400 });
    expect(camera.z).toBeGreaterThan(2);
  });
});

describe('PinchIntent', () => {
  it('reads spreading fingers as zoom', () => {
    expect(PinchIntent.isZoom(60, 5)).toBe(true);
    expect(PinchIntent.isZoom(60, 100)).toBe(true);
  });

  it('reads wobble and fingers moving together as scrolling', () => {
    expect(PinchIntent.isZoom(10, 0)).toBe(false);
    expect(PinchIntent.isZoom(40, 400)).toBe(false);
  });
});

describe('ZoomMenu', () => {
  const i18n = new I18n('en');

  function menu(nb: Notebook = notebook()) {
    const camera = new Camera();
    camera.setZoom(1.4);
    const viewport = { fitWidth: vi.fn(), zoomTo: vi.fn() };
    const markDirty = vi.fn();
    const toast = vi.fn();
    const redraw = vi.fn();
    const zoom = new ZoomMenu({ camera, viewport, i18n, notebook: () => nb, markDirty, redraw, toast });
    const items = (): MenuItem[] => zoom.entries().filter((e): e is MenuItem => e !== '-');
    return { nb, camera, viewport, markDirty, toast, zoom, items };
  }

  let rig: ReturnType<typeof menu>;
  beforeEach(() => {
    rig = menu();
  });

  it('offers the current value, Fit width, 100% and the lock', () => {
    expect(rig.items().map((i) => i.label)).toEqual(['Now: 140%', 'Fit to width', '100%', 'Lock zoom']);
    expect(rig.items().map((i) => !!i.disabled)).toEqual([true, false, false, false]);
  });

  it('runs the presets while unlocked', () => {
    rig.items()[1]?.onClick();
    rig.items()[2]?.onClick();
    expect(rig.viewport.fitWidth).toHaveBeenCalled();
    expect(rig.viewport.zoomTo).toHaveBeenCalledWith(1);
  });

  it('locking stores the exact zoom on the notebook and queues a save', () => {
    rig.camera.setZoom(1.3749);
    rig.zoom.toggleLock();
    expect(rig.nb.zoomLock).toBe(1.3749);
    expect(rig.camera.zoomLocked).toBe(true);
    expect(rig.markDirty).toHaveBeenCalledTimes(1);
    expect(rig.toast).toHaveBeenCalledWith('Zoom locked at 137%');
  });

  it('disables the presets while locked and offers to unlock', () => {
    rig.zoom.toggleLock();
    expect(rig.items().map((i) => !!i.disabled)).toEqual([true, true, true, false]);
    expect(rig.items()[3]?.label).toBe('Unlock zoom');
  });

  it('unlocking removes the field, so the stored record looks like an old one', () => {
    rig.zoom.toggleLock();
    rig.zoom.toggleLock();
    expect('zoomLock' in rig.nb).toBe(false);
    expect(rig.camera.zoomLocked).toBe(false);
    expect(rig.markDirty).toHaveBeenCalledTimes(2);
  });

  it('limits the blocked-zoom hint', () => {
    rig.zoom.showBlockedHint(1000);
    rig.zoom.showBlockedHint(1000 + ZOOM_LOCK_HINT_MS - 1);
    expect(rig.toast).toHaveBeenCalledTimes(1);
    rig.zoom.showBlockedHint(1000 + ZOOM_LOCK_HINT_MS);
    expect(rig.toast).toHaveBeenCalledTimes(2);
  });
});

describe('storing the zoom lock', () => {
  it('reads records without the field as unlocked', () => {
    const parsed = parseNotebook(notebook());
    expect(parsed.zoomLock).toBeUndefined();
    expect('zoomLock' in NotebookRepository.toRecord(parsed)).toBe(false);
  });

  it('survives writing to and reading from the database', async () => {
    const repo = new NotebookRepository(Database.inMemory(), new RecordReader(() => undefined));
    await repo.save(notebook({ zoomLock: 1.4 }));
    expect((await repo.all())[0]?.zoomLock).toBe(1.4);
  });

  it('accepts the limits of the zoom range', () => {
    expect(parseNotebook(notebook({ zoomLock: ZOOM_MIN })).zoomLock).toBe(ZOOM_MIN);
    expect(parseNotebook(notebook({ zoomLock: ZOOM_MAX })).zoomLock).toBe(ZOOM_MAX);
  });

  it.each([['1.4'], [Number.NaN], [Infinity], [null], [true], [ZOOM_MIN / 2], [ZOOM_MAX * 2], [0], [-1]])(
    'rejects a backup with zoomLock = %s',
    (value) => {
      const doc = backupJson({ notebooks: [{ ...notebook(), zoomLock: value }] });
      expect(() => BackupService.parse(doc)).toThrow();
    },
  );

  it('round-trips through a backup, with and without the field', () => {
    const json = JSON.stringify(
      backupJson({ notebooks: [notebook({ id: 'a', zoomLock: 1.4 }), notebook({ id: 'b' })] }),
    );
    const doc = BackupService.parse(JSON.parse(json));
    expect(doc.notebooks[0]?.zoomLock).toBe(1.4);
    expect(doc.notebooks[1]?.zoomLock).toBeUndefined();
  });
});
