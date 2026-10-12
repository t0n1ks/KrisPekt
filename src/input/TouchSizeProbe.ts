/** A contact size in CSS px. */
export interface ContactSize {
  width: number;
  height: number;
  /** The size came from Touch Events rather than the pointer event. */
  fromTouch: boolean;
}

interface TouchRecord {
  x: number;
  y: number;
  width: number;
  height: number;
}

const TOUCH_TYPES = ['touchstart', 'touchmove', 'touchend', 'touchcancel'] as const;

/** A touch and a pointer event this close (CSS px) are the same contact. */
const MATCH_PX = 1.5;

/**
 * Contact sizes for palm rejection. Pointer events carry `width`/`height`; some Android
 * devices report 1 × 1 for every touch. Then the size comes from `Touch.radiusX/radiusY` of
 * the Touch Events for the same contact, matched by position.
 *
 * The touch listeners are passive and only record sizes: input is handled through Pointer
 * Events alone. Chrome dispatches `pointerdown` before `touchstart`, so the fallback size is
 * known from the first `pointermove` on; the classifier re-checks size on every move anyway.
 */
export class TouchSizeProbe {
  private touches: TouchRecord[] = [];
  private readonly record = (e: TouchEvent): void => {
    this.touches = Array.from(e.touches, (t) => ({
      x: t.clientX,
      y: t.clientY,
      width: (t.radiusX || 0) * 2,
      height: (t.radiusY || 0) * 2,
    }));
  };

  constructor(private readonly target: HTMLElement) {
    for (const type of TOUCH_TYPES) target.addEventListener(type, this.record, { passive: true });
  }

  /** Removes the listeners. */
  destroy(): void {
    for (const type of TOUCH_TYPES) this.target.removeEventListener(type, this.record);
  }

  /** The contact size of a touch pointer event, falling back to Touch Events when it reports none. */
  sizeOf(e: PointerEvent): ContactSize {
    const width = e.width || 0;
    const height = e.height || 0;
    if (e.pointerType !== 'touch' || width > 1 || height > 1) return { width, height, fromTouch: false };
    const match = this.touches.find(
      (t) => Math.abs(t.x - e.clientX) <= MATCH_PX && Math.abs(t.y - e.clientY) <= MATCH_PX,
    );
    if (!match) return { width, height, fromTouch: false };
    return { width: match.width, height: match.height, fromTouch: true };
  }
}
