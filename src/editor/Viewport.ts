import type { Camera } from '../canvas/Camera';
import type { PageLayout } from '../canvas/PageLayout';
import type { Renderer } from '../canvas/Renderer';
import type { Page } from '../core/types';
import type { EditorSession } from './EditorSession';

/** Camera moves that depend on the page layout: relayout, scroll to a page, fit to width. */
export class Viewport {
  constructor(
    private readonly camera: Camera,
    private readonly layout: PageLayout,
    private readonly session: EditorSession,
    private readonly renderer: Renderer,
  ) {}

  /** Recomputes page positions after pages were added, removed, moved or resized. */
  relayout(): void {
    this.layout.update(this.session.pages);
    this.camera.clampTo(this.layout);
    this.renderer.request();
  }

  /** Scrolls so a page's top sits just below the tray. */
  scrollTo(page: Page): void {
    this.camera.y = this.layout.pos(page).y - this.camera.topPad / this.camera.z;
    this.camera.clampTo(this.layout);
    this.renderer.request();
  }

  /** Zooms to fit the widest page, keeping the point 40 % down the screen in place vertically. */
  fitWidth(): void {
    const { camera } = this;
    const anchor = camera.toWorld(camera.width / 2, camera.height * 0.4);
    camera.z = camera.fitZoom(this.layout);
    camera.centerX();
    camera.y = anchor.y - (camera.height * 0.4) / camera.z;
    camera.clampTo(this.layout);
    this.renderer.request();
  }
}
