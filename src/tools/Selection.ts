import { MM, PAPER } from '../core/constants';
import type { Box, Page, Point } from '../core/types';
import { clamp } from '../core/utils/math';
import type { BitmapCache } from '../canvas/BitmapCache';
import type { Camera } from '../canvas/Camera';
import type { LiveLayer, OverlayPainter } from '../canvas/LiveLayer';
import type { PageLayout } from '../canvas/PageLayout';
import type { StrokeGeometry } from '../canvas/StrokeGeometry';
import type { StrokePainter } from '../canvas/StrokePainter';
import type { TextLayout } from '../canvas/TextLayout';
import type { EditorSession } from '../editor/EditorSession';
import { LIMITS } from '../storage/validation/guards';

/** The selected items and the pending move/scale applied on release. */
export interface SelectionState {
  page: Page;
  ids: Set<string>;
  /** Bounding box in page px before the pending transform. */
  box: { x: number; y: number; w: number; h: number };
  dx: number;
  dy: number;
  /** Pending uniform scale around the box's top-left corner. */
  s: number;
  /** Changes whenever the selected items change; part of the page cache key. */
  token: number;
}

export interface SelectionDeps {
  camera: Camera;
  layout: PageLayout;
  session: EditorSession;
  geometry: StrokeGeometry;
  strokes: StrokePainter;
  texts: TextLayout;
  bitmaps: BitmapCache;
  recordUndo: (page: Page) => void;
  makeId: () => string;
  /** The selection appeared, changed or disappeared. */
  onChange: (state: SelectionState | null) => void;
}

/** Offset of duplicated items. */
const DUPLICATE_OFFSET = 6 * MM;
/** Screen radius around the resize handle that grabs it. */
const HANDLE_HIT = 24;

const clampCoord = (v: number): number => clamp(v, LIMITS.coord[0], LIMITS.coord[1]);

/**
 * Lasso selection: which items are selected, the pending move/scale while dragging, and the
 * edits on the selection (recolour, duplicate, delete). While selected, the items are hidden
 * from the page bitmap and drawn by {@link renderOverlay} on the live layer.
 */
export class Selection implements OverlayPainter {
  private state: SelectionState | null = null;
  private tokenSeq = 0;

  constructor(private readonly deps: SelectionDeps) {}

  get current(): SelectionState | null {
    return this.state;
  }

  /** Selects items on a page (clears the selection if `ids` is empty). */
  set(page: Page, ids: Set<string>): void {
    const box = this.boundsOf(page, ids);
    if (!box) {
      this.clear();
      return;
    }
    this.state = {
      page,
      ids,
      box: { x: box.x0, y: box.y0, w: Math.max(1, box.x1 - box.x0), h: Math.max(1, box.y1 - box.y0) },
      dx: 0,
      dy: 0,
      s: 1,
      token: ++this.tokenSeq,
    };
    this.deps.session.bump(page);
    this.deps.onChange(this.state);
  }

  clear(): void {
    const s = this.state;
    if (!s) return;
    this.state = null;
    this.deps.session.bump(s.page);
    this.deps.onChange(null);
  }

  /** Items of a page that the page bitmap must leave out. */
  hiddenOn(page: Page): { ids: Set<string>; token: number } | null {
    return this.state && this.state.page === page ? { ids: this.state.ids, token: this.state.token } : null;
  }

  /** Selection rectangle (with pending transform) in stage px. */
  screenBox(): { x: number; y: number; w: number; h: number } {
    const s = this.requireState();
    const pos = this.deps.layout.pos(s.page);
    const z = this.deps.camera.z;
    const tl = this.deps.camera.toScreen(pos.x + s.box.x + s.dx, pos.y + s.box.y + s.dy);
    return { x: tl.x, y: tl.y, w: s.box.w * s.s * z, h: s.box.h * s.s * z };
  }

