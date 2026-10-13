import { MM, PAPER } from '../core/constants';
import type { Box, Page, Point } from '../core/types';
import { clamp } from '../core/utils/math';
import { ItemTransform, type ItemMapping, type PageItems } from '../domain/ItemTransform';
import { SelectionPlacement, type Rect } from '../domain/SelectionPlacement';
import type { BitmapCache } from '../canvas/BitmapCache';
import type { Camera } from '../canvas/Camera';
import type { LiveLayer, OverlayPainter } from '../canvas/LiveLayer';
import type { PageLayout } from '../canvas/PageLayout';
import type { StrokeGeometry } from '../canvas/StrokeGeometry';
import type { StrokePainter } from '../canvas/StrokePainter';
import type { TextLayout } from '../canvas/TextLayout';
import type { EditorSession } from '../editor/EditorSession';

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
  /** Records pages for undo before they change; several pages form one undo step. */
  recordUndo: (...pages: Page[]) => void;
  makeId: () => string;
  /** The selection appeared, changed or disappeared. */
  onChange: (state: SelectionState | null) => void;
}

/** Offset of duplicated items. */
const DUPLICATE_OFFSET = 6 * MM;
/** Screen radius around the resize handle that grabs it. */
const HANDLE_HIT = 24;

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

  /**
   * Bakes the pending move/scale into the items (one undo step). The selection lands on the page
   * under its centre (the nearest page if the centre is in a gap) and is shifted to lie inside
   * that page. Moving onto another page carries the items over, converting their coordinates,
   * and keeps them selected there.
   */
  apply(): void {
    const s = this.state;
    if (!s || (s.dx === 0 && s.dy === 0 && s.s === 1)) return;
    const source = s.page;
    const moved: Rect = { x: s.box.x + s.dx, y: s.box.y + s.dy, w: s.box.w * s.s, h: s.box.h * s.s };
    const target = this.dropTarget(source, moved);
    const offset = this.pageOffset(source, target);
    const shift = SelectionPlacement.clampShift(
      { ...moved, x: moved.x + offset.x, y: moved.y + offset.y },
      target.w * MM,
      target.h * MM,
    );
    const mapping: ItemMapping = {
      ox: s.box.x,
      oy: s.box.y,
      k: s.s,
      dx: s.dx + offset.x + shift.x,
      dy: s.dy + offset.y + shift.y,
    };
    if (target === source) this.transformOnPage(source, s.ids, mapping);
    else this.moveToPage(source, target, s.ids, mapping);
    this.set(target, s.ids);
  }

  /** The page under the centre of a box given in `source` page px. */
  private dropTarget(source: Page, box: Rect): Page {
    const pos = this.deps.layout.pos(source);
    const center = { x: pos.x + box.x + box.w / 2, y: pos.y + box.y + box.h / 2 };
    return this.deps.layout.nearestPage(center) ?? source;
  }

  /** What to add to `from`-page px to get `to`-page px. */
  private pageOffset(from: Page, to: Page): Point {
    const a = this.deps.layout.pos(from);
    const b = this.deps.layout.pos(to);
    return { x: a.x - b.x, y: a.y - b.y };
  }

  private transformOnPage(page: Page, ids: ReadonlySet<string>, mapping: ItemMapping): void {
    this.deps.recordUndo(page);
    Selection.setItems(page, ItemTransform.mapInPlace(page, ids, mapping));
    this.deps.session.touch(page);
  }

  /** Moves items from one page to another: one undo step that restores both pages. */
  private moveToPage(source: Page, target: Page, ids: ReadonlySet<string>, mapping: ItemMapping): void {
    this.deps.recordUndo(source, target);
    const { picked, rest } = ItemTransform.split(source, ids);
    const arrived = ItemTransform.map(picked, mapping);
    Selection.setItems(source, rest);
    Selection.setItems(target, {
      strokes: [...target.strokes, ...arrived.strokes],
      texts: [...target.texts, ...arrived.texts],
      images: [...target.images, ...arrived.images],
    });
    this.deps.session.touch(source);
    this.deps.session.touch(target);
  }

  private static setItems(page: Page, items: PageItems): void {
    page.strokes = items.strokes;
    page.texts = items.texts;
    page.images = items.images;
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

  /**
   * Copies the selected items 6 mm down-right and selects the copies. Like a move, the copies
   * are shifted back inside the page if the offset would push them over its edge.
   */
  duplicate(): void {
    const s = this.state;
    if (!s) return;
    const p = s.page;
    this.deps.recordUndo(p);
    const off = DUPLICATE_OFFSET;
    const shift = SelectionPlacement.clampShift(
      { ...s.box, x: s.box.x + off, y: s.box.y + off },
      p.w * MM,
      p.h * MM,
    );
    const copies = ItemTransform.map(
      ItemTransform.split(p, s.ids).picked,
      ItemTransform.translation(off + shift.x, off + shift.y),
    );
    const ids = new Set<string>();
    const fresh = <T extends { id: string }>(item: T): T => {
      const copy = { ...item, id: this.deps.makeId() };
      ids.add(copy.id);
      return copy;
    };
    p.strokes = [...p.strokes, ...copies.strokes.map(fresh)];
    p.texts = [...p.texts, ...copies.texts.map(fresh)];
    p.images = [...p.images, ...copies.images.map(fresh)];
    this.deps.session.touch(p);
    this.set(p, ids);
  }

  /**
   * Draws the selected items with the pending transform, the dashed frame and the resize
   * handle. Called on every frame, including zoom frames, so it always follows the camera.
   */
  renderOverlay(ctx: CanvasRenderingContext2D, live: LiveLayer): void {
    const s = this.state;
    if (!s) return;
    const p = s.page;
    live.usePageSpace(ctx, p);
    ctx.save();
    // Not clipped to the page: while dragging, the items follow the pointer across the gap
    // and onto the next page, where they land on release (see apply()).
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
