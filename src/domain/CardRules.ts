import { CARD_HEIGHT, CARD_MARGIN, CARD_MENU_ZONE, CARD_MIN_WIDTH } from '../core/constants';
import type { Box, CardItem, CardKind } from '../core/types';
import { clamp } from '../core/utils/math';

/** Where a card goes, in page px. */
export interface CardPlace {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Pure rules of attachment cards on a page. */
export class CardRules {
  /** A new card spans the page's content width, centred vertically on a tap, kept on the page. */
  static place(kind: CardKind, pageWidth: number, pageHeight: number, tapY: number): CardPlace {
    const h = CARD_HEIGHT[kind];
    const w = Math.min(pageWidth, Math.max(CARD_MIN_WIDTH, pageWidth - CARD_MARGIN * 2));
    return {
      x: (pageWidth - w) / 2,
      y: clamp(tapY - h / 2, 0, Math.max(0, pageHeight - h)),
      w,
      h,
    };
  }

  /** A width the handle may set: not too narrow to read, and no wider than the page. */
  static clampWidth(width: number, pageWidth: number): number {
    return clamp(width, Math.min(CARD_MIN_WIDTH, pageWidth), pageWidth);
  }

  /** The stored blobs a card needs. */
  static blobIds(card: CardItem): string[] {
    if (card.kind !== 'pdf') return [];
    return card.thumb ? [card.blob, card.thumb] : [card.blob];
  }

  /** The card's rectangle. */
  static box(card: CardItem): Box {
    return { x0: card.x, y0: card.y, x1: card.x + card.w, y1: card.y + card.h };
  }

  /** Whether a page point is on the card. */
  static contains(card: CardItem, x: number, y: number): boolean {
    return x >= card.x && x <= card.x + card.w && y >= card.y && y <= card.y + card.h;
  }

  /** Whether a page point is on the card's ⋮ button at its right end. */
  static inMenuZone(card: CardItem, x: number, y: number): boolean {
    return CardRules.contains(card, x, y) && x >= card.x + card.w - card.h * CARD_MENU_ZONE;
  }
}