  /** What a screen point touches: the resize handle, the selection, or nothing. */
  hit(pt: Point): 'handle' | 'inside' | null {
    if (!this.state) return null;
    const b = this.screenBox();
    if (Math.hypot(pt.x - (b.x + b.w + 6), pt.y - (b.y + b.h + 6)) < HANDLE_HIT) return 'handle';
    if (pt.x >= b.x - 10 && pt.x <= b.x + b.w + 10 && pt.y >= b.y - 10 && pt.y <= b.y + b.h + 10)
      return 'inside';
    return null;
  }

  /** Pending move in page px. */
  setOffset(dx: number, dy: number): void {
    if (!this.state) return;
    this.state.dx = dx;
    this.state.dy = dy;
  }

  /** Pending scale from a handle drag of (`dxPx`, `dyPx`) screen px; clamped to 0.1–12. */
  setScaleFromDrag(dxPx: number, dyPx: number): void {
    const s = this.state;
    if (!s) return;
    const z = this.deps.camera.z;
    const kx = (s.box.w * z + dxPx) / (s.box.w * z);
    const ky = (s.box.h * z + dyPx) / (s.box.h * z);
    s.s = clamp((kx + ky) / 2, 0.1, 12);
  }

  /** Drops a pending move/scale. */
  resetTransform(): void {
    if (!this.state) return;
    this.state.dx = 0;
    this.state.dy = 0;
    this.state.s = 1;
  }

  /** Bakes the pending move/scale into the items (one undo step). */
  apply(): void {
    const s = this.state;
    if (!s || (s.dx === 0 && s.dy === 0 && s.s === 1)) return;
    const p = s.page;
    this.deps.recordUndo(p);
    const { x: ox, y: oy } = s.box;
    const k = s.s;
    const tx = (x: number): number => clampCoord(ox + (x - ox) * k + s.dx);
    const ty = (y: number): number => clampCoord(oy + (y - oy) * k + s.dy);
    p.strokes = p.strokes.map((st) => {
      if (!s.ids.has(st.id)) return st;
      const a = new Float32Array(st.p.length);
      for (let i = 0; i < a.length; i += 3) {
        a[i] = tx(st.p[i] ?? 0);
        a[i + 1] = ty(st.p[i + 1] ?? 0);
        a[i + 2] = st.p[i + 2] ?? 0;
      }
      return { ...st, p: a, s: clamp(st.s * k, LIMITS.strokeWidth[0], LIMITS.strokeWidth[1]) };
    });
    p.texts = p.texts.map((t) =>
      s.ids.has(t.id)
        ? {
            ...t,
            x: tx(t.x),
            y: ty(t.y),
            w: t.w * k,
            fs: clamp(t.fs * k, LIMITS.fontSize[0], LIMITS.fontSize[1]),
          }
        : t,
    );
    p.images = p.images.map((im) =>
      s.ids.has(im.id) ? { ...im, x: tx(im.x), y: ty(im.y), w: im.w * k, h: im.h * k } : im,
    );
    s.box = { x: tx(ox), y: ty(oy), w: s.box.w * k, h: s.box.h * k };
    this.resetTransform();
    s.token = ++this.tokenSeq;
    this.deps.session.touch(p);
  }

  /** Recolours selected pen strokes and texts (highlighters and images keep their colours). */
  recolor(color: string): void {
    const s = this.state;
    if (!s) return;
    const p = s.page;
    this.deps.recordUndo(p);
    p.strokes = p.strokes.map((st) => (s.ids.has(st.id) && st.k === 'pen' ? { ...st, c: color } : st));
    p.texts = p.texts.map((t) => (s.ids.has(t.id) ? { ...t, c: color } : t));
    s.token = ++this.tokenSeq;
    this.deps.session.touch(p);
  }

  /** Deletes the selected items. */
  remove(): void {
    const s = this.state;
    if (!s) return;
    const p = s.page;
    this.deps.recordUndo(p);
    p.strokes = p.strokes.filter((x) => !s.ids.has(x.id));
    p.texts = p.texts.filter((x) => !s.ids.has(x.id));
    p.images = p.images.filter((x) => !s.ids.has(x.id));
    this.state = null;
    this.deps.onChange(null);
    this.deps.session.touch(p);
  }

