import { BRUSH_KINDS, BRUSH_SPECS, MM, PEN_COLORS, STRAIGHTEN_HOLD_MS } from '../core/constants';
import type { BrushKind, Page, PenPrefs, Point, RecentColors, Stroke, StrokeKind } from '../core/types';
import { context2d, el, replaceChildren } from '../core/utils/dom';
import { clamp } from '../core/utils/math';
import type { LiveLayer } from '../canvas/LiveLayer';
import { StrokeGeometry } from '../canvas/StrokeGeometry';
import { ColorLists } from '../domain/ColorLists';
import { BRUSH_LABELS } from '../ui/labels';
import { ColorPalette } from '../ui/widgets/ColorPalette';
import type { RulerSnap } from './Ruler';
import { Tool } from './Tool';

interface StrokeOperation {
  page: Page;
  kind: StrokeKind;
  brush: BrushKind | undefined;
  color: string;
  size: number;
  points: number[];
  byTouch: boolean;
  snap: RulerSnap | null;
  straight: boolean;
  anchor: { x: number; y: number; pressure: number } | null;
  holdTimer: ReturnType<typeof setTimeout> | undefined;
  armedAt: Point | null;
}

/** Below this squared movement (in screen px, converted to world) a new point is skipped. */
const MIN_STEP_PX = 0.35;
/** Holding the pointer within this many px keeps the straighten timer running. */
const HOLD_SLOP_PX = 3;

/**
 * Freehand pen with stylus pressure and five brush types (each remembers its colour and size). Input is smoothed in three ways: coalesced pointer events
 * keep every sample, positions follow the pointer with a lag factor (streamline smoothing,
 * stronger for fingers), and pressure is low-pass filtered. Holding the stylus still for
 * 650 ms turns a long, nearly straight stroke into a straight line. Strokes that start near
 * the ruler's edge are snapped to it.
 */
export class PenTool extends Tool {
  readonly kind: StrokeKind = 'pen';
  private op: StrokeOperation | null = null;

  /** The user's settings for this tool: the current brush's colour and size. */
  protected get settings(): PenPrefs {
    const { prefs } = this.ctx;
    return prefs.brushes[prefs.brush];
  }

  /** Brush id stored on new strokes; undefined for the highlighter. */
  protected get brush(): BrushKind | undefined {
    return this.ctx.prefs.brush;
  }

  onPointerDown(e: PointerEvent, pt: Point): void {
    const { camera, layout, ruler } = this.ctx;
    const w = camera.toWorld(pt.x, pt.y);
    const snap = ruler.snap(pt);
    // Near the ruler a stroke may start just outside a page and still land on it.
    const page = layout.pageAt(w.x, w.y) ?? (snap ? layout.pageAt(w.x, w.y, 40 / camera.z) : null);
    if (!page) return;
    this.startOperation(e);
    const s = this.settings;
    this.op = {
      page,
      kind: this.kind,
      brush: this.brush,
      color: s.c,
      size: s.s,
      points: [],
      byTouch: e.pointerType === 'touch',
      snap,
      straight: false,
      anchor: null,
      holdTimer: undefined,
      armedAt: null,
    };
    this.addPoint(e, pt);
    this.armHold(pt);
    this.ctx.requestLive();
  }

  override onPointerMove(e: PointerEvent): void {
    if (!this.op) return;
    const events = e.getCoalescedEvents?.() ?? [];
    let last: Point | null = null;
    for (const ev of events.length ? events : [e]) {
      last = this.ctx.camera.toLocal(ev.clientX, ev.clientY);
      this.addPoint(ev, last);
    }
    if (last) this.armHold(last);
    this.ctx.requestLive();
  }

  override onPointerUp(): void {
    const op = this.finish();
    if (op && op.points.length >= 3) {
      const stroke: Stroke = {
        id: this.ctx.makeId(),
        k: op.kind,
        c: op.color,
        s: op.size,
        p: Float32Array.from(op.points),
      };
      // Ballpoint is the default: leaving `b` out keeps such strokes identical to older ones.
      if (op.brush && op.brush !== 'ballpoint') stroke.b = op.brush;
      this.ctx.commitStroke(op.page, stroke);
    }
    this.ctx.requestLive();
  }

  override onPointerCancel(): void {
    this.finish();
    this.ctx.requestLive();
  }

  private finish(): StrokeOperation | null {
    const op = this.op;
    if (op) clearTimeout(op.holdTimer);
    this.op = null;
    this.endOperation();
    return op;
  }

