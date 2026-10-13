import { GAP, MAX_CACHE_PX, MM, PAPER, PINCH_CACHE_PX, TEXT_FONT } from '../core/constants';
import type { Page } from '../core/types';
import { context2d } from '../core/utils/dom';
import type { EditorSession } from '../editor/EditorSession';
import type { I18n } from '../i18n/I18n';
import type { Camera } from './Camera';
import { PageCache, type SkipInfo } from './PageCache';
import type { PageLayout } from './PageLayout';
import type { PagePainter } from './PagePainter';
import type { ThemeColors } from './ThemeColors';

export interface RendererDeps {
  canvas: HTMLCanvasElement;
  camera: Camera;
  layout: PageLayout;
  session: EditorSession;
  cache: PageCache;
  painter: PagePainter;
  theme: ThemeColors;
  i18n: I18n;
  /** Items hidden from page bitmaps (selection being dragged, text being edited). */
  skipFor: (page: Page) => SkipInfo;
  /** Called at the end of every frame: live layer, overlays, top bar. */
  afterRender: () => void;
}

/**
 * Draws the desk, page shadows, cached page bitmaps and page numbers on the main canvas.
 * Frames are coalesced with requestAnimationFrame. While pinching, a page bitmap painted at
 * another zoom is stretched instead of repainted every frame, but only if it shows the page's
 * current content; otherwise the page is repainted once at the current zoom (at a lower
 * resolution) and that bitmap is stretched from then on. The pinch end repaints at full quality.
 */
export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private frame = 0;
  private pinching = false;
  private enabled = false;

  constructor(private readonly deps: RendererDeps) {
    this.ctx = context2d(deps.canvas);
  }

  /** Turns rendering on while the editor is visible. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /** While true, outdated page bitmaps are scaled instead of repainted. */
  setPinching(pinching: boolean): void {
    this.pinching = pinching;
  }

  get isPinching(): boolean {
    return this.pinching;
  }

  /** Schedules a frame. */
  request(): void {
    if (!this.frame) this.frame = requestAnimationFrame(() => this.render());
  }

  /** Renders immediately (also cancels nothing: a scheduled frame will run again cheaply). */
  render(): void {
    this.frame = 0;
    const { camera, session, layout, cache } = this.deps;
    if (!this.enabled || !session.isOpen) return;
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = this.deps.theme.desk;
    ctx.fillRect(0, 0, this.deps.canvas.width, this.deps.canvas.height);
    const visible = new Set<string>();
    session.pages.forEach((page, index) => {
      if (this.drawPage(page, index)) visible.add(page.id);
    });
    cache.prune(visible);
    session.currentIndex = layout.currentIndex(camera.y, camera.height / camera.z);
    this.deps.afterRender();
  }

  /** Draws one page and its number; returns true if the page itself was on screen. */
  private drawPage(page: Page, index: number): boolean {
    const { camera, layout } = this.deps;
    const z = camera.z;
    const sc = camera.scale;
    const pw = page.w * MM;
    const ph = page.h * MM;
    const pos = layout.pos(page);
    const viewTop = camera.y;
    const viewBottom = camera.y + camera.height / z;
    const viewLeft = camera.x;
    const viewRight = camera.x + camera.width / z;
    if (pos.y > viewBottom || pos.y + ph + GAP < viewTop || pos.x > viewRight || pos.x + pw < viewLeft)
      return false;
    const sx = Math.round((pos.x - camera.x) * sc);
    const sy = Math.round((pos.y - camera.y) * sc);
    const sw = pw * sc;
    const sh = ph * sc;
    let onScreen = false;
    if (pos.y + ph >= viewTop) {
      this.drawShadowedPaper(sx, sy, sw, sh);
      this.drawContent(page, sx, sy, sw, sh, sc);
      onScreen = true;
    }
    if (GAP * z > 15) this.drawLabel(page, index, sx + sw / 2, sy + sh + (GAP * sc) / 2);
    return onScreen;
  }

  private drawShadowedPaper(sx: number, sy: number, sw: number, sh: number): void {
    const ctx = this.ctx;
    const d = this.deps.camera.dpr;
    ctx.save();
    ctx.shadowColor = this.deps.theme.shadow;
    ctx.shadowBlur = 16 * d;
    ctx.shadowOffsetY = 3 * d;
    ctx.fillStyle = PAPER.white;
    ctx.fillRect(sx, sy, sw, sh);
    ctx.restore();
  }

  private drawContent(page: Page, sx: number, sy: number, sw: number, sh: number, sc: number): void {
    const { cache, session } = this.deps;
    const ctx = this.ctx;
    const skip = this.deps.skipFor(page);
    const revision = session.revision(page);
    const fresh = cache.fresh(page.id, PageCache.key(sc, revision, skip.key));
    if (fresh) {
      ctx.drawImage(fresh, sx, sy);
      return;
    }
    if (this.pinching) {
      const bitmap =
        cache.reusable(page.id, revision, skip.key) ??
        cache.paint(page, ...Renderer.cappedSize(sw, sh, sc), revision, skip);
      ctx.drawImage(bitmap, sx, sy, sw, sh);
      return;
    }
    if (sw * sh > MAX_CACHE_PX) {
      this.drawDirect(page, sx, sy, sw, sh, sc, skip);
      return;
    }
    ctx.drawImage(cache.paint(page, sw, sh, sc, revision, skip), sx, sy);
  }

  /** Width, height and scale of a page bitmap repainted mid-pinch: at most {@link PINCH_CACHE_PX}. */
  private static cappedSize(sw: number, sh: number, sc: number): [number, number, number] {
    const k = Math.min(1, Math.sqrt(PINCH_CACHE_PX / (sw * sh)));
    return [sw * k, sh * k, sc * k];
  }

  /** Deep zoom: the page is too big to cache, so it is drawn straight onto the screen. */
  private drawDirect(
    page: Page,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    sc: number,
    skip: SkipInfo,
  ): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.rect(sx, sy, sw, sh);
    ctx.clip();
    ctx.setTransform(sc, 0, 0, sc, sx, sy);
    this.deps.painter.paint(ctx, page, sc, skip.set);
    ctx.restore();
  }

  private drawLabel(page: Page, index: number, x: number, y: number): void {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = this.deps.theme.label;
    ctx.font = `500 ${11 * this.deps.camera.dpr}px ${TEXT_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const suffix = page.locked ? '' : '  · ' + this.deps.i18n.t('ownSizeLabel');
    ctx.fillText(String(index + 1) + suffix, x, y);
  }
}