  /** Copies the selected items 6 mm down-right and selects the copies. */
  duplicate(): void {
    const s = this.state;
    if (!s) return;
    const p = s.page;
    this.deps.recordUndo(p);
    const ids = new Set<string>();
    const off = DUPLICATE_OFFSET;
    for (const st of p.strokes.filter((x) => s.ids.has(x.id))) {
      const a = new Float32Array(st.p);
      for (let i = 0; i < a.length; i += 3) {
        a[i] = clampCoord((a[i] ?? 0) + off);
        a[i + 1] = clampCoord((a[i + 1] ?? 0) + off);
      }
      const copy = { ...st, id: this.deps.makeId(), p: a };
      p.strokes.push(copy);
      ids.add(copy.id);
    }
    for (const t of p.texts.filter((x) => s.ids.has(x.id))) {
      const copy = { ...t, id: this.deps.makeId(), x: clampCoord(t.x + off), y: clampCoord(t.y + off) };
      p.texts.push(copy);
      ids.add(copy.id);
    }
    for (const im of p.images.filter((x) => s.ids.has(x.id))) {
      const copy = { ...im, id: this.deps.makeId(), x: clampCoord(im.x + off), y: clampCoord(im.y + off) };
      p.images.push(copy);
      ids.add(copy.id);
    }
    this.deps.session.touch(p);
    this.set(p, ids);
  }

  /** Draws the selected items with the pending transform, the dashed frame and the resize handle. */
  renderOverlay(ctx: CanvasRenderingContext2D, live: LiveLayer): void {
    const s = this.state;
    if (!s) return;
    const p = s.page;
    live.usePageSpace(ctx, p);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, p.w * MM, p.h * MM);
    ctx.clip();
    ctx.translate(s.box.x + s.dx, s.box.y + s.dy);
    ctx.scale(s.s, s.s);
    ctx.translate(-s.box.x, -s.box.y);
    for (const im of p.images) {
      if (!s.ids.has(im.id)) continue;
      const bm = this.deps.bitmaps.get(im.blob);
      if (bm) ctx.drawImage(bm, im.x, im.y, im.w, im.h);
    }
    for (const st of p.strokes) if (s.ids.has(st.id)) this.deps.strokes.draw(ctx, st);
    for (const t of p.texts) if (s.ids.has(t.id)) this.deps.texts.draw(ctx, t);
    ctx.restore();
    this.drawFrame(ctx, live);
  }

  private drawFrame(ctx: CanvasRenderingContext2D, live: LiveLayer): void {
    const b = this.screenBox();
    live.useScreenSpace(ctx);
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = PAPER.ui;
    ctx.strokeRect(b.x - 6, b.y - 6, b.w + 12, b.h + 12);
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(b.x + b.w + 6, b.y + b.h + 6, 9, 0, Math.PI * 2);
    ctx.fillStyle = PAPER.white;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  /** Bounding box of one item on a page. */
  itemBox(page: Page, id: string): Box | null {
    const st = page.strokes.find((s) => s.id === id);
    if (st) return this.deps.geometry.bbox(st);
    const t = page.texts.find((x) => x.id === id);
    if (t) return this.deps.texts.box(t);
    const im = page.images.find((x) => x.id === id);
    if (im) return { x0: im.x, y0: im.y, x1: im.x + im.w, y1: im.y + im.h };
    return null;
  }

  private boundsOf(page: Page, ids: Set<string>): Box | null {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const id of ids) {
      const b = this.itemBox(page, id);
      if (!b) continue;
      x0 = Math.min(x0, b.x0);
      y0 = Math.min(y0, b.y0);
      x1 = Math.max(x1, b.x1);
      y1 = Math.max(y1, b.y1);
    }
    return Number.isFinite(x0) ? { x0, y0, x1, y1 } : null;
  }

  private requireState(): SelectionState {
    if (!this.state) throw new Error('Nothing is selected');
    return this.state;
  }
}
