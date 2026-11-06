import {
  MAX_PDF_PAGES,
  PAPER,
  VIEWER_KEEP_PAGES,
  VIEWER_MAX_PIXELS,
  VIEWER_RENDER_MARGIN,
  VIEWER_ZOOM_MAX,
  VIEWER_ZOOM_MIN,
} from '../../core/constants';
import { context2d, el } from '../../core/utils/dom';
import { clamp } from '../../core/utils/math';
import type { PdfLoader } from '../../features/pdf/PdfLoader';
import type { I18n } from '../../i18n/I18n';
import { icon } from '../icons';

type PdfDocument = import('pdfjs-dist').PDFDocumentProxy;

/** One page's place in the column; its canvas exists only while it is near the view. */
interface PageSlot {
  index: number;
  node: HTMLDivElement;
  canvas: HTMLCanvasElement | null;
  /** The width the canvas was rendered for. */
  renderedWidth: number;
}

const WIDEST_PAGE = 900;
const SIDE_GAP = 16;
const ZOOM_STEP = 1.25;
const WHEEL_ZOOM = 0.002;
const SETTLE_MS = 180;

/**
 * The built-in read-only PDF viewer. It only ever paints pages on canvases: no links, forms or
 * scripts of the file are alive. Pages render when they come near the view and are released when
 * they are far away; closing frees everything, including the pdf.js worker.
 */
export class PdfViewer {
  private root: HTMLDivElement | null = null;
  private scroller: HTMLDivElement | null = null;
  private column: HTMLDivElement | null = null;
  private indicator: HTMLSpanElement | null = null;
  private pdf: PdfDocument | null = null;
  private observer: IntersectionObserver | null = null;
  private slots: PageSlot[] = [];
  private readonly near = new Set<PageSlot>();
  private zoom = 1;
  private rendering = false;
  private settleTimer: ReturnType<typeof setTimeout> | undefined;
  private pinch: { distance: number; zoom: number } | null = null;
  private readonly onKey = (e: KeyboardEvent): void => this.key(e);
  private readonly onResize = (): void => this.layout();

  constructor(
    private readonly i18n: I18n,
    private readonly loader: PdfLoader,
    private readonly notify: (message: string) => void,
  ) {}

  /** Whether the viewer is open. */
  get isOpen(): boolean {
    return this.root !== null;
  }

  /** Opens a file. A failure closes the viewer again, with a toast. */
  async open(file: Blob, title: string): Promise<void> {
    this.close();
    this.build(title);
    const root = this.root;
    try {
      const pdf = await this.loader.open(new Uint8Array(await file.arrayBuffer()));
      if (this.root !== root) {
        void pdf.loadingTask.destroy().catch(() => undefined);
        return;
      }
      this.pdf = pdf;
      await this.createSlots(pdf);
    } catch {
      if (this.root !== root) return;
      this.close();
      this.notify(this.i18n.t('viewerFail'));
    }
  }

  /** Closes and releases everything. */
  close(): void {
    if (!this.root) return;
    clearTimeout(this.settleTimer);
    this.observer?.disconnect();
    this.observer = null;
    for (const slot of this.slots) PdfViewer.release(slot);
    this.slots = [];
    this.near.clear();
    void this.pdf?.loadingTask.destroy().catch(() => undefined);
    this.pdf = null;
    window.removeEventListener('keydown', this.onKey, true);
    window.removeEventListener('resize', this.onResize);
    this.root.remove();
    this.root = null;
    this.scroller = null;
    this.column = null;
    this.indicator = null;
    this.zoom = 1;
    this.pinch = null;
  }

