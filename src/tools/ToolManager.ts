import type { LiveLayer, OverlayPainter } from '../canvas/LiveLayer';
import type { Point, Preferences, ToolKind } from '../core/types';
import { EraserModes } from '../domain/EraserModes';
import type { DrawingTarget } from '../input/InputRouter';
import type { Tool } from './Tool';

/**
 * Holds the tools and forwards input to the active one. Implements the drawing side of the
 * input router, so routing code never needs to know which tool is selected.
 *
 * A stylus pressed with its eraser end or eraser button erases (in the current eraser mode)
 * for that one operation, whatever tool is selected.
 */
export class ToolManager implements DrawingTarget, OverlayPainter {
  private readonly tools: Map<ToolKind, Tool>;
  private active: Tool;
  /** The tool running the operation in progress when it is not the selected one. */
  private temporary: Tool | null = null;

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
    if (this.operating.activePointer !== null) this.operating.onPointerCancel();
    this.temporary = null;
    this.active = tool;
    this.onChange(tool);
  }

  /** The tool that receives pointer events of the operation in progress. */
  private get operating(): Tool {
    return this.temporary ?? this.active;
  }

  get activePointer(): number | null {
    return this.operating.activePointer;
  }

  get activeByTouch(): boolean {
    return this.operating.activeByTouch;
  }

  /** Fingers draw when finger drawing is on, or where the tool itself wants touch (selection drag). */
  acceptsTouchAt(pt: Point): boolean {
    return this.prefs().fingerDraw || this.active.acceptsTouchAt(pt);
  }

  begin(e: PointerEvent, pt: Point): void {
    const eraser = this.tools.get('eraser');
    this.temporary = EraserModes.isStylusEraser(e) && eraser && eraser !== this.active ? eraser : null;
    this.operating.onPointerDown(e, pt);
    if (this.temporary && this.temporary.activePointer === null) this.temporary = null;
  }

  move(e: PointerEvent): void {
    this.operating.onPointerMove(e);
  }

  end(e: PointerEvent): void {
    this.operating.onPointerUp(e);
    this.temporary = null;
  }

  cancel(): void {
    this.operating.onPointerCancel();
    this.temporary = null;
  }

  interrupt(): void {
    this.operating.onInterrupt();
    if (this.temporary?.activePointer === null) this.temporary = null;
  }

  tap(pt: Point): void {
    this.active.onTap(pt);
  }

  renderOverlay(ctx: CanvasRenderingContext2D, live: LiveLayer): void {
    this.operating.renderOverlay(ctx, live);
  }
}
