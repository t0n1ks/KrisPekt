import { LINK_TIP_WINDOW_MS } from '../core/constants';

/** Notices a link tapped twice with a tool that writes: someone expected it to open. */
export class LinkTapTip {
  private last = -Infinity;

  /** A link was tapped at this time; true if that was the second tap in a short time. */
  tapped(time: number): boolean {
    const again = time - this.last <= LINK_TIP_WINDOW_MS;
    this.last = again ? -Infinity : time;
    return again;
  }
}
