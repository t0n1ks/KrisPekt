import type { Camera } from '../../canvas/Camera';
import type { ThemeColors } from '../../canvas/ThemeColors';
import { MM, RULER_H, TEXT_FONT } from '../../core/constants';
import type { Point } from '../../core/types';
import { byId, context2d, query } from '../../core/utils/dom';
import type { I18n } from '../../i18n/I18n';
import { Ruler } from '../../tools/Ruler';

type RulerGesture =
  | { type: 'move'; cx: number; cy: number; x: number; y: number }
  | { type: 'rotate'; angle: number; start: number; cx: number; cy: number; mx: number; my: number };

/** First tick is this far from the left end. */
const TICK_START = 14;

/**
 * The on-screen ruler: millimetre ticks matching the current zoom, the angle readout, and
 * finger gestures (one finger moves, two rotate with 45° snapping).
 *
 * Pens (and Alt + mouse) are not handled here: their pointer-down is forwarded to the input
 * router, which captures the pointer on the canvas so the stroke can run along the edge.
 * Palm contacts (too large, or while the pen is down) are ignored, and a finger that spreads
 * into a palm mid-drag is dropped, so the hand resting on the ruler does not move it.
 */
export class RulerWidget {
  private readonly node = byId('ruler');
  private readonly canvas = query<HTMLCanvasElement>('canvas', this.node);
  private readonly angleLabel = query<HTMLElement>('.ruler__angle', this.node);
  private readonly pointers = new Map<number, Point>();
  private gesture: RulerGesture | null = null;
  private drawnZoom = 0;
  private drawnLength = 0;

  constructor(
    private readonly ruler: Ruler,
    private readonly camera: Camera,
    private readonly theme: ThemeColors,
    private readonly i18n: I18n,
    private readonly forwardPen: (e: PointerEvent) => void,
    private readonly isPalm: (e: PointerEvent) => boolean,
  ) {
    this.node.addEventListener('pointerdown', (e) => this.down(e));
    this.node.addEventListener('pointermove', (e) => this.move(e));
    this.node.addEventListener('pointerup', (e) => this.up(e));
    this.node.addEventListener('pointercancel', (e) => this.up(e));
  }

  /** Shows or hides the ruler; showing places it in the default position. */
  setVisible(on: boolean): void {
    this.ruler.on = on;
    if (on) this.ruler.placeDefault(this.camera.width, this.camera.height);
    this.node.hidden = !on;
    this.invalidate();
    this.position();
  }

  /** Forces the ticks to be redrawn (zoom, theme or language changed). */
  invalidate(): void {
    this.drawnZoom = 0;
  }

  /** Applies the ruler's position and angle, redrawing the ticks if needed. */
  position(): void {
    const r = this.ruler;
    if (!r.on) return;
    if (this.drawnZoom !== this.camera.z || this.drawnLength !== r.length) this.drawTicks();
    this.node.style.width = r.length + 'px';
    this.node.style.transform = `translate(${r.cx - r.length / 2}px, ${r.cy - RULER_H / 2}px) rotate(${r.angle}rad)`;
    this.angleLabel.textContent = r.degrees + '°';
  }

  private drawTicks(): void {
    const r = this.ruler;
    const d = this.camera.dpr;
    this.canvas.width = Math.round(r.length * d);
    this.canvas.height = Math.round(RULER_H * d);
    this.canvas.style.width = r.length + 'px';
    this.canvas.style.height = RULER_H + 'px';
    const x = context2d(this.canvas);
    x.setTransform(d, 0, 0, d, 0, 0);
    x.clearRect(0, 0, r.length, RULER_H);
    x.strokeStyle = this.theme.fg;
    x.fillStyle = this.theme.fg;
    x.lineWidth = 1;
    const mm = MM * this.camera.z;
    // Skip millimetre ticks that would be closer than 2.2 px.
    const every = mm >= 2.2 ? 1 : mm * 5 >= 2.2 ? 5 : 10;
    x.font = `500 10px ${TEXT_FONT}`;
    x.textAlign = 'center';
    x.textBaseline = 'top';
    x.beginPath();
    for (let i = 0; TICK_START + i * mm <= r.length - 10; i += every) {
      const u = Math.round(TICK_START + i * mm) + 0.5;
      const len = i % 10 === 0 ? 15 : i % 5 === 0 ? 10 : 6;
      x.moveTo(u, 0);
      x.lineTo(u, len);
      x.moveTo(u, RULER_H);
      x.lineTo(u, RULER_H - len);
    }
    x.stroke();
    if (mm * 10 >= 20) {
      for (let i = 0; TICK_START + i * mm <= r.length - 10; i += 10)
        x.fillText(String(i / 10), TICK_START + i * mm, 17);
    }
    x.textBaseline = 'bottom';
    x.fillStyle = this.theme.muted;
    x.fillText(this.i18n.t('cm'), r.length - 16, RULER_H - 17);
    this.drawnZoom = this.camera.z;
    this.drawnLength = r.length;
  }

  private down(e: PointerEvent): void {
    if (e.pointerType === 'pen' || (e.pointerType === 'mouse' && e.altKey)) {
      e.preventDefault();
      this.forwardPen(e);
      return;
    }
    e.stopPropagation();
    if (this.isPalm(e)) return;
    try {
      this.node.setPointerCapture(e.pointerId);
    } catch {
      /* pointer already gone */
    }
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.startGesture();
  }

  private move(e: PointerEvent): void {
    if (!this.pointers.has(e.pointerId) || !this.gesture) return;
    if (this.isPalm(e)) {
      this.up(e);
      return;
    }
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const r = this.ruler;
    const g = this.gesture;
    const [a, b] = [...this.pointers.values()];
    if (!a) return;
    if (g.type === 'move') {
      r.cx = g.cx + a.x - g.x;
      r.cy = g.cy + a.y - g.y;
    } else if (b) {
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      r.angle = Ruler.snapAngle(g.angle + (angle - g.start));
      r.cx = g.cx + (a.x + b.x) / 2 - g.mx;
      r.cy = g.cy + (a.y + b.y) / 2 - g.my;
    }
    r.clampPosition(this.camera.width, this.camera.height);
    this.position();
  }

  private up(e: PointerEvent): void {
    if (!this.pointers.delete(e.pointerId)) return;
    if (this.pointers.size) this.startGesture();
    else this.gesture = null;
  }

  private startGesture(): void {
    const r = this.ruler;
    const [a, b] = [...this.pointers.values()];
    if (!a) return;
    if (!b) {
      this.gesture = { type: 'move', cx: r.cx, cy: r.cy, x: a.x, y: a.y };
      return;
    }
    this.gesture = {
      type: 'rotate',
      angle: r.angle,
      start: Math.atan2(b.y - a.y, b.x - a.x),
      cx: r.cx,
      cy: r.cy,
      mx: (a.x + b.x) / 2,
      my: (a.y + b.y) / 2,
    };
  }
}
