import type { Camera } from '../canvas/Camera';
import type { PageLayout } from '../canvas/PageLayout';
import type { Renderer } from '../canvas/Renderer';
import type { Box, Page } from '../core/types';
import type { EditorSession } from './EditorSession';

/** Screen px kept free below and beside a revealed area: the toolbar may be there. */
const BOTTOM_ROOM = 90;
const SIDE_ROOM = 24;

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

  /**
   * Scrolls just far enough to show an area of a page, in page px. It only ever scrolls: the zoom
   * stays as it is, locked or not.
   */
  reveal(page: Page, area: Box): void {
    const { camera } = this;
    const pos = this.layout.pos(page);
    const z = camera.z;
    const top = camera.topPad / z;
    const bottom = BOTTOM_ROOM / z;
    const height = camera.height / z - top - bottom;
    const areaTop = pos.y + area.y0;
    const areaBottom = pos.y + area.y1;
    const above = areaTop < camera.y + top;
    const below = areaBottom > camera.y + top + height;
    if (above || below || areaBottom - areaTop > height) camera.y = areaTop - top;
    const left = pos.x + area.x0;
    const right = pos.x + area.x1;
    const margin = SIDE_ROOM / z;
    if (left < camera.x + margin || right > camera.x + camera.width / z - margin) camera.x = left - margin;
    camera.clampTo(this.layout);
    this.renderer.request();
  }

  /** Goes back to a place on a page. A locked zoom stays as it is. */
  showAt(page: Page, spot: { dy: number; x: number; z: number }): void {
    const { camera } = this;
    camera.setZoom(spot.z);
    camera.x = spot.x;
    camera.y = this.layout.pos(page).y + spot.dy;
    camera.clampTo(this.layout);
    this.renderer.request();
  }

  /** Zooms to fit the widest page, keeping the point 40 % down the screen in place vertically. */
  fitWidth(): void {
    const { camera } = this;
    const anchor = camera.toWorld(camera.width / 2, camera.height * 0.4);
    camera.setZoom(camera.fitZoom(this.layout));
    camera.centerX();
    camera.y = anchor.y - (camera.height * 0.4) / camera.z;
    camera.clampTo(this.layout);
    this.renderer.request();
  }

  /** Zooms to a value, keeping the point 40 % down the middle of the screen in place. */
  zoomTo(zoom: number): void {
    const { camera } = this;
    camera.zoomAt({ x: camera.width / 2, y: camera.height * 0.4 }, zoom);
    camera.clampTo(this.layout);
    this.renderer.request();
  }
}
