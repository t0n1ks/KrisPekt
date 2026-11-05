import type { Point } from '../core/types';

/** Where the thumbnails of a grid with equal cells sit, in the list's content coordinates. */
export interface PageGridShape {
  originX: number;
  originY: number;
  stepX: number;
  stepY: number;
  columns: number;
  count: number;
}

/** Geometry of the page organizer's grid, used to find where a dragged thumbnail would land. */
export class PageGrid {
  /** The gap nearest to a point; gap `g` lies just before cell `g`, gap `count` after the last. */
  static gapAt(grid: PageGridShape, x: number, y: number): number {
    const row = Math.max(0, Math.floor((y - grid.originY) / grid.stepY));
    const column = Math.floor((x - grid.originX) / grid.stepX + 0.5);
    const clamped = Math.min(Math.max(column, 0), grid.columns);
    return Math.min(row * grid.columns + clamped, grid.count);
  }

  /** Top-left corner of the cell after a gap, or the place just past the last cell. */
  static gapPosition(grid: PageGridShape, gap: number): Point {
    const atEndOfRow = gap === grid.count && gap > 0 && gap % grid.columns === 0;
    const row = Math.floor((atEndOfRow ? gap - 1 : gap) / grid.columns);
    const column = atEndOfRow ? grid.columns : gap % grid.columns;
    return { x: grid.originX + column * grid.stepX, y: grid.originY + row * grid.stepY };
  }
}
