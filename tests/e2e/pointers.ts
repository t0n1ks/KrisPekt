import type { Page } from '@playwright/test';

export type Spot = { x: number; y: number };

const IDS = { touch: 11, pen: 21 };

/** Sends one pointer event to an element, as a finger or a stylus; the mouse is Playwright's own. */
export async function pointer(
  page: Page,
  kind: 'touch' | 'pen',
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  at: Spot,
  target = 'cv',
): Promise<void> {
  await page.evaluate(
    ({ id, kind, type, at, target }) => {
      document.getElementById(target)?.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerId: id,
          pointerType: kind,
          isPrimary: true,
          clientX: at.x,
          clientY: at.y,
          button: type === 'pointermove' ? -1 : 0,
          buttons: type === 'pointerup' ? 0 : 1,
          pressure: type === 'pointerup' ? 0 : 0.5,
          width: 8,
          height: 8,
        }),
      );
    },
    { id: IDS[kind], kind, type, at, target },
  );
}

/** A short press without moving. */
export async function tapWith(page: Page, kind: 'touch' | 'pen', at: Spot): Promise<void> {
  await pointer(page, kind, 'pointerdown', at);
  await pointer(page, kind, 'pointerup', at);
}

/**
 * A drag in several steps, about 16 ms each. `holdMs`: how long it stays before moving; without a
 * hold it is a quick swipe.
 */
export async function dragWith(
  page: Page,
  kind: 'touch' | 'pen',
  from: Spot,
  to: Spot,
  holdMs = 0,
): Promise<void> {
  await pointer(page, kind, 'pointerdown', from);
  if (holdMs) await page.waitForTimeout(holdMs);
  for (let i = 1; i <= 8; i++) {
    const step = { x: from.x + ((to.x - from.x) * i) / 8, y: from.y + ((to.y - from.y) * i) / 8 };
    await pointer(page, kind, 'pointermove', step);
    await page.waitForTimeout(16);
  }
  await pointer(page, kind, 'pointerup', to);
}
