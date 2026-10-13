import type { Point } from '../core/types';

/** An axis-aligned rectangle given by its top-left corner and size. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Where a dropped selection goes: which page receives it, and the shift that keeps it on that
 * page. Pure geometry, so it can be unit tested.
 */
export class SelectionPlacement {
  /**
   * Index of the page that receives a selection whose centre is at `center` (world px): the page
   * containing the point, otherwise the nearest one (the centre fell into a gap or off the stack).
   * Returns -1 only when there are no pages.
   */
  static targetIndex(pages: readonly Rect[], center: Point): number {
    let best = -1;
    let bestDistance = Infinity;
    pages.forEach((r, i) => {
      const dx = Math.max(r.x - center.x, 0, center.x - (r.x + r.w));
      const dy = Math.max(r.y - center.y, 0, center.y - (r.y + r.h));
      const distance = Math.hypot(dx, dy);
      if (distance < bestDistance) {
        best = i;
        bestDistance = distance;
      }
    });
    return best;
  }

  /**
   * The shift that moves `box` (page px) inside a page of `pageW` × `pageH`. The group is only
   * shifted, never scaled; one that is larger than the page is aligned to its top-left corner.
   */
  static clampShift(box: Rect, pageW: number, pageH: number): Point {
    return {
      x: SelectionPlacement.axisShift(box.x, box.w, pageW),
      y: SelectionPlacement.axisShift(box.y, box.h, pageH),
    };
  }

  private static axisShift(start: number, size: number, limit: number): number {
    if (size >= limit || start < 0) return -start;
    if (start + size > limit) return limit - (start + size);
    return 0;
  }
}
