import { byId } from '../../core/utils/dom';
import { PageChipFade, type WritingSample } from '../../domain/PageChipFade';

export interface PageChipDeps {
  /** The button was pressed on purpose. */
  open: () => void;
  /** Hands a stylus press over to the page, as the ruler does. */
  forwardPen: (e: PointerEvent) => void;
  /** Whether a touch here is the hand resting on the screen. */
  isPalm: (e: PointerEvent) => boolean;
  /** Whether the selected tool writes, rather than navigates. */
  writes: () => boolean;
}

/**
 * How the page button behaves around writing; its text is the top bar's. It sits on the page, so
 * it must not get in the way of the pen: it fades during writing, and a stylus that lands on it
 * anyway writes on the page below. A finger or a mouse always reaches it, as long as it shows.
 */
export class PageChip {
  private readonly node = byId<HTMLButtonElement>('pageChip');
  private readonly fade = new PageChipFade((faded) => this.node.classList.toggle('page-chip--faded', faded));
  /** The press was not meant for the button, so the click it ends in does nothing. */
  private ignoreClick = false;
  private readonly onDown = (e: PointerEvent): void => this.down(e);
  private readonly onClick = (e: MouseEvent): void => this.click(e);

  constructor(private readonly deps: PageChipDeps) {
    this.node.addEventListener('pointerdown', this.onDown);
    this.node.addEventListener('click', this.onClick);
  }

  /** Takes in one routed pointer event. */
  input(sample: WritingSample): void {
    this.fade.input(sample, this.deps.writes());
  }

  /** Removes the listeners. */
  destroy(): void {
    this.fade.reset();
    this.node.removeEventListener('pointerdown', this.onDown);
    this.node.removeEventListener('click', this.onClick);
  }

  private down(e: PointerEvent): void {
    const pen = e.pointerType === 'pen' && this.deps.writes();
    this.ignoreClick = pen || this.deps.isPalm(e);
    if (pen) this.deps.forwardPen(e);
  }

  private click(e: MouseEvent): void {
    // A click from the keyboard (detail 0) follows no press.
    const ignored = this.ignoreClick && e.detail > 0;
    this.ignoreClick = false;
    if (!ignored) this.deps.open();
  }
}
