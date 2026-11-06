import { PAGE_CHIP_IDLE_MS } from '../core/constants';

/** The parts of a routed pointer event that say whether someone is writing. */
export interface WritingSample {
  pointerType: string;
  /** `down`, `move`, `up`, `cancel`, `hover`, `over`. */
  event: string;
  buttons: number;
  role: string | null;
}

/**
 * When the page button steps aside: it fades while someone writes and comes back once they have
 * been idle for a while. A stylus counts from its first hover, because by the time it touches down
 * it is too late to move out of its way. A finger counts only while it draws, so that one reaching
 * for the button does not make it disappear.
 */
export class PageChipFade {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pressing = false;

  /** @param onChange told whether the button is faded, each time something happens to it */
  constructor(
    private readonly onChange: (faded: boolean) => void,
    private readonly idleMs = PAGE_CHIP_IDLE_MS,
  ) {}

  /** Takes in one pointer event. `writes`: the selected tool writes, rather than navigates. */
  input(sample: WritingSample, writes: boolean): void {
    if (sample.event === 'up' || sample.event === 'cancel') {
      if (this.pressing) this.settle();
      this.pressing = false;
      return;
    }
    if (!writes || !PageChipFade.isWriting(sample)) return;
    if (sample.event === 'down') this.pressing = true;
    clearTimeout(this.timer);
    this.onChange(true);
    if (!this.pressing) this.settle();
  }

  /** Brings the button back at once. */
  reset(): void {
    clearTimeout(this.timer);
    this.pressing = false;
    this.onChange(false);
  }

  private settle(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.onChange(false), this.idleMs);
  }

  private static isWriting(sample: WritingSample): boolean {
    if (sample.pointerType === 'pen') return true;
    if (sample.pointerType === 'touch') return sample.role === 'draw';
    return (sample.buttons & 1) !== 0;
  }
}
