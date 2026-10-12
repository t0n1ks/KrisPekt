import {
  MAX_TOUCH_CONTACTS,
  PALM_SIZE_PX,
  PAN_REVERT_MS,
  PAN_START_DELAY_MS,
  PAN_START_SLOP_PX,
  PEN_SESSION_MS,
  TAP_MAX_MS,
  TAP_SLOP_PX,
  UNDO_PEN_QUIET_MS,
} from '../core/constants';
import type { Point } from '../core/types';

/**
 * What a touch contact is doing:
 * - `pending`: a single finger that has not yet shown it means to scroll (see {@link TouchClassifier});
 * - `held`: a single finger during a writing session; it does nothing alone but can join a pinch;
 * - `pan` / `pinch` / `draw`: scrolling, two-finger zoom, or drawing with the tool;
 * - `palm`: too large, or seen just before the pen; ignored until it lifts;
 * - `grip`: one of three or more contacts; ignored until every contact lifts.
 */
export type TouchRole = 'pending' | 'held' | 'pan' | 'pinch' | 'draw' | 'palm' | 'grip';

/** One touch pointer event, in stage-local CSS px and ms. */
export interface TouchSample {
  id: number;
  x: number;
  y: number;
  /** Contact size in CSS px (`PointerEvent.width` / `height`). */
  width: number;
  height: number;
  time: number;
}

/** A contact changed role; `from` is null for a contact that just landed. */
export interface RoleChange {
  id: number;
  from: TouchRole | null;
  to: TouchRole;
  /** Where the contact landed. */
  start: Point;
  /** Where it is now. */
  at: Point;
}

export interface PenResult {
  changes: RoleChange[];
  /** The last single-finger pan was probably the palm: put the camera back where it started. */
  revertPan: boolean;
}

export interface LiftResult {
  /** The lifted contact's last role, or null if it was unknown. */
  role: TouchRole | null;
  /** A short, still touch: a tap for the active tool. */
  tap: Point | null;
  changes: RoleChange[];
}

/** The user settings that change touch handling. */
export interface TouchOptions {
  /** A single finger never scrolls. */
  twoFingerScroll(): boolean;
  /** A quick two-finger tap undoes. */
  twoFingerUndo(): boolean;
}

export interface TouchTuning {
  palmSize: number;
  penSessionMs: number;
  panSlop: number;
  panDelayMs: number;
  panRevertMs: number;
  undoPenQuietMs: number;
  maxContacts: number;
  tapMs: number;
  tapSlop: number;
}

export const DEFAULT_TOUCH_TUNING: TouchTuning = {
  palmSize: PALM_SIZE_PX,
  penSessionMs: PEN_SESSION_MS,
  panSlop: PAN_START_SLOP_PX,
  panDelayMs: PAN_START_DELAY_MS,
  panRevertMs: PAN_REVERT_MS,
  undoPenQuietMs: UNDO_PEN_QUIET_MS,
  maxContacts: MAX_TOUCH_CONTACTS,
  tapMs: TAP_MAX_MS,
  tapSlop: TAP_SLOP_PX,
};

interface Contact {
  role: TouchRole;
  start: Point;
  at: Point;
  t0: number;
  /** False for the finger left over from a pinch, so lifting it is not a tap. */
  canTap: boolean;
}

/** Roles of a contact that may still do something. */
const LIVE_ROLES: readonly TouchRole[] = ['pending', 'held', 'pan', 'pinch', 'draw'];

/**
 * Palm rejection and touch intent, as pure state with explicit timestamps (no DOM).
 *
 * The rules, in order of strength:
 * 1. A contact wider or taller than `palmSize` is a palm for its whole life, checked on every
 *    move because a palm often lands small and spreads.
 * 2. Any pen event (down, move, hover) starts or extends a writing session that lasts
 *    `penSessionMs` after the last one. During it a single finger never scrolls or draws; it is
 *    `held` and can only join a second finger for a pinch. Pen-down turns every touch into a palm.
 * 3. Outside a session a single finger is `pending` and becomes a pan only after it has moved
 *    `panSlop` px and `panDelayMs` have passed; a pen event before that makes it a palm. This
 *    stops the jump when the palm lands a moment before the pen.
 * 4. A pen-down during a single-finger pan, or within `panRevertMs` after it ended, reports
 *    `revertPan` so the camera goes back to where the pan started.
 * 5. Three or more contacts are a palm or a grip: all are ignored until every one lifts.
 */
