import type { Point } from '../core/types';
import { LONG_PRESS_MS } from '../core/constants';
import { now } from '../core/utils/math';
import type { Camera } from '../canvas/Camera';
import type { RoleChange, TouchClassifier, TouchRole, TouchSample } from '../domain/TouchClassifier';
import type { GestureController } from './GestureController';
import { InputLog, type InputSample } from './InputLog';
import type { TouchSizeProbe } from './TouchSizeProbe';

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
  /** A short single-finger tap at a stage-local point (the text tool places a box). */
  tap(pt: Point): void;
}

/**
 * What a press lands on. `tap`: something that reacts to a tap (a card, a link), which a press that
 * moves leaves to the tool. `place`: the page while a new card waits for its spot; no tool runs.
 */
export type PressKind = 'tap' | 'place';

/** Things on the page that react to being pressed, rather than being drawn over. */
export interface PressTarget {
  kindAt(pt: Point, e: PointerEvent): PressKind | null;
  tap(pt: Point): void;
  /** A press held without moving. Returns false if it means nothing here. */
  longPress(pt: Point): boolean;
}

/** A press being watched to see what it turns out to be. */
interface HeldPress {
  id: number;
  start: Point;
  /** The event that began it, for the tool if it becomes a stroke. */
  event: PointerEvent;
  kind: PressKind;
  timer: ReturnType<typeof setTimeout>;
  /** The long press fired; the rest of this press means nothing. */
  done: boolean;
}

/** A press that moves further than this many px is a drag, not a tap. */
const PRESS_SLOP = 8;

export interface InputRouterDeps {
  canvas: HTMLCanvasElement;
  stage: HTMLElement;
  camera: Camera;
  gestures: GestureController;
  tools: DrawingTarget;
  press: PressTarget;
  classifier: TouchClassifier;
  sizes: TouchSizeProbe;
  /** Runs first on every pointer-down; returns true to swallow the event. */
  beforePointerDown: () => boolean;
  /** A stylus touched down. */
  onPenSeen: () => void;
  /** A quick two-finger tap that the classifier allows to undo. */
  onTwoFingerTap: () => void;
  /** Every routed pointer event, for the diagnostics overlay. */
  onSample: (sample: InputSample) => void;
}

/**
 * Routes pointer events from the canvas: pens and mice draw with the active tool, fingers
 * pan and zoom (or draw when finger drawing is on).
 *
 * Palm rejection is decided by the {@link TouchClassifier}: this class feeds it every touch and
 * pen event and carries out the role changes it reports (start or stop a pan or pinch, begin or
 * cancel a finger stroke, revert a pan that was really the palm).
 */
export class InputRouter {
  private readonly listeners: [EventTarget, string, EventListener, AddEventListenerOptions?][];
  private held: HeldPress | null = null;
  /** A finger whose long press already fired, so that lifting it is no tap. */
  private longPressedTouch: number | null = null;
  private touchTimer: ReturnType<typeof setTimeout> | undefined;
  private touchStart: Point | null = null;

  constructor(private readonly deps: InputRouterDeps) {
    const { canvas, stage } = deps;
    const penActivity = (e: Event): void => this.penActivity(e as PointerEvent);
    this.listeners = [
      [canvas, 'pointerdown', (e) => this.down(e as PointerEvent)],
      [canvas, 'pointermove', (e) => this.move(e as PointerEvent)],
      [canvas, 'pointerup', (e) => this.up(e as PointerEvent, false)],
      [canvas, 'pointercancel', (e) => this.up(e as PointerEvent, true)],
      [canvas, 'contextmenu', (e) => e.preventDefault()],
      [stage, 'wheel', (e) => this.wheel(e as WheelEvent), { passive: false }],
      // Capture phase on the stage: pen hover over the ruler or overlays counts too.
      [stage, 'pointerover', penActivity, { capture: true }],
      [stage, 'pointermove', penActivity, { capture: true }],
    ];
    for (const [target, type, fn, opts] of this.listeners) target.addEventListener(type, fn, opts);
  }

  /** Removes every listener. */
  destroy(): void {
    for (const [target, type, fn, opts] of this.listeners) target.removeEventListener(type, fn, opts);
    this.deps.sizes.destroy();
  }

