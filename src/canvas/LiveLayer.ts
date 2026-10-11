import type { Page } from '../core/types';
import { context2d } from '../core/utils/dom';
import type { Camera } from './Camera';
import type { PageLayout } from './PageLayout';

/** Something that draws transient feedback on the live layer (a tool, the selection). */
export interface OverlayPainter {
  renderOverlay(ctx: CanvasRenderingContext2D, live: LiveLayer): void;
}

/**
 * A transparent canvas above the main one for fast-changing feedback: the stroke being
 * drawn, the lasso path, the selection and the eraser cursor. Redrawing it is cheap, so the
 * page bitmaps underneath never have to be repainted while a pointer moves.
 */
export class LiveLayer {
  private readonly ctx: CanvasRenderingContext2D;
  private frame = 0;
  private painters: readonly OverlayPainter[] = [];

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly camera: Camera,
    private readonly layout: PageLayout,
  ) {
    this.ctx = context2d(canvas);
  }

  /** Painters, drawn in order on every frame. */
  setPainters(painters: readonly OverlayPainter[]): void {
    this.painters = painters;
  }

  /** Schedules a redraw. */
  request(): void {
    if (!this.frame) {
      this.frame = requestAnimationFrame(() => {
        this.frame = 0;
        this.render();
      });
    }
  }

  /** Redraws now. */
  render(): void {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    for (const painter of this.painters) painter.renderOverlay(ctx, this);
  }

  /** Sets the transform so that drawing happens in a page's local world px. */
  usePageSpace(ctx: CanvasRenderingContext2D, page: Page): void {
    const sc = this.camera.scale;
    const pos = this.layout.pos(page);
    ctx.setTransform(sc, 0, 0, sc, (pos.x - this.camera.x) * sc, (pos.y - this.camera.y) * sc);
  }

  /** Sets the transform to stage-local CSS px. */
  useScreenSpace(ctx: CanvasRenderingContext2D): void {
    const d = this.camera.dpr;
    ctx.setTransform(d, 0, 0, d, 0, 0);
  }

  /** Canvas px per screen px, for constant-width lines in page space. */
  get dpr(): number {
    return this.camera.dpr;
  }

  get scale(): number {
    return this.camera.scale;
  }
}
