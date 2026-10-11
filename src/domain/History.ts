import { UNDO_LIMIT } from '../core/constants';
import type { Background, ImageItem, Page, Stroke, TextItem } from '../core/types';

/**
 * State of one page before a change. Item arrays are copied shallowly: items are never
 * mutated in place (edits replace them), so sharing them between snapshots is safe.
 */
export interface PageSnapshot {
  id: string;
  strokes: Stroke[];
  texts: TextItem[];
  images: ImageItem[];
  w: number;
  h: number;
  locked: boolean;
  bg: Background;
}

/** Undo/redo stacks of page snapshots (max 150 undo steps). */
export class History {
  private undoStack: PageSnapshot[] = [];
  private redoStack: PageSnapshot[] = [];

  constructor(private readonly limit = UNDO_LIMIT) {}

  static snapshot(page: Page): PageSnapshot {
    return {
      id: page.id,
      strokes: page.strokes.slice(),
      texts: page.texts.slice(),
      images: page.images.slice(),
      w: page.w,
      h: page.h,
      locked: page.locked,
      bg: page.bg,
    };
  }

  /** Writes a snapshot back into a page. Returns true if the page size changed. */
  static apply(page: Page, snap: PageSnapshot): boolean {
    const resized = page.w !== snap.w || page.h !== snap.h;
    page.strokes = snap.strokes;
    page.texts = snap.texts;
    page.images = snap.images;
    page.w = snap.w;
    page.h = snap.h;
    page.locked = snap.locked;
    page.bg = snap.bg;
    return resized;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Records the page's state before a change. Clears the redo stack. */
  record(page: Page): void {
    this.undoStack.push(History.snapshot(page));
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  /**
   * Steps back. `find` resolves page ids; entries for deleted pages are skipped.
   * Returns the page that was restored, or null if there is nothing to undo.
   */
  undo(find: (id: string) => Page | undefined): { page: Page; resized: boolean } | null {
    return this.step(this.undoStack, this.redoStack, find);
  }

  /** Steps forward again (see {@link undo}). */
  redo(find: (id: string) => Page | undefined): { page: Page; resized: boolean } | null {
    return this.step(this.redoStack, this.undoStack, find);
  }

  /** Forgets every entry of a deleted page. */
  dropPage(id: string): void {
    this.undoStack = this.undoStack.filter((e) => e.id !== id);
    this.redoStack = this.redoStack.filter((e) => e.id !== id);
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }

  private step(
    from: PageSnapshot[],
    to: PageSnapshot[],
    find: (id: string) => Page | undefined,
  ): { page: Page; resized: boolean } | null {
    let entry: PageSnapshot | undefined;
    let page: Page | undefined;
    while ((entry = from.pop())) {
      page = find(entry.id);
      if (page) break;
    }
    if (!entry || !page) return null;
    to.push(History.snapshot(page));
    return { page, resized: History.apply(page, entry) };
  }
}
