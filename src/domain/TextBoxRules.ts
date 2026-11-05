import { TEXT_LINE_HEIGHT } from '../core/constants';
import { clamp } from '../core/utils/math';

export interface BoxGeometry {
  x: number;
  y: number;
  w: number;
}

/** Page size in world px. */
export interface PageBounds {
  width: number;
  height: number;
}

export type ResizeSide = 'left' | 'right';

/** Text never goes closer than this to the page's right edge while a box grows by itself. */
export const TEXT_PAGE_MARGIN = 12;
/** The narrowest box a user can make. */
export const TEXT_MIN_WIDTH = 28;
/** A new box is this many font sizes wide: a few characters. */
const NEW_BOX_EM = 3;
/** Room for the caret at the end of a line. */
const CARET_ROOM = 2;

/** Where text boxes may be and how wide they get. Pure, so it can be unit tested. */
export class TextBoxRules {
  /** A new box for a tap at page point (x, y): one small line around the tap, inside the page. */
  static placeNew(x: number, y: number, fs: number, page: PageBounds): BoxGeometry {
    const w = Math.min(Math.max(fs * NEW_BOX_EM, TEXT_MIN_WIDTH), page.width);
    const lineHeight = fs * TEXT_LINE_HEIGHT;
    return {
      x: clamp(x, 0, Math.max(0, page.width - TEXT_PAGE_MARGIN - w)),
      y: clamp(y - lineHeight / 2, 0, Math.max(0, page.height - lineHeight)),
      w,
    };
  }

  /** Auto-width: as wide as the text needs, up to the right page margin (then the text wraps). */
  static autoWidth(natural: number, x: number, fs: number, page: PageBounds): number {
    const widest = Math.max(TEXT_MIN_WIDTH, page.width - TEXT_PAGE_MARGIN - x);
    const empty = Math.max(fs * NEW_BOX_EM, TEXT_MIN_WIDTH);
    return Math.min(widest, Math.max(empty, Math.ceil(natural) + CARET_ROOM));
  }

  /** The box after dragging one side by `dx`. The other side stays where it is. */
  static resized(start: BoxGeometry, side: ResizeSide, dx: number, page: PageBounds): BoxGeometry {
    if (side === 'right') {
      return {
        ...start,
        w: clamp(start.w + dx, TEXT_MIN_WIDTH, Math.max(TEXT_MIN_WIDTH, page.width - start.x)),
      };
    }
    const right = start.x + start.w;
    const x = clamp(start.x + dx, 0, Math.max(0, right - TEXT_MIN_WIDTH));
    return { ...start, x, w: right - x };
  }

  /** The nearest position with the whole box inside the page; a box too tall stays at the top. */
  static keptInside(box: BoxGeometry, height: number, page: PageBounds): BoxGeometry {
    const w = Math.min(box.w, page.width);
    return {
      w,
      x: clamp(box.x, 0, Math.max(0, page.width - w)),
      y: clamp(box.y, 0, Math.max(0, page.height - height)),
    };
  }
}