  private addPoint(e: PointerEvent, pt: Point): void {
    const op = this.op;
    if (!op) return;
    const { camera, layout, ruler } = this.ctx;
    const screen = op.snap ? ruler.project(pt, op.snap, op.size * camera.z) : pt;
    const local = layout.toPage(op.page, camera.toWorld(screen.x, screen.y));
    let { x, y } = local;
    let pressure = e.pointerType === 'pen' ? (e.pressure > 0 ? e.pressure : 0.5) : 0.5;
    if (op.straight && op.anchor) {
      op.points = StrokeGeometry.line(op.anchor.x, op.anchor.y, op.anchor.pressure, x, y);
      return;
    }
    const n = op.points.length;
    if (n) {
      const px = op.points[n - 3] ?? 0;
      const py = op.points[n - 2] ?? 0;
      const dx = x - px;
      const dy = y - py;
      if (dx * dx + dy * dy < Math.pow(MIN_STEP_PX / camera.z, 2)) return;
      if (!op.snap) {
        const lag = op.byTouch ? 0.45 : 0.6;
        x = px + dx * lag;
        y = py + dy * lag;
      }
      pressure = (op.points[n - 1] ?? 0.5) * 0.6 + pressure * 0.4;
    }
    op.points.push(x, y, pressure);
  }

  /** (Re)starts the straighten timer unless the pointer is still holding near the same spot. */
  private armHold(pt: Point): void {
    const op = this.op;
    if (!op || op.snap || op.straight || !this.ctx.prefs.straighten) return;
    if (op.armedAt && Math.hypot(pt.x - op.armedAt.x, pt.y - op.armedAt.y) < HOLD_SLOP_PX) return;
    op.armedAt = pt;
    clearTimeout(op.holdTimer);
    op.holdTimer = setTimeout(() => {
      if (this.op === op) this.tryStraighten(op);
    }, STRAIGHTEN_HOLD_MS);
  }

  private tryStraighten(op: StrokeOperation): void {
    if (op.straight) return;
    const pressure = StrokeGeometry.straightLinePressure(op.points, this.ctx.camera.z);
    if (pressure === null) return;
    const n = op.points.length;
    op.straight = true;
    op.anchor = { x: op.points[0] ?? 0, y: op.points[1] ?? 0, pressure };
    op.points = StrokeGeometry.line(
      op.anchor.x,
      op.anchor.y,
      pressure,
      op.points[n - 3] ?? 0,
      op.points[n - 2] ?? 0,
    );
    this.ctx.requestLive();
  }

