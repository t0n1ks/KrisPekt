import type { LiveLayer, OverlayPainter } from '../canvas/LiveLayer';
import type { Point, ToolKind } from '../core/types';
import type { ToolContext } from './ToolContext';

/**
 * Base class of editor tools. The tool manager forwards pointer events of the operation in
 * progress; a tool calls {@link startOperation} when it accepts a pointer-down and
 * {@link endOperation} when the operation is over.
 */
export abstract class Tool implements OverlayPainter {
  abstract readonly kind: ToolKind;
  private pointerId: number | null = null;
  private touchStarted = false;

  constructor(protected readonly ctx: ToolContext) {}

  /** Pointer of the operation in progress, or null. */
  get activePointer(): number | null {
    return this.pointerId;
  }

  /** Whether the operation in progress was started by a finger. */
  get activeByTouch(): boolean {
    return this.touchStarted;
  }

  /** CSS modifier class for the canvas cursor, if the tool wants one. */
  get cursorClass(): string | null {
    return null;
  }

  /** Whether a finger here should use this tool even when finger drawing is off. */
  acceptsTouchAt(_pt: Point): boolean {
    return false;
  }

  /** Pointer went down on the stage at a stage-local point. */
  abstract onPointerDown(e: PointerEvent, pt: Point): void;

  /** The pointer of the active operation moved. */
  onPointerMove(_e: PointerEvent): void {
    /* optional */
  }

  /** The pointer of the active operation lifted. */
  onPointerUp(_e: PointerEvent): void {
    this.endOperation();
  }

  /** The operation must be abandoned (pen took over, pointer cancelled). */
  onPointerCancel(): void {
    this.endOperation();
  }

  /** A second finger landed during a finger operation: by default the operation is cancelled. */
  onInterrupt(): void {
    this.onPointerCancel();
  }

  /** A short single-finger tap that the gesture controller did not treat as a pan. */
  onTap(_pt: Point): void {
    /* optional */
  }

  /** Draws transient feedback on the live layer. */
  renderOverlay(_ctx: CanvasRenderingContext2D, _live: LiveLayer): void {
    /* optional */
  }

  /**
   * The tray button of this tool was tapped while the tool is already active. Returns true if
   * the tool handled it (the eraser switches modes); otherwise the options popover opens.
   */
  onActiveTap(): boolean {
    return false;
  }

  /** Contents of the options popover shown when the active tool is tapped again. */
  abstract createOptionsPanel(): HTMLElement;

  protected startOperation(e: PointerEvent): void {
    this.pointerId = e.pointerId;
    this.touchStarted = e.pointerType === 'touch';
  }

  protected endOperation(): void {
    this.pointerId = null;
    this.touchStarted = false;
  }
}