  /**
   * Whether a touch on another control (the ruler) is a palm: it is too large, or the pen is
   * down. Lets the ruler ignore the hand that rests on it while writing along its edge.
   */
  isPalmTouch(e: PointerEvent): boolean {
    if (e.pointerType !== 'touch') return false;
    const size = this.deps.sizes.sizeOf(e);
    return this.deps.classifier.isPenDown || this.deps.classifier.isPalmSize(size.width, size.height);
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
    if (e.pointerType === 'touch') {
      this.touchDown(e, pt);
      return;
    }
    if (e.pointerType === 'pen') this.penLanded();
    this.log(e, 'down');
    if (e.pointerType === 'mouse' && e.button !== 0) {
      this.capture(e.pointerId);
      this.deps.gestures.beginPan(e.pointerId, pt);
      return;
    }
    if (this.deps.tools.activePointer !== null) return;
    this.capture(e.pointerId);
    if (!this.holdPress(e, pt)) this.deps.tools.begin(e, pt);
  }

  /**
   * A pen or mouse on a card or link is not yet anything: a tap opens it, a hold brings its menu,
   * and only a press that moves is a stroke, which then starts where it landed.
   */
  private holdPress(e: PointerEvent, pt: Point): boolean {
    const kind = this.deps.press.kindAt(pt, e);
    if (!kind) return false;
    const held: HeldPress = {
      id: e.pointerId,
      start: pt,
      event: e,
      kind,
      done: false,
      timer: setTimeout(() => this.heldLong(held), LONG_PRESS_MS),
    };
    this.held = held;
    return true;
  }

  private heldLong(held: HeldPress): void {
    if (this.held !== held || held.kind === 'place') return;
    if (this.deps.press.longPress(held.start)) held.done = true;
    else this.releaseHeld(held);
  }

  /** The press is a stroke after all. */
  private releaseHeld(held: HeldPress): void {
    clearTimeout(held.timer);
    this.held = null;
    this.deps.tools.begin(held.event, held.start);
  }

  private moveHeld(held: HeldPress, e: PointerEvent, pt: Point): void {
    if (held.done || Math.hypot(pt.x - held.start.x, pt.y - held.start.y) <= PRESS_SLOP) return;
    clearTimeout(held.timer);
    if (held.kind === 'place') {
      held.done = true;
      return;
    }
    this.releaseHeld(held);
    this.deps.tools.move(e);
  }

  private endHeld(held: HeldPress, cancelled: boolean): void {
    clearTimeout(held.timer);
    this.held = null;
    if (!cancelled && !held.done) this.deps.press.tap(held.start);
  }

  private penLanded(): void {
    const result = this.deps.classifier.penEvent('down', now());
    this.deps.onPenSeen();
    if (result.revertPan) this.deps.gestures.revertPan();
    this.apply(result.changes, null);
  }

  /** Pen hover and pen moves (anywhere on the stage) keep the writing session alive. */
  private penActivity(e: PointerEvent): void {
    if (e.pointerType !== 'pen') return;
    const result = this.deps.classifier.penEvent('hover', now());
    if (e.type === 'pointermove' && e.buttons) {
      this.log(e, 'move');
      return;
    }
    this.deps.gestures.stopInertia();
    this.apply(result.changes, null);
    this.log(e, e.type === 'pointerover' ? 'over' : 'hover');
  }

  private touchDown(e: PointerEvent, pt: Point): void {
    const { tools, classifier } = this.deps;
    // A finger on a card or link taps or holds it; moved, it scrolls the page rather than drawing.
    const onTarget = this.deps.press.kindAt(pt, e) !== null;
    const wantsDraw = tools.activePointer === null && !onTarget && tools.acceptsTouchAt(pt);
    this.capture(e.pointerId);
    this.apply(classifier.touchDown(this.sample(e, pt), wantsDraw), e);
    this.log(e, 'down');
    if (onTarget) this.watchTouchHold(e.pointerId, pt);
  }

  private watchTouchHold(id: number, pt: Point): void {
    clearTimeout(this.touchTimer);
    this.touchStart = pt;
    this.touchTimer = setTimeout(() => {
      // Still one finger, still undecided: not a palm, a pan or a pinch.
      if (this.deps.classifier.roleOf(id) !== 'pending') return;
      if (this.deps.press.longPress(pt)) this.longPressedTouch = id;
    }, LONG_PRESS_MS);
  }