export class TouchClassifier {
  private readonly contacts = new Map<number, Contact>();
  private lastPen = -Infinity;
  private penDown = false;
  private gripActive = false;
  private panActive = false;
  private lastPanEnd = -Infinity;

  constructor(
    private readonly options: TouchOptions,
    private readonly tuning: TouchTuning = DEFAULT_TOUCH_TUNING,
  ) {}

  /** The role of a tracked contact, or null. */
  roleOf(id: number): TouchRole | null {
    return this.contacts.get(id)?.role ?? null;
  }

  /** Whether the pen is down or was seen less than `penSessionMs` ago. */
  inSession(time: number): boolean {
    return this.penDown || time - this.lastPen < this.tuning.penSessionMs;
  }

  /** Whether a contact of this size is a palm. */
  isPalmSize(width: number, height: number): boolean {
    return width > this.tuning.palmSize || height > this.tuning.palmSize;
  }

  /** Whether the pen is touching the screen. */
  get isPenDown(): boolean {
    return this.penDown;
  }

  /**
   * A finger landed. `wantsDraw`: the active tool would draw with it (finger drawing is on,
   * or the touch is on a selection). Returns every role change, including the new contact's.
   */
  touchDown(sample: TouchSample, wantsDraw: boolean): RoleChange[] {
    const at = { x: sample.x, y: sample.y };
    const contact: Contact = { role: 'palm', start: at, at: { ...at }, t0: sample.time, canTap: true };
    const changes: RoleChange[] = [];
    this.contacts.set(sample.id, contact);
    if (this.gripActive) return [this.assign(sample.id, contact, 'grip', null)];
    if (this.penDown || this.isPalmSize(sample.width, sample.height)) {
      return [this.assign(sample.id, contact, 'palm', null)];
    }
    if (this.contacts.size >= this.tuning.maxContacts) return this.startGrip(sample.id, sample.time);
    const others = this.liveIds().filter((id) => id !== sample.id);
    const partner = others[0];
    if (others.length === 1 && partner !== undefined) {
      const other = this.contacts.get(partner);
      if (other) changes.push(this.assign(partner, other, 'pinch'));
      changes.push(this.assign(sample.id, contact, 'pinch', null));
      return changes;
    }
    const role: TouchRole = this.inSession(sample.time) ? 'held' : wantsDraw ? 'draw' : 'pending';
    return [this.assign(sample.id, contact, role, null)];
  }

  /** A finger moved: re-checks its size and promotes a pending finger to a pan. */
  touchMove(sample: TouchSample): RoleChange[] {
    const contact = this.contacts.get(sample.id);
    if (!contact) return [];
    contact.at = { x: sample.x, y: sample.y };
    if (contact.role === 'palm' || contact.role === 'grip') return [];
    if (this.isPalmSize(sample.width, sample.height)) return this.toPalm(sample.id, contact, sample.time);
    if (contact.role === 'pending' && this.panIntended(contact, sample.time)) {
      this.panActive = true;
      return [this.assign(sample.id, contact, 'pan')];
    }
    return [];
  }

  /**
   * A finger lifted (or was cancelled: then it is never a tap). The partner of a pinch
   * becomes `pending` (or `held` while one finger may not scroll).
   */
  touchUp(id: number, time: number, cancelled = false): LiftResult {
    const contact = this.contacts.get(id);
    if (!contact) return { role: null, tap: null, changes: [] };
    this.contacts.delete(id);
    if (!this.contacts.size) this.gripActive = false;
    if (contact.role === 'pan') this.endPan(time);
    const changes = contact.role === 'pinch' ? this.releasePartner(time) : [];
    const tap = !cancelled && this.isTap(contact, time) ? contact.start : null;
    return { role: contact.role, tap, changes };
  }

