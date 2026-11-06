import type { ToolKind } from '../core/types';

/** The two tools that share one toolbar button. */
export type SharedTool = 'lasso' | 'hand';

/** Pure rules of the toolbar button shared by the lasso and the Hand. */
export class LassoHandToggle {
  /** Whether a tool is one of the two. */
  static isShared(tool: ToolKind): tool is SharedTool {
    return tool === 'lasso' || tool === 'hand';
  }

  /** Which of the two the button shows: the one in use, or else the one used last. */
  static shown(active: ToolKind | null, last: SharedTool | undefined): SharedTool {
    if (active && LassoHandToggle.isShared(active)) return active;
    return last ?? 'lasso';
  }

  /** The tool after a tap: one of the two in use gives way to the other. */
  static afterTap(active: ToolKind | null, last: SharedTool | undefined): SharedTool {
    if (active === 'lasso') return 'hand';
    if (active === 'hand') return 'lasso';
    return last ?? 'lasso';
  }
}