  private move(e: PointerEvent): void {
    const { tools, gestures, camera, classifier } = this.deps;
    if (e.pointerType === 'pen' && !e.buttons && tools.activePointer !== e.pointerId) return;
    const pt = camera.toLocal(e.clientX, e.clientY);
    if (this.held?.id === e.pointerId) {
      this.moveHeld(this.held, e, pt);
      return;
    }
    if (e.pointerType === 'touch') {
      if (this.touchStart && Math.hypot(pt.x - this.touchStart.x, pt.y - this.touchStart.y) > PRESS_SLOP) {
        clearTimeout(this.touchTimer);
      }
      this.apply(classifier.touchMove(this.sample(e, pt)), e);
      this.log(e, 'move');
    }
    if (tools.activePointer === e.pointerId) tools.move(e);
    else if (gestures.hasTouch(e.pointerId)) gestures.move(e.pointerId, pt);
  }

  private up(e: PointerEvent, cancelled: boolean): void {
    const { tools, gestures, classifier } = this.deps;
    if (e.pointerType === 'pen') classifier.penEvent('up', now());
    if (this.held?.id === e.pointerId) this.endHeld(this.held, cancelled);
    else if (tools.activePointer === e.pointerId) {
      if (cancelled) tools.cancel();
      else tools.end(e);
    }
    const quickPinch = gestures.hasTouch(e.pointerId) && gestures.release(e.pointerId);
    if (e.pointerType === 'touch') this.touchUp(e, cancelled, quickPinch);
    else this.log(e, cancelled ? 'cancel' : 'up');
  }

  private touchUp(e: PointerEvent, cancelled: boolean, quickPinch: boolean): void {
    const { classifier, tools } = this.deps;
    const time = now();
    const lifted = classifier.touchUp(e.pointerId, time, cancelled);
    this.log(e, cancelled ? 'cancel' : 'up', lifted.role);
    this.apply(lifted.changes, null);
    clearTimeout(this.touchTimer);
    const longPressed = this.longPressedTouch === e.pointerId;
    if (longPressed) this.longPressedTouch = null;
    if (lifted.tap && !longPressed) {
      if (this.deps.press.kindAt(lifted.tap, e)) this.deps.press.tap(lifted.tap);
      else tools.tap(lifted.tap);
    }
    if (quickPinch && !cancelled && lifted.role === 'pinch' && classifier.allowsUndoTap(time)) {
      this.deps.onTwoFingerTap();
    }
  }

  /**
   * Carries out the classifier's role changes: stops gestures and finger strokes whose
   * contacts were demoted, then starts the pinch, pan or stroke that was promoted.
   * `e` is the event being handled; only it can begin a stroke.
   */
  private apply(changes: readonly RoleChange[], e: PointerEvent | null): void {
    if (!changes.length) return;
    const { tools, gestures } = this.deps;
    const leaving = (role: TouchRole): boolean => changes.some((c) => c.from === role && c.to !== role);
    const pinch = changes.filter((c) => c.to === 'pinch');
    const drawStopped = changes.find((c) => c.from === 'draw' && c.to !== 'draw');
    if (drawStopped && tools.activePointer === drawStopped.id) {
      if (pinch.length) tools.interrupt();
      else tools.cancel();
    }
    if (leaving('pan') || leaving('pinch')) gestures.stop();
    const [a, b] = pinch;
    if (a && b) gestures.beginPinch([a.id, a.at], [b.id, b.at]);
    const pan = changes.find((c) => c.to === 'pan');
    if (pan) {
      // Start where the finger landed, so the page catches up with the finger's travel.
      gestures.beginPan(pan.id, pan.start);
      gestures.move(pan.id, pan.at);
    }
    const draw = changes.find((c) => c.to === 'draw');
    if (draw && e && e.pointerId === draw.id) tools.begin(e, draw.at);
  }

  private sample(e: PointerEvent, pt: Point): TouchSample {
    const size = this.deps.sizes.sizeOf(e);
    return { id: e.pointerId, x: pt.x, y: pt.y, width: size.width, height: size.height, time: now() };
  }

  private log(e: PointerEvent, event: string, role = this.deps.classifier.roleOf(e.pointerId)): void {
    const size = this.deps.sizes.sizeOf(e);
    this.deps.onSample({
      pointerType: e.pointerType,
      pointerId: e.pointerId,
      event,
      width: size.width,
      height: size.height,
      sizeFromTouch: size.fromTouch,
      pressure: e.pressure,
      buttons: e.buttons,
      cls: InputLog.classify(e.pointerType, role),
      role: e.pointerType === 'touch' ? role : null,
      session: this.deps.classifier.inSession(now()),
    });
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
