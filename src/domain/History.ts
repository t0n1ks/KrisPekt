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

/**
 * One undo step: the pages a change touched, as they were before it. Most changes touch one
 * page; moving a selection onto another page touches two, which are restored together.
 */
export type HistoryEntry = PageSnapshot[];

/** The pages an undo/redo step restored, and whether any of them changed size. */
export interface HistoryStep {
  pages: Page[];
  resized: boolean;
}

/** Undo/redo stacks of page snapshots (max 150 undo steps). */
export class History {
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];

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

  /** Records the pages' state before a change, as one undo step. Clears the redo stack. */
  record(...pages: Page[]): void {
    if (!pages.length) return;
    this.undoStack.push(pages.map(History.snapshot));
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  /**
   * Steps back. `find` resolves page ids; snapshots of deleted pages are skipped, and an
   * entry whose pages are all gone is dropped. Returns null if there is nothing to undo.
   */
  undo(find: (id: string) => Page | undefined): HistoryStep | null {
    return this.step(this.undoStack, this.redoStack, find);
  }

  /** Steps forward again (see {@link undo}). */
  redo(find: (id: string) => Page | undefined): HistoryStep | null {
    return this.step(this.redoStack, this.undoStack, find);
  }

  /** Forgets every snapshot of a deleted page. */
  dropPage(id: string): void {
    const drop = (stack: HistoryEntry[]): HistoryEntry[] =>
      stack.map((entry) => entry.filter((snap) => snap.id !== id)).filter((entry) => entry.length > 0);
    this.undoStack = drop(this.undoStack);
    this.redoStack = drop(this.redoStack);
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }

  /** Restores every page of the newest entry that still exists, atomically. */
  private step(
    from: HistoryEntry[],
    to: HistoryEntry[],
    find: (id: string) => Page | undefined,
  ): HistoryStep | null {
    let entry: HistoryEntry | undefined;
    while ((entry = from.pop())) {
      const found = entry
        .map((snap) => ({ snap, page: find(snap.id) }))
        .filter((x): x is { snap: PageSnapshot; page: Page } => !!x.page);
      if (!found.length) continue;
      to.push(found.map((x) => History.snapshot(x.page)));
      let resized = false;
      for (const { page, snap } of found) resized = History.apply(page, snap) || resized;
      return { pages: found.map((x) => x.page), resized };
    }
    return null;
  }
}
