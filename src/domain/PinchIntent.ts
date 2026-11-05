import { PINCH_SPREAD_PER_TRAVEL, PINCH_ZOOM_SLOP_PX } from '../core/constants';

/**
 * Tells a real pinch from a two-finger scroll. Two fingers moving together never keep exactly
 * the same distance, so scaling on every change makes each scroll drift the zoom by a few %.
 */
export class PinchIntent {
  /**
   * Whether two fingers mean to zoom: their distance changed by more than natural wobble and
   * by a good part of how far they travelled together.
   *
   * @param spread change of the distance between the fingers since the gesture began, in CSS px
   * @param travel how far the midpoint between them moved since then, in CSS px
   */
  static isZoom(spread: number, travel: number): boolean {
    return spread >= PINCH_ZOOM_SLOP_PX && spread >= travel * PINCH_SPREAD_PER_TRAVEL;
  }
}
