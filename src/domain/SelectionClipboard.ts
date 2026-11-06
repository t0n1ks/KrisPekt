import type { Box, InkLink } from '../core/types';
import { CardRules } from './CardRules';
import { ItemBindings } from './ItemBindings';
import { ItemTransform, type PageItems } from './ItemTransform';

/** Copied items and their bounding box in the page they came from. */
export interface ClipboardContent {
  items: PageItems;
  box: Box;
  /** Ink links on the copied items; anchors are one of a kind and are not copied. */
  inkLinks: InkLink[];
}

/** Pasted items with the ink links bound to them. */
export interface PastedContent extends PageItems {
  inkLinks: InkLink[];
}

/**
 * Items copied with the lasso, kept in memory for the session. Items are immutable, so holding
 * on to them is safe; the images they name must stay stored while they are here.
 */
export class SelectionClipboard {
  private content: ClipboardContent | null = null;

  get isEmpty(): boolean {
    return this.content === null;
  }

  /** Remembers a copy of the items. */
  copy(items: PageItems, box: Box, inkLinks: InkLink[] = []): void {
    this.content = { items, box, inkLinks };
  }

  /** The copied items, moved by (dx, dy) and with fresh ids; null if nothing was copied. */
  pasted(dx: number, dy: number, makeId: () => string): PastedContent | null {
    if (!this.content) return null;
    const moved = ItemTransform.map(this.content.items, ItemTransform.translation(dx, dy));
    const copies = new Map<string, string>();
    const fresh = <T extends { id: string }>(item: T): T => {
      const id = makeId();
      copies.set(item.id, id);
      return { ...item, id };
    };
    return {
      strokes: moved.strokes.map(fresh),
      texts: moved.texts.map(fresh),
      images: moved.images.map(fresh),
      cards: moved.cards.map(fresh),
      inkLinks: ItemBindings.copiedInkLinks(this.content.inkLinks, copies, makeId),
    };
  }

  /** The bounding box of what was copied. */
  get box(): Box | null {
    return this.content?.box ?? null;
  }

  /** Ids of the blobs held here; these must stay stored. */
  blobIds(): string[] {
    if (!this.content) return [];
    const { images, cards } = this.content.items;
    return [...images.map((image) => image.blob), ...cards.flatMap((card) => CardRules.blobIds(card))];
  }
}