  override renderOverlay(ctx: CanvasRenderingContext2D, live: LiveLayer): void {
    const op = this.op;
    if (!op || !op.points.length) return;
    live.usePageSpace(ctx, op.page);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, op.page.w * MM, op.page.h * MM);
    ctx.clip();
    this.ctx.strokes.draw(ctx, { k: op.kind, b: op.brush, c: op.color, s: op.size, p: op.points }, true);
    ctx.restore();
  }

  /* ---------- options ---------- */

  protected get palette(): readonly string[] {
    return PEN_COLORS;
  }

  protected get paletteNames(): string[] {
    return this.ctx.i18n.list('penColorNames');
  }

  /** Which recent-colours list this tool uses. */
  protected get recentKey(): keyof RecentColors {
    return 'pen';
  }

  protected get sizeRange(): { min: number; max: number; step: number } {
    return BRUSH_SPECS[this.ctx.prefs.brush];
  }

  protected get title(): string {
    return this.ctx.i18n.t('pen');
  }

  createOptionsPanel(): HTMLElement {
    const panel = el('div', { class: 'popover__content' });
    this.fillPanel(panel);
    return panel;
  }

  /** (Re)builds the options for the current settings; a brush switch rebuilds them in place. */
  private fillPanel(panel: HTMLElement): void {
    const preview = el('canvas', {
      class: 'popover__preview',
      attrs: { width: 600, height: 92, 'aria-hidden': 'true' },
    });
    const drawPreview = (): void => this.drawPreview(preview);
    replaceChildren(
      panel,
      el('h3', { class: 'popover__title' }, this.title),
      ...this.brushPicker(panel),
      preview,
      this.colorPalette(drawPreview).node,
      this.sizeField(drawPreview),
      ...this.extraOptions(),
    );
    requestAnimationFrame(drawPreview);
  }

  private colorPalette(onChange: () => void): ColorPalette {
    const { i18n, prefs } = this.ctx;
    const key = this.recentKey;
    return new ColorPalette(i18n, {
      colors: this.palette,
      names: this.paletteNames,
      current: this.settings.c,
      onPick: (c) => {
        this.settings.c = c;
        onChange();
        this.ctx.savePrefs();
        this.ctx.refreshTray();
      },
      custom: {
        recent: prefs.recent[key],
        commit: (c) => {
          prefs.recent[key] = ColorLists.pushRecent(prefs.recent[key], c);
          this.ctx.savePrefs();
          return prefs.recent[key];
        },
      },
    });
  }

  private sizeField(onChange: () => void): HTMLElement {
    const { i18n } = this.ctx;
    const s = this.settings;
    const { min, max, step } = this.sizeRange;
    const range = el('input', {
      attrs: {
        type: 'range',
        id: 'opt-size-' + this.kind,
        min,
        max,
        step,
        value: String(clamp(s.s, min, max)),
        'aria-label': i18n.t('thickness'),
      },
    });
    range.addEventListener('input', () => {
      s.s = clamp(Number(range.value), min, max);
      onChange();
      this.ctx.savePrefs();
    });
    return el('div', { class: 'field' }, el('span', { class: 'field__label' }, i18n.t('thickness')), range);
  }

  /** The row of brush types, each with a live sample stroke (pen only). */
  protected brushPicker(panel: HTMLElement): HTMLElement[] {
    const { i18n, prefs } = this.ctx;
    const row = el('div', {
      class: 'brush-picker',
      attrs: { role: 'group', 'aria-label': i18n.t('brushType') },
    });
    for (const kind of BRUSH_KINDS) {
      const on = kind === prefs.brush;
      const sample = el('canvas', {
        class: 'brush-picker__sample',
        attrs: { width: 112, height: 56, 'aria-hidden': 'true' },
      });
      const button = el(
        'button',
        {
          class: 'brush-picker__button' + (on ? ' brush-picker__button--active' : ''),
          attrs: { type: 'button', 'aria-pressed': String(on), 'data-brush': kind },
          on: { click: () => this.selectBrush(kind, panel) },
        },
        sample,
        el('span', { class: 'brush-picker__label' }, i18n.t(BRUSH_LABELS[kind])),
      );
      row.append(button);
      requestAnimationFrame(() => this.drawBrushSample(sample, kind));
    }
    return [row];
  }

  /** Switches the pen's brush; the brush's own last colour and size come back with it. */
  private selectBrush(kind: BrushKind, panel: HTMLElement): void {
    const { prefs } = this.ctx;
    if (prefs.brush === kind) return;
    prefs.brush = kind;
    this.ctx.savePrefs();
    this.ctx.refreshTray();
    this.fillPanel(panel);
  }

  /** Pen-only options: pin colour to the tray, straighten toggle. */
  protected extraOptions(): HTMLElement[] {
    const { i18n, prefs } = this.ctx;
    const pin = el(
      'button',
      { class: 'btn', attrs: { type: 'button' }, on: { click: () => this.pinColor() } },
      i18n.t('pinColor'),
    );
    const checkbox = el('input', {
      attrs: { type: 'checkbox', id: 'opt-straight', checked: prefs.straighten },
    });
    checkbox.addEventListener('change', () => {
      prefs.straighten = checkbox.checked;
      this.ctx.savePrefs();
    });
    const row = el(
      'div',
      { class: 'popover__row' },
      el('label', { class: 'popover__row-label', attrs: { for: 'opt-straight' } }, i18n.t('straighten')),
      checkbox,
    );
    return [pin, row];
  }

  private pinColor(): void {
    const { prefs, i18n } = this.ctx;
    const favs = ColorLists.pin(prefs.favs, this.settings.c);
    if (!favs) {
      this.ctx.toast(i18n.t('colorAlready'));
      return;
    }
    prefs.favs = favs;
    this.ctx.savePrefs();
    this.ctx.refreshTray();
    this.ctx.toast(i18n.t('colorPinned'));
  }

  /** A sine-wave sample stroke with a pressure swell. */
  private drawPreview(canvas: HTMLCanvasElement): void {
    const c = context2d(canvas);
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, 600, 92);
    c.setTransform(2, 0, 0, 2, 0, 0);
    const points: number[] = [];
    for (let i = 0; i <= 60; i++) {
      points.push(
        20 + i * 4.3,
        23 + Math.sin((i / 60) * Math.PI * 2) * 8,
        0.3 + 0.5 * Math.sin((i / 60) * Math.PI),
      );
    }
    const s = this.settings;
    this.ctx.strokes.draw(c, { k: this.kind, b: this.brush, c: s.c, s: s.s, p: points }, true);
  }

  /** A short S-curve in the brush's own colour, with rising then falling pressure. */
  private drawBrushSample(canvas: HTMLCanvasElement, kind: BrushKind): void {
    const c = context2d(canvas);
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, canvas.width, canvas.height);
    c.setTransform(2, 0, 0, 2, 0, 0);
    const brush = this.ctx.prefs.brushes[kind];
    // Very large sizes would fill the tiny sample, so it is capped near the default size.
    const size = Math.min(brush.s, BRUSH_SPECS[kind].defaults.s * 1.4);
    const points: number[] = [];
    for (let i = 0; i <= 30; i++) {
      const t = i / 30;
      points.push(8 + t * 40, 14 - Math.sin(t * Math.PI * 2) * 6, 0.2 + 0.7 * Math.sin(t * Math.PI));
    }
    this.ctx.strokes.draw(c, { k: 'pen', b: kind, c: brush.c, s: size, p: points }, true);
  }
}
