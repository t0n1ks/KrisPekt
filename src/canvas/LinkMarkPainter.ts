import { PAPER } from '../core/constants';
import type { LinkTarget, Page } from '../core/types';
import type { PathSink } from './brushes/PathSink';
import type { DrawSink } from './draw/DrawSink';
import { MARK_HEIGHT, MARK_WIDTH, type LinkGeometry } from './LinkGeometry';

const MARK_NOTCH = 3.5;
const MARK_ALPHA = 0.85;
/** The dots under linked ink, in page px. */
const DOT_SIZE = 1.5;
const DOT_STEP = 4.5;
const DOT_GAP = 2.5;

/**
 * Draws what shows that ink is a link, in every output (a vector PDF also makes it clickable), and
 * the bookmark markers, which only the screen has.
 */
export class LinkMarkPainter {
  constructor(
    private readonly geometry: LinkGeometry,
    private readonly isBroken: (link: LinkTarget) => boolean,
    private readonly markersOn: () => boolean,
  ) {}

  /** A dotted line under each ink link; items being dragged or edited are not on the page for now. */
  emitInkLinks<P extends PathSink>(sink: DrawSink<P>, page: Page, skip: ReadonlySet<string> | null): void {
    for (const link of page.inkLinks) {
      if (skip && link.items.some((id) => skip.has(id))) continue;
      const box = this.geometry.inkBox(page, link);
      const broken = this.isBroken(link.link);
      const color = broken ? PAPER.linkBroken : PAPER.link;
      const y = box.y1 + DOT_GAP;
      // A dash where a working link has dots: colour alone must not be the only difference.
      const size = broken ? DOT_STEP / 2 + DOT_SIZE : DOT_SIZE;
      for (let x = box.x0; x < box.x1; x += DOT_STEP * (broken ? 2 : 1)) {
        sink.fillRect(x, y, Math.min(size, box.x1 - x), DOT_SIZE, color);
      }
      if (!broken) sink.link?.(box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0, link.link);
    }
  }

  /** A small bookmark at the left edge of each anchor. */
  emitMarkers<P extends PathSink>(sink: DrawSink<P>, page: Page, skip: ReadonlySet<string> | null): void {
    if (!this.markersOn()) return;
    for (const anchor of page.anchors) {
      if (skip && anchor.items.some((id) => skip.has(id))) continue;
      const box = this.geometry.markerBox(page, anchor);
      LinkMarkPainter.mark(sink, box.x0, box.y0);
    }
  }

  private static mark<P extends PathSink>(sink: DrawSink<P>, x: number, y: number): void {
    const path = sink.newPath();
    path.moveTo(x, y);
    path.lineTo(x + MARK_WIDTH, y);
    path.lineTo(x + MARK_WIDTH, y + MARK_HEIGHT);
    path.lineTo(x + MARK_WIDTH / 2, y + MARK_HEIGHT - MARK_NOTCH);
    path.lineTo(x, y + MARK_HEIGHT);
    path.closePath();
    sink.fillPath(path, { color: PAPER.anchorMark, alpha: MARK_ALPHA });
  }
}
