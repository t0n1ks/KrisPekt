import { RULER_H } from '../core/constants';
import type { Point } from '../core/types';
import { clamp } from '../core/utils/math';

/** Which edge a pen snapped to, with the ruler's direction cosines. */
export interface RulerSnap {
  /** Signed offset of the edge from the centre line (±RULER_H/2). */
  edge: number;
  cos: number;
  sin: number;
}

/** Pen within this many px outside an edge still snaps to it. */
const SNAP_DISTANCE = 26;
/** Snapping extends this far beyond the ends of the ruler. */
const SNAP_OVERHANG = 30;
/** Rotation snaps to multiples of 45° within this many degrees. */
const ANGLE_SNAP_DEG = 2.5;

/**
 * The ruler's state in screen space and the snapping math. A stroke that starts near one of
 * its long edges is projected onto that edge, offset by half the stroke width so the ink
 * touches the edge instead of running under it.
 */
export class Ruler {
  on = false;
  /** Centre in stage px. */
  cx = 300;
  cy = 300;
  /** Angle in radians. */
  angle = 0;
  /** Length in px. */
  length = 640;

  /** Default placement: centred, slightly above the middle, horizontal. */
  placeDefault(viewWidth: number, viewHeight: number): void {
    this.length = Math.min(viewWidth - 32, 760);
    this.cx = viewWidth / 2;
    this.cy = viewHeight * 0.45;
    this.angle = 0;
  }

  /** Keeps the ruler inside a resized stage. */
  fit(viewWidth: number, viewHeight: number): void {
    this.length = Math.min(viewWidth - 32, 760);
    this.cx = clamp(this.cx, 40, viewWidth - 40);
    this.cy = clamp(this.cy, 40, viewHeight - 40);
  }

  /** Keeps a dragged ruler reachable (at least 40 px of it on screen). */
  clampPosition(viewWidth: number, viewHeight: number): void {
    this.cx = clamp(this.cx, -this.length / 2 + 40, viewWidth + this.length / 2 - 40);
    this.cy = clamp(this.cy, 10, viewHeight - 10);
  }

  /** Snaps an angle to the nearest multiple of 45° when within 2.5°. */
  static snapAngle(angle: number): number {
    const deg = (angle * 180) / Math.PI;
    const near = Math.round(deg / 45) * 45;
    return Math.abs(deg - near) < ANGLE_SNAP_DEG ? (near * Math.PI) / 180 : angle;
  }

  /** Angle shown on the ruler, 0–179°. */
  get degrees(): number {
    return Math.round(((((this.angle * 180) / Math.PI) % 180) + 180) % 180);
  }

  /** The edge a screen point snaps to, or null if it is too far from the ruler. */
  snap(pt: Point): RulerSnap | null {
    if (!this.on) return null;
    const cos = Math.cos(this.angle);
    const sin = Math.sin(this.angle);
    const dx = pt.x - this.cx;
    const dy = pt.y - this.cy;
    const u = dx * cos + dy * sin;
    const v = -dx * sin + dy * cos;
    const half = RULER_H / 2;
    if (Math.abs(u) > this.length / 2 + SNAP_OVERHANG) return null;
    const dTop = Math.abs(v + half);
    const dBottom = Math.abs(v - half);
    if (Math.min(dTop, dBottom) > SNAP_DISTANCE && Math.abs(v) > half) return null;
    return { edge: dTop < dBottom ? -half : half, cos, sin };
  }

  /** Projects a screen point onto the snapped edge, outside it by half the stroke width (screen px). */
  project(pt: Point, snap: RulerSnap, strokeWidthPx: number): Point {
    const dx = pt.x - this.cx;
    const dy = pt.y - this.cy;
    const u = dx * snap.cos + dy * snap.sin;
    const offset = snap.edge + Math.sign(snap.edge) * (strokeWidthPx / 2 + 1);
    return { x: this.cx + u * snap.cos - offset * snap.sin, y: this.cy + u * snap.sin + offset * snap.cos };
  }
}
