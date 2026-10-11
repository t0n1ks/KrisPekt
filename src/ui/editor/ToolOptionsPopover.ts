import type { EventBus } from '../../app/EventBus';
import type { Camera } from '../../canvas/Camera';
import { el } from '../../core/utils/dom';
import { clamp } from '../../core/utils/math';
import type { Tool } from '../../tools/Tool';

/**
 * The options card of the active tool, opened by tapping the tool again. It is placed under
 * the tray, or above it when the tray sits at the bottom (phones).
 */
export class ToolOptionsPopover {
  private node: HTMLDivElement | null = null;
  private kind: string | null = null;

  constructor(
    private readonly stage: HTMLElement,
    private readonly camera: Camera,
    private readonly trayRect: () => DOMRect,
    bus: EventBus,
  ) {
    bus.on('menu-opened', () => this.close());
  }

  /** Opens the tool's options, or closes them if they are already open. */
  toggle(anchor: HTMLElement, tool: Tool): void {
    if (this.node && this.kind === tool.kind) {
      this.close();
      return;
    }
    this.close();
    const node = el(
      'div',
      { class: 'popover', attrs: { 'data-tool': tool.kind } },
      tool.createOptionsPanel(),
    );
    this.stage.append(node);
    this.node = node;
    this.kind = tool.kind;
    this.place(node, anchor);
  }

  private place(node: HTMLDivElement, anchor: HTMLElement): void {
    const stage = this.stage.getBoundingClientRect();
    const tray = this.trayRect();
    const a = anchor.getBoundingClientRect();
    const w = node.offsetWidth;
    const h = node.offsetHeight;
    const left = clamp(a.left + a.width / 2 - stage.left - w / 2, 12, this.camera.width - w - 12);
    const trayAtBottom = tray.top - stage.top > this.camera.height / 2;
    node.style.left = left + 'px';
    node.style.top = (trayAtBottom ? tray.top - stage.top - h - 10 : tray.bottom - stage.top + 10) + 'px';
  }

  close(): void {
    this.node?.remove();
    this.node = null;
    this.kind = null;
  }
}
