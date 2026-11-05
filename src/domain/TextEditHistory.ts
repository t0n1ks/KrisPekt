/** Typing within this time of the last change belongs to the same undo step. */
const TYPING_GROUP_MS = 1000;

export type TextEditKind = 'typing' | 'other';

/**
 * Undo steps inside one text editing session. Each step stores the state before a change. Typing
 * is grouped: a step ends after a pause and after a word, so undo takes back a word or a burst,
 * not one character. Anything else (formatting, resizing, pasting) is a step of its own.
 */
export class TextEditHistory<State> {
  private readonly undoStack: State[] = [];
  private redoStack: State[] = [];
  private lastKind: TextEditKind | null = null;
  private lastAt = 0;
  private wordEnded = false;

  /**
   * Call with the state before a change.
   * @param endsWord the typed text ended a word, so the next keystroke starts a new step
   */
  record(before: State, kind: TextEditKind, now: number, endsWord = false): void {
    const grouped =
      kind === 'typing' &&
      this.lastKind === 'typing' &&
      !this.wordEnded &&
      now - this.lastAt < TYPING_GROUP_MS;
    if (!grouped) this.undoStack.push(before);
    this.redoStack = [];
    this.lastKind = kind;
    this.lastAt = now;
    this.wordEnded = endsWord;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** The state to go back to, given the one now; null if there is none. */
  undo(current: State): State | null {
    const state = this.undoStack.pop();
    if (state === undefined) return null;
    this.redoStack.push(current);
    this.lastKind = null;
    return state;
  }

  /** The state to go forward to, given the one now; null if there is none. */
  redo(current: State): State | null {
    const state = this.redoStack.pop();
    if (state === undefined) return null;
    this.undoStack.push(current);
    this.lastKind = null;
    return state;
  }
}
