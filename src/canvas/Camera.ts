import { MAX_DPR, ZOOM_MAX, ZOOM_MIN } from '../core/constants';
import type { Point } from '../core/types';
import { clamp } from '../core/utils/math';
import type { PageLayout } from './PageLayout';

/**
 * The view onto the page stack: `x`/`y` is the world point at the stage's top-left corner and
 * `z` is the zoom (screen px per world px). Also tracks the stage size and device pixel ratio.
 */
export class Camera {
  x = 0;
  y = 0;
  z = 1;
  /** Stage width/height in CSS px. */
  width = 1;
  height = 1;
  /** Device pixel ratio, capped at 2. */
  dpr = 1;
  private left = 0;
  private top = 0;

  /** Updates the stage geometry; call on every resize. */
  resize(rect: { left: number; top: number; width: number; height: number }, devicePixelRatio: number): void {
    this.left = rect.left;
    this.top = rect.top;
    this.width = Math.max(1, rect.width);
    this.height = Math.max(1, rect.height);
    this.dpr = Math.min(devicePixelRatio || 1, MAX_DPR);
  }

  /** Canvas px per world px. */
  get scale(): number {
    return this.z * this.dpr;
  }

  /** Client (viewport) coordinates → stage-local CSS px. */
  toLocal(clientX: number, clientY: number): Point {
    return { x: clientX - this.left, y: clientY - this.top };
  }

  /** Stage-local CSS px → world px. */
  toWorld(x: number, y: number): Point {
    return { x: x / this.z + this.x, y: y / this.z + this.y };
  }

  /** World px → stage-local CSS px. */
  toScreen(x: number, y: number): Point {
    return { x: (x - this.x) * this.z, y: (y - this.y) * this.z };
  }

  /** Space kept above a page when scrolling to it (the tray floats there on wide screens). */
  get topPad(): number {
    return this.width > 640 ? 78 : 14;
  }

  /** Zoom that fits the widest page with a margin. */
  fitZoom(layout: PageLayout): number {
    return clamp((this.width - (this.width > 760 ? 96 : 20)) / layout.maxPageWidth, ZOOM_MIN, 2.4);
  }

  /** Centres the stack horizontally. */
  centerX(): void {
    this.x = -this.width / this.z / 2;
  }

  /** Changes zoom keeping the world point under `screen` fixed. */
  zoomAt(screen: Point, zoom: number): void {
    const w = this.toWorld(screen.x, screen.y);
    this.z = clamp(zoom, ZOOM_MIN, ZOOM_MAX);
    this.x = w.x - screen.x / this.z;
    this.y = w.y - screen.y / this.z;
  }

  /**
   * Keeps the view near the pages: centred when the widest page fits, otherwise panning
   * stops a little past the edges; vertically 60 % of a screen of slack at the top and bottom.
   */
  clampTo(layout: PageLayout): void {
    const z = this.z;
    const vw = this.width / z;
    const vh = this.height / z;
    const mw = layout.maxPageWidth;
    if (mw + 40 / z <= vw) this.x = -vw / 2;
    else this.x = clamp(this.x, -mw / 2 - 24 / z, mw / 2 + 24 / z - vw);
    this.y = clamp(this.y, -vh * 0.6, Math.max(-vh * 0.6, layout.totalHeight - vh * 0.4));
  }

  /** Snapshot of the position, used to revoke a pan when a pen lands. */
  snapshot(): { x: number; y: number; z: number } {
    return { x: this.x, y: this.y, z: this.z };
  }

  restore(s: { x: number; y: number; z: number }): void {
    this.x = s.x;
    this.y = s.y;
    this.z = s.z;
  }
}
