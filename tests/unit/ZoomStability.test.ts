import { describe, expect, it } from 'vitest';
import { Camera } from '../../src/canvas/Camera';
import { PageLayout } from '../../src/canvas/PageLayout';
import { TouchClassifier, type TouchSample } from '../../src/domain/TouchClassifier';
import { GestureController } from '../../src/input/GestureController';
import { page } from './fixtures';

/** A camera over pages of different sizes, and gestures driving it. */
function rig() {
  const camera = new Camera();
  camera.resize({ left: 0, top: 0, width: 1000, height: 800 }, 1);
  const layout = new PageLayout();
  layout.update([
    page({ id: 'a' }),
    page({ id: 'b', w: 297, h: 210 }),
    page({ id: 'c', w: 148, h: 210 }),
    page({ id: 'd' }),
  ]);
  camera.zoomAt({ x: 0, y: 0 }, 1.4);
  camera.clampTo(layout);
  const gestures = new GestureController({
    camera,
    layout,
    renderer: { request: () => undefined, render: () => undefined, setPinching: () => undefined },
  });
  return { camera, layout, gestures };
}

function touch(id: number, x: number, y: number, time: number): TouchSample {
  return { id, x, y, width: 10, height: 10, time };
}

describe('zoom stays put while navigating', () => {
  it('two-finger scrolling with natural finger wobble does not change the zoom', () => {
    const { camera, gestures } = rig();
    gestures.beginPinch([1, { x: 400, y: 600 }], [2, { x: 520, y: 600 }]);
    // A long swipe: the fingers travel 400 px and their distance wanders by up to 16 px.
    for (let i = 1; i <= 40; i++) {
      const wobble = Math.sin(i / 3) * 8;
      gestures.move(1, { x: 400 - wobble, y: 600 - i * 10 });
      gestures.move(2, { x: 520 + wobble, y: 600 - i * 10 });
      expect(camera.z).toBe(1.4);
    }
    gestures.release(1);
    expect(camera.z).toBe(1.4);
  });

  it('a pan followed by a pinch is not undone by a pen landing much later', () => {
    const { camera, gestures } = rig();
    const classifier = new TouchClassifier({ twoFingerScroll: () => false, twoFingerUndo: () => true });
    classifier.touchDown(touch(1, 300, 300, 0), false);
    classifier.touchMove(touch(1, 300, 340, 100));
    gestures.beginPan(1, { x: 300, y: 300 });
    gestures.move(1, { x: 300, y: 340 });
    // The second finger turns the pan into a pinch, which zooms in.
    classifier.touchDown(touch(2, 500, 340, 200), false);
    gestures.beginPinch([1, { x: 300, y: 340 }], [2, { x: 500, y: 340 }]);
    gestures.move(2, { x: 700, y: 340 });
    const zoomed = camera.z;
    expect(zoomed).toBeGreaterThan(1.4);
    classifier.touchUp(2, 400);
    gestures.release(2);
    classifier.touchUp(1, 400);
    // Ten seconds later the pen touches the page.
    const { revertPan } = classifier.penEvent('down', 10_400);
    expect(revertPan).toBe(false);
    expect(camera.z).toBe(zoomed);
  });

  it('a pinch after a palm pan is not undone by the pen', () => {
    const { camera, gestures } = rig();
    gestures.beginPan(1, { x: 300, y: 300 });
    gestures.move(1, { x: 300, y: 200 });
    gestures.release(1);
    gestures.beginPinch([2, { x: 300, y: 300 }], [3, { x: 500, y: 300 }]);
    gestures.move(3, { x: 700, y: 300 });
    gestures.release(3);
    const zoomed = camera.z;
    expect(zoomed).toBeGreaterThan(1.4);
    gestures.revertPan();
    expect(camera.z).toBe(zoomed);
  });

  it('scrolling across pages of different sizes keeps the exact zoom', () => {
    const { camera, layout, gestures } = rig();
    const seen = new Set<number>();
    for (let i = 0; i < 200; i++) {
      gestures.wheel(new WheelEvent('wheel', { deltaY: 40, deltaX: i % 2 ? 15 : -15 }), { x: 500, y: 400 });
      seen.add(layout.currentIndex(camera.y, camera.height / camera.z));
      expect(camera.z).toBe(1.4);
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('a resize or orientation change keeps the zoom', () => {
    const { camera, layout } = rig();
    camera.resize({ left: 0, top: 0, width: 800, height: 1000 }, 2);
    camera.clampTo(layout);
    expect(camera.z).toBe(1.4);
  });
});
