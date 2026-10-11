import { PAN_REVOKE_MS, TWO_FINGER_TAP_MS, TWO_FINGER_TAP_SLOP, ZOOM_MAX, ZOOM_MIN } from '../core/constants';
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
  sx: number;
  sy: number;
  lt: number;
  vx: number;
  vy: number;
  cam0: CameraState;
  t0: number;
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
  cam0: CameraState;
}

/** `draw`: a finger is drawing with a tool. `done`: ignore the remaining fingers until all lift. */
type Gesture = PanGesture | PinchGesture | { type: 'draw' } | { type: 'done' };

export interface GestureDeps {
  camera: Camera;
  layout: PageLayout;
  renderer: Renderer;
  /** Releases pointer capture of touches that are being revoked. */
  releaseCapture: (pointerId: number) => void;
  /** Two-finger tap: undo. */
  onTwoFingerTap: () => void;
  /** Short single-finger tap while panning (used by the text tool). */
  onTap: (screen: Point) => void;
}

/** Inertia decay per 16 ms frame. */
const FRICTION = 0.94;

/**
 * Touch navigation: one-finger pan with inertia, two-finger pinch zoom, two-finger tap to
 * undo, plus mouse-wheel scrolling and Ctrl/⌘ + wheel zoom.
 */
export class GestureController {
  private readonly touches = new Map<number, Point>();
  private gesture: Gesture | null = null;
  private inertiaFrame = 0;
  private lastPanMove = 0;
  private wheelTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly deps: GestureDeps) {}

  get touchCount(): number {
    return this.touches.size;
  }

  hasTouch(id: number): boolean {
    return this.touches.has(id);
  }

  /** Registers a finger (or a non-left mouse button) at a stage-local point. */
  addTouch(id: number, pt: Point): number {
    this.touches.set(id, { x: pt.x, y: pt.y });
    return this.touches.size;
  }

  /** Marks that the single finger down is drawing with a tool, not panning. */
  markDrawing(): void {
    this.gesture = { type: 'draw' };
  }

  startPan(): void {
    const [t] = [...this.touches.values()];
    if (!t) return;
    const time = now();
    this.gesture = {
      type: 'pan',
      lx: t.x,
      ly: t.y,
      sx: t.x,
      sy: t.y,
      lt: time,
      vx: 0,
      vy: 0,
      cam0: this.deps.camera.snapshot(),
      t0: time,
    };
  }

  startPinch(): void {
    const [a, b] = [...this.touches.values()];
    if (!a || !b) return;
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const w = this.deps.camera.toWorld(mx, my);
    this.gesture = {
      type: 'pinch',
      d0: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)),
      z0: this.deps.camera.z,
      wx: w.x,
      wy: w.y,
      mx0: mx,
      my0: my,
      t0: now(),
      moved: 0,
      cam0: this.deps.camera.snapshot(),
    };
  }

  /** A tracked finger moved. */
  moveTouch(id: number, pt: Point): void {
    const t = this.touches.get(id);
    if (!t) return;
    t.x = pt.x;
    t.y = pt.y;
    if (this.gesture?.type === 'pan') this.lastPanMove = now();
    this.update();
  }

  /** A tracked finger lifted or was cancelled. */
  endTouch(id: number): void {
    if (!this.touches.delete(id)) return;
    this.end();
  }

  /**
   * A pen touched down: drop all fingers (palm). A pan that started less than 400 ms ago
   * was probably the palm landing first, so the camera jumps back to where it was.
   */
  revokeForPen(): void {
    if (!this.touches.size) return;
    const g = this.gesture;
    if (g && 'cam0' in g && now() - g.t0 < PAN_REVOKE_MS) {
      this.deps.camera.restore(g.cam0);
      this.deps.camera.clampTo(this.deps.layout);
      this.deps.renderer.request();
    }
    for (const id of this.touches.keys()) this.deps.releaseCapture(id);
    this.touches.clear();
    this.gesture = { type: 'done' };
    this.deps.renderer.setPinching(false);
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

  private end(): void {
    const g = this.gesture;
    if (!g) return;
    if (g.type === 'pinch' && this.touches.size < 2) {
      this.endPinch(g);
      return;
    }
    if (g.type === 'pan' && this.touches.size === 0) {
      this.endPan(g);
      return;
    }
    if (this.touches.size === 0) this.gesture = null;
  }

  /** A quick pinch that barely moved is a two-finger tap → undo. */
  private endPinch(g: PinchGesture): void {
    const quick = now() - g.t0 < TWO_FINGER_TAP_MS && g.moved < TWO_FINGER_TAP_SLOP;
    this.deps.renderer.setPinching(false);
    this.deps.renderer.request();
    if (quick) {
      this.gesture = { type: 'done' };
      this.deps.onTwoFingerTap();
      return;
    }
    if (this.touches.size === 1) this.startPan();
    else this.gesture = null;
  }

  private endPan(g: PanGesture): void {
    this.gesture = null;
    if (Math.hypot(g.lx - g.sx, g.ly - g.sy) < 8 && now() - g.t0 < 400) {
      this.deps.onTap({ x: g.sx, y: g.sy });
      return;
    }
    if (now() - this.lastPanMove < 80 && Math.hypot(g.vx, g.vy) > 0.25) this.startInertia(g.vx, g.vy);
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