  private build(title: string): void {
    const t = this.i18n;
    const button = (label: string, name: 'minus' | 'plus' | 'close', run: () => void): HTMLButtonElement =>
      el(
        'button',
        {
          class: 'icon-btn',
          attrs: { type: 'button', 'aria-label': label, title: label },
          on: { click: run },
        },
        icon(name, 22),
      );
    this.indicator = el('span', { class: 'pdf-viewer__indicator', attrs: { 'aria-live': 'polite' } });
    this.column = el('div', { class: 'pdf-viewer__pages' });
    this.scroller = el('div', { class: 'pdf-viewer__scroll' }, this.column);
    this.root = el(
      'div',
      { class: 'pdf-viewer', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': title } },
      el(
        'header',
        { class: 'pdf-viewer__bar' },
        el('span', { class: 'pdf-viewer__title' }, title),
        this.indicator,
        button(t.t('viewerZoomOut'), 'minus', () => this.setZoom(this.zoom / ZOOM_STEP, true)),
        button(t.t('viewerZoomIn'), 'plus', () => this.setZoom(this.zoom * ZOOM_STEP, true)),
        button(t.t('close'), 'close', () => this.close()),
      ),
      this.scroller,
    );
    document.body.append(this.root);
    this.listen(this.scroller);
    window.addEventListener('keydown', this.onKey, true);
    window.addEventListener('resize', this.onResize);
  }

  private listen(scroller: HTMLDivElement): void {
    scroller.addEventListener('scroll', () => this.updateIndicator(), { passive: true });
    scroller.addEventListener(
      'wheel',
      (e) => {
        if (!e.ctrlKey && !e.metaKey) return;
        e.preventDefault();
        this.setZoom(this.zoom * (1 - e.deltaY * WHEEL_ZOOM), true, { x: e.clientX, y: e.clientY });
      },
      { passive: false },
    );
    scroller.addEventListener('touchstart', (e) => this.touchStart(e), { passive: false });
    scroller.addEventListener('touchmove', (e) => this.touchMove(e), { passive: false });
    scroller.addEventListener('touchend', (e) => this.touchEnd(e));
    scroller.addEventListener('touchcancel', (e) => this.touchEnd(e));
  }

  /** While open, every key is the viewer's: none may act on the page behind it. */
  private key(e: KeyboardEvent): void {
    e.stopPropagation();
    if (e.key === 'Escape') this.close();
  }

  private static fingers(e: TouchEvent): { distance: number; x: number; y: number } | null {
    const [a, b] = [e.touches[0], e.touches[1]];
    if (!a || !b) return null;
    return {
      distance: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
      x: (a.clientX + b.clientX) / 2,
      y: (a.clientY + b.clientY) / 2,
    };
  }

  private touchStart(e: TouchEvent): void {
    const fingers = PdfViewer.fingers(e);
    if (!fingers) return;
    if (e.cancelable) e.preventDefault();
    this.pinch = { distance: Math.max(1, fingers.distance), zoom: this.zoom };
  }

  private touchMove(e: TouchEvent): void {
    const fingers = PdfViewer.fingers(e);
    if (!fingers || !this.pinch) return;
    if (e.cancelable) e.preventDefault();
    this.setZoom((this.pinch.zoom * fingers.distance) / this.pinch.distance, true, fingers);
  }

  private touchEnd(e: TouchEvent): void {
    if (e.touches.length < 2) this.pinch = null;
  }

  private async createSlots(pdf: PdfDocument): Promise<void> {
    const first = await pdf.getPage(1);
    const base = first.getViewport({ scale: 1 });
    const count = Math.min(pdf.numPages, MAX_PDF_PAGES);
    const column = this.column;
    if (!column || !this.scroller) return;
    this.slots = Array.from({ length: count }, (_, index) => {
      const node = el('div', { class: 'pdf-viewer__page' });
      node.style.setProperty('--page-ratio', String(base.width / base.height));
      column.append(node);
      return { index, node, canvas: null, renderedWidth: 0 };
    });
    this.layout();
    this.observe(this.scroller);
    this.updateIndicator();
  }

  /** Pages near the view are rendered lazily, and those that fell far behind let go. */
  private observe(scroller: HTMLDivElement): void {
    const byNode = new Map(this.slots.map((slot) => [slot.node, slot]));
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const slot = byNode.get(entry.target as HTMLDivElement);
          if (!slot) continue;
          if (entry.isIntersecting) this.near.add(slot);
          else this.near.delete(slot);
        }
        void this.renderNear();
      },
      { root: scroller, rootMargin: `${VIEWER_RENDER_MARGIN}px` },
    );
    for (const slot of this.slots) this.observer.observe(slot.node);
  }

  /** The width of a page at 100%: the window's, up to what reads well on a desktop. */
  private baseWidth(): number {
    const available = (this.scroller?.clientWidth ?? innerWidth) - SIDE_GAP;
    return Math.min(WIDEST_PAGE, Math.max(1, available));
  }

  private layout(): void {
    this.column?.style.setProperty('--viewer-page-width', this.baseWidth() * this.zoom + 'px');
    this.scheduleRender();
  }

  /** Changes the zoom, keeping what is under `focus` (client px; default the middle) in place. */
  private setZoom(next: number, live: boolean, focus?: { x: number; y: number }): void {
    const scroller = this.scroller;
    if (!scroller) return;
    const zoom = clamp(next, VIEWER_ZOOM_MIN, VIEWER_ZOOM_MAX);
    if (zoom === this.zoom) return;
    const rect = scroller.getBoundingClientRect();
    const fx = (focus?.x ?? rect.left + rect.width / 2) - rect.left;
    const fy = (focus?.y ?? rect.top + rect.height / 2) - rect.top;
    const k = zoom / this.zoom;
    const left = (scroller.scrollLeft + fx) * k - fx;
    const top = (scroller.scrollTop + fy) * k - fy;
    this.zoom = zoom;
    this.layout();
    scroller.scrollLeft = left;
    scroller.scrollTop = top;
    if (!live) void this.renderNear();
  }

  /** A sharper render waits until the zoom stops changing; until then the canvas is stretched. */
  private scheduleRender(): void {
    clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(() => void this.renderNear(), SETTLE_MS);
  }

  private async renderNear(): Promise<void> {
    if (this.rendering) return;
    this.rendering = true;
    try {
      let slot: PageSlot | undefined;
      while ((slot = this.nextToRender())) await this.renderSlot(slot);
      this.releaseFar();
    } finally {
      this.rendering = false;
    }
  }

  private nextToRender(): PageSlot | undefined {
    const width = this.targetWidth();
    return [...this.near].sort((a, b) => a.index - b.index).find((slot) => slot.renderedWidth !== width);
  }

  private targetWidth(): number {
    return Math.round(this.baseWidth() * this.zoom);
  }

  private async renderSlot(slot: PageSlot): Promise<void> {
    const pdf = this.pdf;
    const width = this.targetWidth();
    slot.renderedWidth = width;
    if (!pdf) return;
    try {
      const page = await pdf.getPage(slot.index + 1);
      const base = page.getViewport({ scale: 1 });
      const dpr = window.devicePixelRatio || 1;
      const wanted = (width * dpr) / base.width;
      const limit = Math.sqrt(VIEWER_MAX_PIXELS / (base.width * base.height));
      const viewport = page.getViewport({ scale: Math.min(wanted, limit) });
      const canvas = el('canvas', { class: 'pdf-viewer__canvas' });
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = context2d(canvas);
      ctx.fillStyle = PAPER.white;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: ctx, viewport }).promise;
      page.cleanup();
      if (this.pdf !== pdf) return;
      slot.node.style.setProperty('--page-ratio', String(base.width / base.height));
      PdfViewer.release(slot);
      slot.canvas = canvas;
      slot.node.append(canvas);
    } catch {
      /* One page that cannot be painted stays blank; the others still show. */
    }
  }

  /** Canvases take a lot of memory: only the pages closest to the view keep theirs. */
  private releaseFar(): void {
    const current = this.currentIndex();
    const held = this.slots.filter((slot) => slot.canvas);
    held.sort((a, b) => Math.abs(b.index - current) - Math.abs(a.index - current));
    for (const slot of held.slice(0, Math.max(0, held.length - VIEWER_KEEP_PAGES))) {
      if (this.near.has(slot)) continue;
      PdfViewer.release(slot);
      slot.renderedWidth = 0;
    }
  }

  private static release(slot: PageSlot): void {
    if (!slot.canvas) return;
    slot.canvas.width = 0;
    slot.canvas.height = 0;
    slot.canvas.remove();
    slot.canvas = null;
  }

  /** The page at the middle of the view. */
  private currentIndex(): number {
    const scroller = this.scroller;
    if (!scroller) return 0;
    const rect = scroller.getBoundingClientRect();
    const middle = rect.top + rect.height / 2;
    let best = 0;
    let bestDistance = Infinity;
    for (const slot of this.near.size ? this.near : this.slots) {
      const box = slot.node.getBoundingClientRect();
      const distance = middle < box.top ? box.top - middle : middle > box.bottom ? middle - box.bottom : 0;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = slot.index;
      }
    }
    return best;
  }

  private updateIndicator(): void {
    if (!this.indicator || !this.slots.length) return;
    const i = this.currentIndex() + 1;
    this.indicator.textContent = this.i18n.t('viewerPageOf', { i, n: this.slots.length });
  }
}
