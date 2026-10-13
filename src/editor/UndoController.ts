import type { Page } from '../core/types';
import type { History } from '../domain/History';
import type { EditorSession } from './EditorSession';

export interface UndoControllerDeps {
  history: History;
  session: EditorSession;
  /** Finishes text editing and drops the selection before a step. */
  beforeStep: () => void;
  /** Pages were restored from history (one step may restore several). */
  onRestored: (pages: Page[], resized: boolean) => void;
  /** Undo/redo availability changed (toolbar buttons). */
  onStateChange: (canUndo: boolean, canRedo: boolean) => void;
}

/** Applies undo/redo to the open notebook and keeps the toolbar buttons in sync. */
export class UndoController {
  constructor(private readonly deps: UndoControllerDeps) {}

  /** Records pages before they change, as one undo step. */
  record(...pages: Page[]): void {
    this.deps.history.record(...pages);
    this.notify();
  }

  /** Undoes the last change; returns false if there was nothing to undo. */
  undo(): boolean {
    return this.step('undo');
  }

  redo(): boolean {
    return this.step('redo');
  }

  /** Forgets a deleted page's history. */
  dropPage(id: string): void {
    this.deps.history.dropPage(id);
    this.notify();
  }

  clear(): void {
    this.deps.history.clear();
    this.notify();
  }

  notify(): void {
    this.deps.onStateChange(this.deps.history.canUndo, this.deps.history.canRedo);
  }

  private step(direction: 'undo' | 'redo'): boolean {
    this.deps.beforeStep();
    const find = (id: string): Page | undefined => this.deps.session.find(id);
    const result = direction === 'undo' ? this.deps.history.undo(find) : this.deps.history.redo(find);
    if (result) {
      for (const page of result.pages) this.deps.session.touch(page);
      this.deps.onRestored(result.pages, result.resized);
    }
    this.notify();
    return !!result;
  }
}
