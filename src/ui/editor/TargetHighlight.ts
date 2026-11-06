import type { Camera } from '../../canvas/Camera';
import type { PageLayout } from '../../canvas/PageLayout';
import { JUMP_HIGHLIGHT_MS } from '../../core/constants';
import type { Box, Page } from '../../core/types';
import { byId } from '../../core/utils/dom';

/** Room around the highlighted area, in screen px. */
const PADDING = 4;

/**
 * Shows for a moment where a link led. It is an element over the page, so its look (and whether it
 * fades, under reduced motion) belongs to the style sheet.
 */
export class TargetHighlight {
  private readonly node = byId('jumpMark');
  private shown: { page: Page; area: Box } | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly camera: Camera,
    private readonly layout: PageLayout,
  ) {}

  show(page: Page, area: Box): void {
    this.shown = { page, area };
    clearTimeout(this.timer);
    this.position();
    // Taken off and put back so that a second jump plays the animation again.
    this.node.hidden = true;
    void this.node.offsetWidth;
    this.node.hidden = false;
    this.timer = setTimeout(() => this.hide(), JUMP_HIGHLIGHT_MS);
  }

  hide(): void {
    clearTimeout(this.timer);
    this.shown = null;
    this.node.hidden = true;
  }

  /** Follows the camera. */
  position(): void {
    if (!this.shown) return;
    const { page, area } = this.shown;
    const pos = this.layout.pos(page);
    const z = this.camera.z;
    const at = this.camera.toScreen(pos.x + area.x0, pos.y + area.y0);
    this.node.style.left = at.x - PADDING + 'px';
    this.node.style.top = at.y - PADDING + 'px';
    this.node.style.width = (area.x1 - area.x0) * z + PADDING * 2 + 'px';
    this.node.style.height = (area.y1 - area.y0) * z + PADDING * 2 + 'px';
  }
}