  /**
   * A pen event. `down` starts a stroke, `up` ends it, `hover` is anything else (hovering,
   * moving while drawing, entering the stage). Every kind extends the writing session.
   */
  penEvent(kind: 'down' | 'hover' | 'up', time: number): PenResult {
    this.lastPen = time;
    if (kind === 'up') this.penDown = false;
    if (kind !== 'down') return { changes: this.palmOutSingles(time), revertPan: false };
    this.penDown = true;
    const revertPan = this.panActive || time - this.lastPanEnd <= this.tuning.panRevertMs;
    if (revertPan) this.lastPanEnd = -Infinity;
    const changes: RoleChange[] = [];
    for (const [id, contact] of this.contacts) {
      if (contact.role === 'palm' || contact.role === 'grip') continue;
      if (contact.role === 'pan') this.endPan(time);
      changes.push(this.assign(id, contact, 'palm'));
    }
    return { changes, revertPan };
  }

  /** Whether a quick two-finger tap that just ended may undo. */
  allowsUndoTap(time: number): boolean {
    return this.options.twoFingerUndo() && !this.penDown && time - this.lastPen >= this.tuning.undoPenQuietMs;
  }

  private liveIds(): number[] {
    return [...this.contacts].filter(([, c]) => LIVE_ROLES.includes(c.role)).map(([id]) => id);
  }

  private assign(
    id: number,
    contact: Contact,
    to: TouchRole,
    from: TouchRole | null = contact.role,
  ): RoleChange {
    contact.role = to;
    return { id, from, to, start: { ...contact.start }, at: { ...contact.at } };
  }

  /** Every contact becomes `grip` until all lift. */
  private startGrip(newId: number, time: number): RoleChange[] {
    this.gripActive = true;
    const changes: RoleChange[] = [];
    for (const [id, contact] of this.contacts) {
      if (contact.role === 'pan') this.endPan(time);
      changes.push(this.assign(id, contact, 'grip', id === newId ? null : contact.role));
    }
    return changes;
  }

  /** A contact grew past the palm size; a pinch partner is left `held`. */
  private toPalm(id: number, contact: Contact, time: number): RoleChange[] {
    const was = contact.role;
    const changes = [this.assign(id, contact, 'palm')];
    if (was === 'pan') this.endPan(time);
    if (was === 'pinch') {
      for (const [otherId, other] of this.contacts) {
        if (other.role === 'pinch') changes.push(this.assign(otherId, other, 'held'));
      }
    }
    return changes;
  }

  /** A pen event without contact: single fingers that were about to scroll or draw are palms. */
  private palmOutSingles(time: number): RoleChange[] {
    const changes: RoleChange[] = [];
    for (const [id, contact] of this.contacts) {
      if (contact.role !== 'pending' && contact.role !== 'pan' && contact.role !== 'draw') continue;
      if (contact.role === 'pan') this.endPan(time);
      changes.push(this.assign(id, contact, 'palm'));
    }
    return changes;
  }

  private releasePartner(time: number): RoleChange[] {
    const changes: RoleChange[] = [];
    const singleMayPan = !this.options.twoFingerScroll() && !this.inSession(time);
    for (const [id, contact] of this.contacts) {
      if (contact.role !== 'pinch') continue;
      // Intent is measured afresh from here, so the page does not jump by the pinch's travel.
      contact.canTap = false;
      contact.start = { ...contact.at };
      contact.t0 = time;
      changes.push(this.assign(id, contact, singleMayPan ? 'pending' : 'held'));
    }
    return changes;
  }

  private panIntended(contact: Contact, time: number): boolean {
    if (this.options.twoFingerScroll() || this.inSession(time)) return false;
    const moved = Math.hypot(contact.at.x - contact.start.x, contact.at.y - contact.start.y);
    return moved > this.tuning.panSlop && time - contact.t0 >= this.tuning.panDelayMs;
  }

  private isTap(contact: Contact, time: number): boolean {
    if (contact.role !== 'pending' || !contact.canTap) return false;
    const moved = Math.hypot(contact.at.x - contact.start.x, contact.at.y - contact.start.y);
    return moved < this.tuning.tapSlop && time - contact.t0 < this.tuning.tapMs;
  }

  private endPan(time: number): void {
    this.panActive = false;
    this.lastPanEnd = time;
  }
}
