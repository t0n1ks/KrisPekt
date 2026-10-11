import { LONG_PRESS_MS } from '../../core/constants';

/** A press that moves further than this many px is a drag, not a long press. */
const MOVE_SLOP = 10;

/**
 * Long-press support for buttons. Holding a button for {@link LONG_PRESS_MS} (or a right click,
 * or the keyboard's context-menu key) calls `onLong`, and the click that would follow is
 * swallowed so the tap action does not run as well.
 */
export class LongPress {
  /** Adds the listeners; they live as long as the node does. */
  static attach(node: HTMLElement, onLong: () => void, ms = LONG_PRESS_MS): void {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let fired = false;
    let pressing = false;
    let start = { x: 0, y: 0 };
    const fire = (): void => {
      clearTimeout(timer);
      if (fired) return;
      fired = true;
      onLong();
    };
    const cancel = (): void => {
      pressing = false;
      clearTimeout(timer);
    };
    node.addEventListener('pointerdown', (e) => {
      fired = false;
      pressing = true;
      start = { x: e.clientX, y: e.clientY };
      clearTimeout(timer);
      timer = setTimeout(fire, ms);
    });
    node.addEventListener('pointermove', (e) => {
      if (pressing && Math.hypot(e.clientX - start.x, e.clientY - start.y) > MOVE_SLOP) cancel();
    });
    for (const type of ['pointerup', 'pointercancel', 'pointerleave'] as const)
      node.addEventListener(type, cancel);
    node.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (fired) return;
      // During a press (touch long-press, right click) the following click must be swallowed;
      // from the keyboard's menu key there is no click to swallow.
      if (pressing) fire();
      else onLong();
    });
    node.addEventListener('keydown', () => {
      fired = false;
    });
    node.addEventListener(
      'click',
      (e) => {
        if (!fired) return;
        fired = false;
        e.preventDefault();
        e.stopImmediatePropagation();
      },
      true,
    );
  }
}
