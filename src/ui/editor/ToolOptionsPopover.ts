import type { Camera } from '../../canvas/Camera';
import { el } from '../../core/utils/dom';
import { clamp } from '../../core/utils/math';
import type { Tool } from '../../tools/Tool';
import type { PopoverHandle, PopoverManager } from '../dialogs/PopoverManager';

/** The card keeps this far from the edges of the stage and from the tray. */
const EDGE = 12;
const TRAY_GAP = 10;
/** A card never gets shorter than this, even with little room next to the tray. */
const MIN_HEIGHT = 160;

/**
 * The options card of the active tool, opened by tapping the tool again. It is placed under
 * the tray, or above it when the tray sits at the bottom (phones).
 *
 * The preview and the pin button are a fixed head; only the settings below them scroll, so the pin
 * button can never float over them.
 */
export class ToolOptionsPopover {
  private node: HTMLDivElement | null = null;
  private kind: string | null = null;
  private anchor: HTMLElement | null = null;
  private readonly handle: PopoverHandle = {
    contains: (target) => this.node?.contains(target) ?? false,
    isTrigger: (target) => this.isTrigger(target),
    close: () => this.close(),
  };
  private readonly reposition = (): void => this.place();

  constructor(
    private readonly stage: HTMLElement,
    private readonly camera: Camera,
    private readonly trayRect: () => DOMRect,
    private readonly popovers: PopoverManager,
    private readonly pin: (tool: Tool) => HTMLElement | null,
  ) {}

  /** Opens the tool's options, or closes them if they are already open. */
  toggle(anchor: HTMLElement, tool: Tool): void {
    if (this.node && this.kind === tool.kind) {
      this.close();
      return;
    }
    this.open(anchor, tool);
  }

  /** Opens the tool's options (replacing any open popover). */
  open(anchor: HTMLElement, tool: Tool): void {
    this.close();
    // The head first: a tool's settings draw into the preview that it holds.
    const preview = tool.createOptionsHeader();
    const pin = this.pin(tool);
    const body = el('div', { class: 'popover__body' }, tool.createOptionsPanel());
    const head = preview || pin ? el('div', { class: 'popover__head' }, preview, pin) : null;
    const node = el('div', { class: 'popover', attrs: { 'data-tool': tool.kind } }, head, body);
    this.stage.append(node);
    this.node = node;
    this.kind = tool.kind;
    this.anchor = anchor;
    this.place();
    this.popovers.opened(this.handle);
    window.visualViewport?.addEventListener('resize', this.reposition);
    window.visualViewport?.addEventListener('scroll', this.reposition);
  }

  /** The bar is rebuilt as it changes, so the button may be a new node for the same item. */
  private isTrigger(target: Node): boolean {
    if (this.anchor?.contains(target)) return true;
    const item = this.anchor?.dataset.item;
    const element = target instanceof Element ? target : target.parentElement;
    return item !== undefined && element?.closest<HTMLElement>('[data-item]')?.dataset.item === item;
  }

  /**
   * Places the card next to the tray and limits its height to the space on that side, which an
   * on-screen keyboard makes smaller; longer options scroll inside the card.
   */
  private place(): void {
    const { node, anchor } = this;
    if (!node || !anchor) return;
    const stage = this.stage.getBoundingClientRect();
    const tray = this.trayRect();
    const trayAtBottom = tray.top - stage.top > this.camera.height / 2;
    const view = window.visualViewport;
    const visibleBottom = (view ? view.offsetTop + view.height : stage.bottom) - stage.top;
    const bottom = Math.min(trayAtBottom ? tray.top - stage.top : stage.height, visibleBottom);
    const top = trayAtBottom ? EDGE : tray.bottom - stage.top + TRAY_GAP;
    node.style.maxHeight = Math.max(MIN_HEIGHT, bottom - top - TRAY_GAP) + 'px';
    const w = node.offsetWidth;
    const h = node.offsetHeight;
    const a = anchor.getBoundingClientRect();
    const left = clamp(a.left + a.width / 2 - stage.left - w / 2, EDGE, this.camera.width - w - EDGE);
    node.style.left = left + 'px';
    node.style.top = Math.max(EDGE, trayAtBottom ? bottom - h - TRAY_GAP : top) + 'px';
  }

  close(): void {
    if (!this.node) return;
    this.node.remove();
    this.node = null;
    this.kind = null;
    this.anchor = null;
    this.popovers.closed(this.handle);
    window.visualViewport?.removeEventListener('resize', this.reposition);
    window.visualViewport?.removeEventListener('scroll', this.reposition);
  }
}
