import type { Box } from '../core/types';
import { ItemTransform, type PageItems } from './ItemTransform';

/** Copied items and their bounding box in the page they came from. */
export interface ClipboardContent {
  items: PageItems;
  box: Box;
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
  copy(items: PageItems, box: Box): void {
    this.content = { items, box };
  }

  /** The copied items, moved by (dx, dy) and with fresh ids; null if nothing was copied. */
  pasted(dx: number, dy: number, makeId: () => string): PageItems | null {
    if (!this.content) return null;
    const moved = ItemTransform.map(this.content.items, ItemTransform.translation(dx, dy));
    const fresh = <T extends { id: string }>(item: T): T => ({ ...item, id: makeId() });
    return {
      strokes: moved.strokes.map(fresh),
      texts: moved.texts.map(fresh),
      images: moved.images.map(fresh),
    };
  }

  /** The bounding box of what was copied. */
  get box(): Box | null {
    return this.content?.box ?? null;
  }

  /** Ids of the images held here; these must stay stored. */
  blobIds(): string[] {
    return this.content?.items.images.map((image) => image.blob) ?? [];
  }
}
