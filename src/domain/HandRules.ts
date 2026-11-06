import { HAND_HOLD_MS, TAP_SLOP_PX } from '../core/constants';
import type { Box, CardItem, ImageItem, Page, TextItem } from '../core/types';
import { CardRules } from './CardRules';

/** What a press with the Hand lands on. Ink and PDF page backgrounds count as empty. */
export type HandTarget = 'handle' | 'selection' | 'object' | 'empty';

/** What a press with the Hand starts. `hold`: a finger, which must first stay on the object. */
export type HandPress = 'scale' | 'move' | 'grab' | 'hold' | 'pan';

/** What a tap with the Hand does to the selection. */
export type HandTap = 'select' | 'deselect' | 'keep';

/** What a finger that landed on an object is doing now. */
export type FingerDrag = 'wait' | 'pan' | 'move';

/** An object the Hand can pick up. */
export type HandObject = TextItem | ImageItem | CardItem;

/** Existing text is hit within this many page px of what it shows. */
const TEXT_REACH = 6;

/** Pure rules of the Hand tool: it scrolls and picks up objects, and never draws or erases. */
export class HandRules {
  /**
   * What a press starts. A stylus or a mouse means what it does, so it takes an object at once. A
   * finger is also how the page scrolls, so it has to hold still first. A selection was chosen on
   * purpose, so even a finger takes it at once.
   */
  static press(pointerType: string, target: HandTarget): HandPress {
    if (target === 'handle') return 'scale';
    if (target === 'selection') return 'move';
    if (target === 'empty') return 'pan';
    return pointerType === 'touch' ? 'hold' : 'grab';
  }

  /** A finger that left too soon scrolls, so a quick swipe over a photo moves the page, not the photo. */
  static fingerDrag(heldMs: number, movedPx: number): FingerDrag {
    if (movedPx <= TAP_SLOP_PX) return 'wait';
    return heldMs < HAND_HOLD_MS ? 'pan' : 'move';
  }

  /** What a tap does. */
  static tap(target: HandTarget): HandTap {
    if (target === 'object') return 'select';
    return target === 'empty' ? 'deselect' : 'keep';
  }

  /** The topmost object at a page point: text lies over cards, and cards over photos. */
  static objectAt(
    page: Pick<Page, 'texts' | 'cards' | 'images'>,
    x: number,
    y: number,
    textBox: (item: TextItem) => Box,
  ): HandObject | null {
    const text = [...page.texts].reverse().find((item) => {
      const b = textBox(item);
      const reach = TEXT_REACH;
      return x >= b.x0 - reach && x <= b.x1 + reach && y >= b.y0 - reach && y <= b.y1 + reach;
    });
    if (text) return text;
    const card = [...page.cards].reverse().find((item) => CardRules.contains(item, x, y));
    if (card) return card;
    const inside = (im: ImageItem): boolean => x >= im.x && x <= im.x + im.w && y >= im.y && y <= im.y + im.h;
    return [...page.images].reverse().find(inside) ?? null;
  }
}
