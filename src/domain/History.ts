import { UNDO_LIMIT } from '../core/constants';
import type { Anchor, Background, CardItem, ImageItem, InkLink, Page, Stroke, TextItem } from '../core/types';
import { CardRules } from './CardRules';

/**
 * State of one page before a change. Item arrays are copied shallowly: items are never
 * mutated in place (edits replace them), so sharing them between snapshots is safe.
 */
export interface PageSnapshot {
  id: string;
  title?: string | undefined;
  strokes: Stroke[];
  texts: TextItem[];
  images: ImageItem[];
  cards: CardItem[];
  anchors: Anchor[];
  inkLinks: InkLink[];
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

/** A notebook's steps while another notebook is open. */
interface ParkedSteps {
  undo: HistoryEntry[];
  redo: HistoryEntry[];
}

/**
 * Undo/redo stacks of page snapshots (max 150 undo steps). Following a link to another notebook and
 * coming back keeps each notebook's steps; leaving for the shelf ends them ({@link clear}).
 */
export class History {
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private owner: string | null = null;
  private readonly parked = new Map<string, ParkedSteps>();

  constructor(private readonly limit = UNDO_LIMIT) {}

  static snapshot(page: Page): PageSnapshot {
    return {
      id: page.id,
      strokes: page.strokes.slice(),
      texts: page.texts.slice(),
      images: page.images.slice(),
      cards: page.cards.slice(),
      title: page.title,
      anchors: page.anchors.slice(),
      inkLinks: page.inkLinks.slice(),
      w: page.w,
      h: page.h,
      locked: page.locked,
      bg: page.bg,
    };
  }

  /** Writes a snapshot back into a page. Returns true if the page size changed. */
  static apply(page: Page, snap: PageSnapshot): boolean {
    const resized = page.w !== snap.w || page.h !== snap.h;
    if (snap.title) page.title = snap.title;
    else delete page.title;
    page.strokes = snap.strokes;
    page.texts = snap.texts;
    page.images = snap.images;
    page.cards = snap.cards;
    page.anchors = snap.anchors;
    page.inkLinks = snap.inkLinks;
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

  /**
   * Forgets every step that involves a deleted page. The whole step goes: half of one (a
   * selection moved between two pages, say) would take items away and put them nowhere.
   */
  dropPage(id: string): void {
    const drop = (stack: HistoryEntry[]): HistoryEntry[] =>
      stack.filter((entry) => !entry.some((snap) => snap.id === id));
    this.undoStack = drop(this.undoStack);
    this.redoStack = drop(this.redoStack);
  }

  /** Switches to a notebook's steps, keeping the current ones for when it comes back. */
  use(notebookId: string): void {
    if (this.owner === notebookId) return;
    if (this.owner !== null) this.parked.set(this.owner, { undo: this.undoStack, redo: this.redoStack });
    const steps = this.parked.get(notebookId);
    this.parked.delete(notebookId);
    this.undoStack = steps?.undo ?? [];
    this.redoStack = steps?.redo ?? [];
    this.owner = notebookId;
  }

  /** Ids of every blob the steps could bring back; these must stay stored. */
  blobIds(): Set<string> {
    const ids = new Set<string>();
    const parked = [...this.parked.values()].flatMap((steps) => [...steps.undo, ...steps.redo]);
    for (const entry of [...this.undoStack, ...this.redoStack, ...parked]) {
      for (const snap of entry) {
        for (const image of snap.images) ids.add(image.blob);
        for (const card of snap.cards) for (const id of CardRules.blobIds(card)) ids.add(id);
      }
    }
    return ids;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.owner = null;
    this.parked.clear();
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
