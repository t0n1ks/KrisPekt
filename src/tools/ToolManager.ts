import type { LiveLayer, OverlayPainter } from '../canvas/LiveLayer';
import type { Point, Preferences, ToolKind } from '../core/types';
import type { DrawingTarget } from '../input/InputRouter';
import type { Tool } from './Tool';

/**
 * Holds the tools and forwards input to the active one. Implements the drawing side of the
 * input router, so routing code never needs to know which tool is selected.
 */
export class ToolManager implements DrawingTarget, OverlayPainter {
  private readonly tools: Map<ToolKind, Tool>;
  private active: Tool;

  constructor(
    tools: readonly Tool[],
    private readonly prefs: () => Preferences,
    private readonly onChange: (tool: Tool) => void,
  ) {
    this.tools = new Map(tools.map((t) => [t.kind, t]));
    const first = tools[0];
    if (!first) throw new Error('No tools');
    this.active = first;
  }

  get current(): Tool {
    return this.active;
  }

  get kind(): ToolKind {
    return this.active.kind;
  }

  /** Activates a tool (cancelling any operation of the previous one). */
  select(kind: ToolKind): void {
    const tool = this.tools.get(kind);
    if (!tool) return;
    if (this.active.activePointer !== null) this.active.onPointerCancel();
    this.active = tool;
    this.onChange(tool);
  }

  get activePointer(): number | null {
    return this.active.activePointer;
  }

  get activeByTouch(): boolean {
    return this.active.activeByTouch;
  }

  /** Fingers draw when finger drawing is on, or where the tool itself wants touch (selection drag). */
  acceptsTouchAt(pt: Point): boolean {
    return this.prefs().fingerDraw || this.active.acceptsTouchAt(pt);
  }

  begin(e: PointerEvent, pt: Point): void {
    this.active.onPointerDown(e, pt);
  }

  move(e: PointerEvent): void {
    this.active.onPointerMove(e);
  }

  end(e: PointerEvent): void {
    this.active.onPointerUp(e);
  }

  cancel(): void {
    this.active.onPointerCancel();
  }

  interrupt(): void {
    this.active.onInterrupt();
  }

  tap(pt: Point): void {
    this.active.onTap(pt);
  }

  renderOverlay(ctx: CanvasRenderingContext2D, live: LiveLayer): void {
    this.active.renderOverlay(ctx, live);
  }
}
