import { MM } from '../core/constants';
import type { Box, ImageItem, Page, Stroke, TextItem } from '../core/types';
import { ItemTransform, type PageItems } from './ItemTransform';
import { SelectionPlacement } from './SelectionPlacement';

/** Bounding boxes of items in page px (strokes and texts need the editor's geometry). */
export interface ItemBoxes {
  stroke(stroke: Stroke): Box;
  text(text: TextItem): Box;
}

/**
 * Brings back items that lie completely outside their page. Older versions could leave a
 * selection dragged onto another page in its source page, beyond the edge, where the page clip
 * hid it. Such an item is shifted (not scaled) to the nearest position inside the page; items
 * that are only partly outside are left as they are.
 */
export class PageRepair {
  /** Repairs a page in place; returns how many items were moved. */
  static repair(page: Page, boxes: ItemBoxes): number {
    const pageW = page.w * MM;
    const pageH = page.h * MM;
    const lost = (box: Box): boolean => box.x1 <= 0 || box.y1 <= 0 || box.x0 >= pageW || box.y0 >= pageH;
    let moved = 0;
    const fix = <T>(
      item: T,
      box: Box,
      wrap: (x: T) => PageItems,
      unwrap: (v: PageItems) => T | undefined,
    ): T => {
      if (!lost(box)) return item;
      const shift = SelectionPlacement.clampShift(
        { x: box.x0, y: box.y0, w: box.x1 - box.x0, h: box.y1 - box.y0 },
        pageW,
        pageH,
      );
      moved++;
      return unwrap(ItemTransform.map(wrap(item), ItemTransform.translation(shift.x, shift.y))) ?? item;
    };
    page.strokes = page.strokes.map((s) => fix(s, boxes.stroke(s), PageRepair.ofStroke, (v) => v.strokes[0]));
    page.texts = page.texts.map((t) => fix(t, boxes.text(t), PageRepair.ofText, (v) => v.texts[0]));
    page.images = page.images.map((im) =>
      fix(im, PageRepair.imageBox(im), PageRepair.ofImage, (v) => v.images[0]),
    );
    return moved;
  }

  private static imageBox(im: ImageItem): Box {
    return { x0: im.x, y0: im.y, x1: im.x + im.w, y1: im.y + im.h };
  }

  private static ofStroke(stroke: Stroke): PageItems {
    return { strokes: [stroke], texts: [], images: [] };
  }

  private static ofText(text: TextItem): PageItems {
    return { strokes: [], texts: [text], images: [] };
  }

  private static ofImage(image: ImageItem): PageItems {
    return { strokes: [], texts: [], images: [image] };
  }
}
