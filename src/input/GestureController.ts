import { TWO_FINGER_TAP_MS, TWO_FINGER_TAP_SLOP, ZOOM_MAX, ZOOM_MIN } from '../core/constants';
import type { Point } from '../core/types';
import { clamp, now } from '../core/utils/math';
import type { Camera } from '../canvas/Camera';
import type { PageLayout } from '../canvas/PageLayout';
import type { Renderer } from '../canvas/Renderer';

interface CameraState {
  x: number;
  y: number;
  z: number;
}

interface PanGesture {
  type: 'pan';
  lx: number;
  ly: number;
  lt: number;
  vx: number;
  vy: number;
}

interface PinchGesture {
  type: 'pinch';
  d0: number;
  z0: number;
  wx: number;
  wy: number;
  mx0: number;
  my0: number;
  t0: number;
  moved: number;
}

export interface GestureDeps {
  camera: Camera;
  layout: PageLayout;
  renderer: Pick<Renderer, 'request' | 'render' | 'setPinching'>;
}

/** Inertia decay per 16 ms frame. */
const FRICTION = 0.94;

/**
 * Camera navigation: one-finger pan with inertia, two-finger pinch zoom, mouse-wheel scrolling
 * and Ctrl/⌘ + wheel zoom. Which contacts pan or pinch is decided by the input router and the
 * touch classifier; this class only moves the camera.
 */
