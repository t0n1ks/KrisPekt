import { clamp } from '../core/utils/math';

/** What is left of the screen, in client px. */
export interface ViewBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface AnchorBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface MenuPlace {
  x: number;
  y: number;
}

/** A menu keeps this far from the edges of the screen. */
const MARGIN = 8;
/** And this far from the button it belongs to. */
const GAP = 6;
/** Below this width a large menu is a bottom sheet instead of hanging from its button. */
const SHEET_WIDTH = 480;
/** "Large": it would take more than this share of the screen's height. */
const SHEET_SHARE = 0.6;

/** Where a menu goes so that all of it stays on the screen. Pure. */
export class PopoverPlacement {
  /** The tallest a menu may be; a longer one scrolls inside. */
  static maxHeight(view: ViewBox): number {
    return Math.max(0, view.height - MARGIN * 2);
  }

  /**
   * Right-aligned with its button and below it. It flips above if it does not fit there and there
   * is more room above, and shifts along the screen for whatever still sticks out.
   */
  static anchored(anchor: AnchorBox, size: { w: number; h: number }, view: ViewBox): MenuPlace {
    const right = view.left + view.width - MARGIN;
    const bottom = view.top + view.height - MARGIN;
    const x = clamp(anchor.right - size.w, view.left + MARGIN, Math.max(view.left + MARGIN, right - size.w));
    const roomBelow = bottom - anchor.bottom - GAP;
    const roomAbove = anchor.top - GAP - view.top - MARGIN;
    const wanted =
      size.h <= roomBelow || roomBelow >= roomAbove ? anchor.bottom + GAP : anchor.top - GAP - size.h;
    return { x, y: clamp(wanted, view.top + MARGIN, Math.max(view.top + MARGIN, bottom - size.h)) };
  }

  /** Whether a menu of this height is a bottom sheet on this screen. */
  static isSheet(height: number, view: ViewBox, content: boolean): boolean {
    return view.width < SHEET_WIDTH && (content || height > view.height * SHEET_SHARE);
  }

  /** A bottom sheet of this height: along the bottom edge of what is left of the screen. */
  static sheet(height: number, view: ViewBox): MenuPlace {
    return { x: view.left, y: view.top + Math.max(0, view.height - height) };
  }
}
