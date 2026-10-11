import type { ToolKind } from '../core/types';

export interface ShortcutHandlers {
  /** Shortcuts apply only while this returns true (the editor is open). */
  enabled(): boolean;
  undo(): void;
  redo(): void;
  /** Delete/Backspace; returns false if there was nothing selected to delete. */
  deleteSelection(): boolean;
  escape(): void;
  setTool(kind: ToolKind): void;
}

const TOOL_KEYS: Record<string, ToolKind> = { p: 'pen', h: 'hl', e: 'eraser', l: 'lasso', t: 'text' };

/** Editor keyboard shortcuts: Ctrl/⌘+Z, Ctrl/⌘+Y or Shift+Z, Delete, Escape, P/H/E/L/T. */
export class KeyboardShortcuts {
  private readonly listener = (e: KeyboardEvent): void => this.handle(e);

  constructor(
    private readonly handlers: ShortcutHandlers,
    private readonly target: Document = document,
  ) {
    target.addEventListener('keydown', this.listener);
  }

  destroy(): void {
    this.target.removeEventListener('keydown', this.listener);
  }

  private handle(e: KeyboardEvent): void {
    const h = this.handlers;
    if (!h.enabled()) return;
    const active = this.target.activeElement;
    if (active && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)) return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (mod && key === 'z' && !e.shiftKey) {
      e.preventDefault();
      h.undo();
    } else if (mod && (key === 'y' || (key === 'z' && e.shiftKey))) {
      e.preventDefault();
      h.redo();
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      if (h.deleteSelection()) e.preventDefault();
    } else if (e.key === 'Escape') {
      h.escape();
    } else if (!mod) {
      const tool = TOOL_KEYS[e.key];
      if (tool) h.setTool(tool);
    }
  }
}