export class GestureController {
  private readonly touches = new Map<number, Point>();
  private gesture: PanGesture | PinchGesture | null = null;
  /** Camera when the last single-finger pan began, kept so a palm's pan can be undone. */
  private lastPanStart: CameraState | null = null;
  private inertiaFrame = 0;
  private lastPanMove = 0;
  private wheelTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly deps: GestureDeps) {}

  /** Whether a contact (or mouse button) is moving the camera. */
  hasTouch(id: number): boolean {
    return this.touches.has(id);
  }

  /** Starts a pan with one contact at a stage-local point. */
  beginPan(id: number, pt: Point): void {
    this.stop();
    this.touches.set(id, { x: pt.x, y: pt.y });
    this.lastPanStart = this.deps.camera.snapshot();
    this.gesture = { type: 'pan', lx: pt.x, ly: pt.y, lt: now(), vx: 0, vy: 0 };
  }

  /** Starts a pinch with two contacts at stage-local points. */
  beginPinch(a: [number, Point], b: [number, Point]): void {
    this.stop();
    this.touches.set(a[0], { ...a[1] });
    this.touches.set(b[0], { ...b[1] });
    const [pa, pb] = [a[1], b[1]];
    const mx = (pa.x + pb.x) / 2;
    const my = (pa.y + pb.y) / 2;
    const w = this.deps.camera.toWorld(mx, my);
    this.gesture = {
      type: 'pinch',
      d0: Math.max(10, Math.hypot(pa.x - pb.x, pa.y - pb.y)),
      z0: this.deps.camera.z,
      wx: w.x,
      wy: w.y,
      mx0: mx,
      my0: my,
      t0: now(),
      moved: 0,
    };
  }

  /** A contact of the current gesture moved. */
  move(id: number, pt: Point): void {
    const t = this.touches.get(id);
    if (!t) return;
    t.x = pt.x;
    t.y = pt.y;
    if (this.gesture?.type === 'pan') this.lastPanMove = now();
    this.update();
  }

  /**
   * A contact of the current gesture lifted: a pan coasts on with inertia, a pinch ends.
   * Returns true when it ends a quick pinch that barely moved, i.e. a two-finger tap.
   */
  release(id: number): boolean {
    if (!this.touches.has(id)) return false;
    const g = this.gesture;
    this.touches.clear();
    this.gesture = null;
    if (g?.type === 'pan') {
      if (now() - this.lastPanMove < 80 && Math.hypot(g.vx, g.vy) > 0.25) this.startInertia(g.vx, g.vy);
      return false;
    }
    this.deps.renderer.setPinching(false);
    this.deps.renderer.request();
    return !!g && now() - g.t0 < TWO_FINGER_TAP_MS && g.moved < TWO_FINGER_TAP_SLOP;
  }

  /** Ends the current gesture where it is, without inertia (its contact turned out to be a palm). */
  stop(): void {
    if (!this.gesture) return;
    if (this.gesture.type === 'pinch') {
      this.deps.renderer.setPinching(false);
      this.deps.renderer.request();
    }
    this.touches.clear();
    this.gesture = null;
  }

  /**
   * Puts the camera back where the last single-finger pan began and stops any inertia: the pen
   * landed right after it, so that pan was the palm.
   */
  revertPan(): void {
    this.stopInertia();
    this.stop();
    const cam0 = this.lastPanStart;
    this.lastPanStart = null;
    if (!cam0) return;
    this.deps.camera.restore(cam0);
    this.deps.camera.clampTo(this.deps.layout);
    this.deps.renderer.request();
  }

  stopInertia(): void {
    cancelAnimationFrame(this.inertiaFrame);
    this.inertiaFrame = 0;
  }

  /** Wheel: scroll, or zoom around the cursor with Ctrl/⌘. */
  wheel(e: WheelEvent, pt: Point): void {
    this.stopInertia();
    const { camera, renderer } = this.deps;
    if (e.ctrlKey || e.metaKey) {
      camera.zoomAt(pt, camera.z * Math.exp(-e.deltaY * 0.0045));
      renderer.setPinching(true);
      clearTimeout(this.wheelTimer);
      this.wheelTimer = setTimeout(() => {
        renderer.setPinching(false);
        renderer.request();
      }, 160);
    } else {
      camera.x += e.deltaX / camera.z;
      camera.y += e.deltaY / camera.z;
    }
    camera.clampTo(this.deps.layout);
    renderer.request();
  }

  private update(): void {
    const g = this.gesture;
    const pts = [...this.touches.values()];
    if (g?.type === 'pan' && pts[0]) this.updatePan(g, pts[0]);
    else if (g?.type === 'pinch' && pts[0] && pts[1]) this.updatePinch(g, pts[0], pts[1]);
  }

  private updatePan(g: PanGesture, t: Point): void {
    const { camera } = this.deps;
    const dx = t.x - g.lx;
    const dy = t.y - g.ly;
    const time = now();
    const dt = Math.max(1, time - g.lt);
    g.vx = 0.7 * (dx / dt) + 0.3 * g.vx;
    g.vy = 0.7 * (dy / dt) + 0.3 * g.vy;
    g.lx = t.x;
    g.ly = t.y;
    g.lt = time;
    camera.x -= dx / camera.z;
    camera.y -= dy / camera.z;
    camera.clampTo(this.deps.layout);
    this.deps.renderer.request();
  }

  private updatePinch(g: PinchGesture, a: Point, b: Point): void {
    const { camera, renderer } = this.deps;
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    g.moved = Math.max(g.moved, Math.abs(d - g.d0), Math.hypot(mx - g.mx0, my - g.my0));
    if (g.moved < 4) return;
    const z = clamp((g.z0 * d) / g.d0, ZOOM_MIN, ZOOM_MAX);
    renderer.setPinching(true);
    camera.z = z;
    camera.x = g.wx - mx / z;
    camera.y = g.wy - my / z;
    camera.clampTo(this.deps.layout);
    renderer.request();
  }

  private startInertia(vx: number, vy: number): void {
    const { camera, layout, renderer } = this.deps;
    let last = now();
    const step = (time: number): void => {
      const dt = Math.min(40, time - last);
      last = time;
      const f = Math.pow(FRICTION, dt / 16);
      vx *= f;
      vy *= f;
      camera.x -= (vx * dt) / camera.z;
      camera.y -= (vy * dt) / camera.z;
      camera.clampTo(layout);
      renderer.render();
      this.inertiaFrame = Math.hypot(vx, vy) > 0.03 ? requestAnimationFrame(step) : 0;
    };
    this.inertiaFrame = requestAnimationFrame(step);
  }
}
