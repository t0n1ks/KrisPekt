import { NAV_HISTORY_LIMIT } from '../core/constants';

/** A place on screen to come back to. */
export interface NavigationSpot {
  nbId: string;
  pageId: string | null;
  /** How far the view's top is below the page's top, in world px. */
  dy: number;
  /** The view's left edge, in world px. */
  x: number;
  z: number;
}

/** Where to go back to after following links; the oldest step goes when it is full. Pure. */
export class NavigationStack {
  private spots: NavigationSpot[] = [];

  constructor(private readonly limit = NAV_HISTORY_LIMIT) {}

  get size(): number {
    return this.spots.length;
  }

  push(spot: NavigationSpot): void {
    this.spots.push(spot);
    if (this.spots.length > this.limit) this.spots.shift();
  }

  pop(): NavigationSpot | null {
    return this.spots.pop() ?? null;
  }

  clear(): void {
    this.spots = [];
  }
}
