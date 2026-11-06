import type { ToolKind } from '../core/types';

/**
 * Who opens what. A tool that writes only ever writes: links, cards and bookmark markers open with
 * the Hand, whatever the pointer, or with a finger that is not drawing.
 *
 * With any other tool a finger that does not draw is not using that tool, so the lasso and the
 * eraser follow the same rule as the pen.
 */
export class ToolRules {
  /** Whether a press with this tool and pointer opens what it lands on, rather than using the tool. */
  static opensTargets(tool: ToolKind, pointerType: string, fingerDraws: boolean): boolean {
    if (tool === 'hand') return true;
    return pointerType === 'touch' && !fingerDraws;
  }

  /** Whether a tool leaves marks, so that a tap with it on a link can be a mistake worth a tip. */
  static writes(tool: ToolKind): boolean {
    return tool === 'pen' || tool === 'hl';
  }

  /** Whether a selection stays while this tool is in use. */
  static keepsSelection(tool: ToolKind): boolean {
    return tool === 'lasso' || tool === 'hand';
  }
}
