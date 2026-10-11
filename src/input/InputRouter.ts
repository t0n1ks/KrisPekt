import { PALM_REJECT_MS } from '../core/constants';
import type { Point } from '../core/types';
import { now } from '../core/utils/math';
import type { Camera } from '../canvas/Camera';
import type { GestureController } from './GestureController';

/** The drawing side of input: the tool manager. */
export interface DrawingTarget {
  /** Pointer id of the operation in progress, or null. */
  readonly activePointer: number | null;
  /** Whether the operation in progress was started by a finger. */
  readonly activeByTouch: boolean;
  /** Whether a finger at this point should use the tool rather than pan. */
  acceptsTouchAt(pt: Point): boolean;
  begin(e: PointerEvent, pt: Point): void;
  move(e: PointerEvent): void;
  end(e: PointerEvent): void;
  cancel(): void;
  /** A second finger landed during a finger operation. */
  interrupt(): void;
}

export interface InputRouterDeps {
  canvas: HTMLCanvasElement;
  stage: HTMLElement;
  camera: Camera;
  gestures: GestureController;
  tools: DrawingTarget;
  /** Runs first on every pointer-down; returns true to swallow the event. */
  beforePointerDown: () => boolean;
  /** A stylus was seen (down or hovering). */
  onPenSeen: () => void;
}

/**
 * Routes pointer events from the canvas: pens and mice draw with the active tool, fingers
 * pan and zoom (or draw when finger drawing is on).
 *
 * Palm rejection: while the pen is down, and for 500 ms after any pen activity (including
 * hover), touches are ignored, because a resting palm produces touch events.
 */
export class InputRouter {
  private lastPenSeen = -1e9;
  private penDown = false;
  private readonly listeners: [EventTarget, string, EventListener, AddEventListenerOptions?][];

  constructor(private readonly deps: InputRouterDeps) {
    const { canvas, stage } = deps;
    this.listeners = [
      [canvas, 'pointerdown', (e) => this.down(e as PointerEvent)],
      [canvas, 'pointermove', (e) => this.move(e as PointerEvent)],
      [canvas, 'pointerup', (e) => this.up(e as PointerEvent)],
      [canvas, 'pointercancel', (e) => this.up(e as PointerEvent)],
      [canvas, 'contextmenu', (e) => e.preventDefault()],
      [stage, 'wheel', (e) => this.wheel(e as WheelEvent), { passive: false }],
    ];
    for (const [target, type, fn, opts] of this.listeners) target.addEventListener(type, fn, opts);
  }

  /** Removes every listener. */
  destroy(): void {
    for (const [target, type, fn, opts] of this.listeners) target.removeEventListener(type, fn, opts);
  }

  /**
   * Handles a pointer-down. Public because the ruler forwards pen (and Alt+mouse) events
   * that land on it, so you can draw along its edge; the canvas then takes pointer capture.
   */
  down(e: PointerEvent): void {
    if (e.cancelable) e.preventDefault();
    this.deps.gestures.stopInertia();
    if (this.deps.beforePointerDown()) return;
    const pt = this.deps.camera.toLocal(e.clientX, e.clientY);
    if (e.pointerType === 'pen') this.penLanded();
    if (e.pointerType === 'touch') {
      this.touchDown(e, pt);
      return;
    }
    if (e.pointerType === 'mouse' && e.button !== 0) {
      this.deps.gestures.addTouch(e.pointerId, pt);
      this.capture(e.pointerId);
      this.deps.gestures.startPan();
      return;
    }
    if (this.deps.tools.activePointer !== null) return;
    this.capture(e.pointerId);
    this.deps.tools.begin(e, pt);
  }

  private penLanded(): void {
    const { gestures, tools } = this.deps;
    this.lastPenSeen = now();
    this.deps.onPenSeen();
    gestures.revokeForPen();
    if (tools.activePointer !== null && tools.activeByTouch) tools.cancel();
    this.penDown = true;
  }

  private touchDown(e: PointerEvent, pt: Point): void {
    const { gestures, tools } = this.deps;
    if (this.penDown || now() - this.lastPenSeen < PALM_REJECT_MS) return;
    const count = gestures.addTouch(e.pointerId, pt);
    this.capture(e.pointerId);
    if (count === 1) {
      if (tools.acceptsTouchAt(pt)) {
        tools.begin(e, pt);
        gestures.markDrawing();
      } else gestures.startPan();
    } else if (count === 2) {
      if (tools.activePointer !== null && tools.activeByTouch) tools.interrupt();
      gestures.startPinch();
    }
  }

  private move(e: PointerEvent): void {
    const { tools, gestures, camera } = this.deps;
    if (e.pointerType === 'pen' && !e.buttons && tools.activePointer !== e.pointerId) {
      // Hovering pen: keep palm rejection armed.
      this.lastPenSeen = now();
      return;
    }
    if (tools.activePointer === e.pointerId) {
      tools.move(e);
      return;
    }
    if (gestures.hasTouch(e.pointerId)) gestures.moveTouch(e.pointerId, camera.toLocal(e.clientX, e.clientY));
  }

  private up(e: PointerEvent): void {
    const { tools, gestures } = this.deps;
    if (e.pointerType === 'pen') {
      this.penDown = false;
      this.lastPenSeen = now();
    }
    if (tools.activePointer === e.pointerId) tools.end(e);
    if (gestures.hasTouch(e.pointerId)) gestures.endTouch(e.pointerId);
  }

  private wheel(e: WheelEvent): void {
    if (e.target !== this.deps.canvas) return;
    e.preventDefault();
    this.deps.gestures.wheel(e, this.deps.camera.toLocal(e.clientX, e.clientY));
  }

  private capture(pointerId: number): void {
    try {
      this.deps.canvas.setPointerCapture(pointerId);
    } catch {
      /* the pointer may already be gone */
    }
  }
}
