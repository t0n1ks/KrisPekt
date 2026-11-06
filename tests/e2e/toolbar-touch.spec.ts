import { expect, test, type CDPSession, type Page } from '@playwright/test';
import type { Spot } from './pointers';

/** Long enough for a long press (`LONG_PRESS_MS`) to fire. */
const LONG_PRESS_HOLD_MS = 700;
/** Xiaomi Pad 6, both ways round, as Chrome lays it out. */
const TABLETS = [
  { width: 1280, height: 800 },
  { width: 800, height: 1280 },
];

const slot = (page: Page) => page.locator('#tray [data-item="lasso"]');
const separateHand = (page: Page) => page.locator('#tray [data-item="hand"]');
const activeTool = (page: Page) => page.locator('#tray button[aria-pressed="true"]').first();

/**
 * Input sent through the browser's own pipeline, as a device sends it, so the events carry their
 * real pointer type and the browser itself decides whether a click follows. Events dispatched from
 * a script, or a mouse, would miss what only happens between a real press and its click.
 */
class RealInput {
  private constructor(
    private readonly page: Page,
    private readonly cdp: CDPSession,
  ) {}

  static async on(page: Page): Promise<RealInput> {
    return new RealInput(page, await page.context().newCDPSession(page));
  }

  /** A short press with a finger or a stylus. */
  async tap(kind: 'touch' | 'pen', at: Spot): Promise<void> {
    if (kind === 'touch') {
      await this.page.touchscreen.tap(at.x, at.y);
      return;
    }
    await this.pen('mousePressed', at);
    await this.pen('mouseReleased', at);
  }

  /** A finger held still. */
  async holdFinger(at: Spot): Promise<void> {
    await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [at] });
    await this.page.waitForTimeout(LONG_PRESS_HOLD_MS);
    await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }

  /** A short stroke with a stylus, which starts a writing session. */
  async penStroke(from: Spot, to: Spot): Promise<void> {
    await this.pen('mousePressed', from);
    await this.pen('mouseMoved', to);
    await this.pen('mouseReleased', to);
  }

  private async pen(type: 'mousePressed' | 'mouseMoved' | 'mouseReleased', at: Spot): Promise<void> {
    const pressed = type !== 'mouseReleased';
    await this.cdp.send('Input.dispatchMouseEvent', {
      type,
      x: at.x,
      y: at.y,
      button: 'left',
      buttons: pressed ? 1 : 0,
      clickCount: 1,
      pointerType: 'pen',
      force: pressed ? 0.5 : 0,
    });
  }
}

async function open(page: Page, viewport: { width: number; height: number }): Promise<RealInput> {
  await page.setViewportSize(viewport);
  await page.goto('./');
  await page.locator('.subject').first().locator('.shelf__add').click();
  await page.fill('#nb-title', 'Touch');
  await page.click('.sheet__foot .btn--primary');
  await expect(page.locator('#editor')).toBeVisible();
  await page.locator('#tray [data-tool="pen"]').waitFor();
  return RealInput.on(page);
}

async function centre(page: Page, selector: string): Promise<Spot> {
  const box = await page.locator(selector).boundingBox();
  if (!box) throw new Error('not on the screen: ' + selector);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** The pointer types the toolbar received, so that a test cannot pass on the wrong input. */
async function watchPointerTypes(page: Page): Promise<() => Promise<string[]>> {
  await page.evaluate(() => {
    const seen: string[] = [];
    Object.assign(window, { seenPointerTypes: seen });
    document.getElementById('tray')?.addEventListener('pointerdown', (e) => seen.push(e.pointerType), true);
  });
  return () => page.evaluate(() => (window as unknown as { seenPointerTypes: string[] }).seenPointerTypes);
}

async function showSeparateHand(page: Page): Promise<void> {
  await page.click('#btnEdMore');
  await page.locator('.menu__item', { hasText: 'Настроить панель' }).click();
  await page
    .locator('.toolbar-custom__row', { hasText: 'Рука' })
    .getByRole('button', { name: /Показать/ })
    .click();
  await page.keyboard.press('Escape');
  await expect(separateHand(page)).toBeVisible();
}

test.use({ hasTouch: true });

for (const viewport of TABLETS) {
  const size = `${viewport.width}x${viewport.height}`;

  for (const kind of ['touch', 'pen'] as const) {
    test.describe(`${kind} on a ${size} tablet`, () => {
      test('tapping one spot goes Lasso, Hand, Lasso, Hand', async ({ page }) => {
        const input = await open(page, viewport);
        const seen = await watchPointerTypes(page);
        await input.tap(kind, await centre(page, '#tray [data-item="lasso"]'));
        await expect(activeTool(page)).toHaveAttribute('data-tool', 'lasso');
        const spot = await centre(page, '#tray [data-item="lasso"]');
        const box = await page.locator('#tray').boundingBox();

        for (const tool of ['hand', 'lasso', 'hand', 'lasso']) {
          await input.tap(kind, spot);
          await expect(activeTool(page)).toHaveAttribute('data-tool', tool);
          await expect(slot(page)).toHaveAttribute('data-tool', tool);
          await expect(page.locator('#tray button[aria-pressed="true"]')).toHaveCount(1);
        }
        expect(await page.locator('#tray').boundingBox()).toEqual(box);
        await expect(page.locator('.popover')).toHaveCount(0);
        expect(new Set(await seen())).toEqual(new Set([kind]));
      });

      test('the separate Hand button goes back to the lasso too', async ({ page }) => {
        const input = await open(page, viewport);
        await showSeparateHand(page);
        const spot = await centre(page, '#tray [data-item="hand"]');
        for (const tool of ['hand', 'lasso', 'hand']) {
          await input.tap(kind, spot);
          await expect(slot(page)).toHaveAttribute('data-tool', 'lasso');
          await expect(activeTool(page)).toHaveAttribute('data-tool', tool);
          await expect(page.locator('#tray button[aria-pressed="true"]')).toHaveCount(1);
        }
        await expect(page.locator('.popover')).toHaveCount(0);
      });

      test('with the separate Hand button, the combined one stays the Lasso', async ({ page }) => {
        const input = await open(page, viewport);
        await showSeparateHand(page);
        const spot = await centre(page, '#tray [data-item="lasso"]');
        await input.tap(kind, await centre(page, '#tray [data-item="hand"]'));
        await expect(separateHand(page)).toHaveAttribute('aria-pressed', 'true');
        await expect(slot(page)).toHaveAttribute('aria-pressed', 'false');
        await expect(slot(page)).toHaveAttribute('aria-label', 'Лассо');

        await input.tap(kind, await centre(page, '#tray [data-item="pen"]'));
        await expect(slot(page)).toHaveAttribute('data-tool', 'lasso');
        await input.tap(kind, spot);
        await expect(slot(page)).toHaveAttribute('aria-pressed', 'true');
        await expect(separateHand(page)).toHaveAttribute('aria-pressed', 'false');
      });
    });
  }

  test.describe(`a finger on a ${size} tablet`, () => {
    test('a toolbar tap works straight after the stylus, in its writing session', async ({ page }) => {
      const input = await open(page, viewport);
      await input.tap('touch', await centre(page, '#tray [data-item="lasso"]'));
      const spot = await centre(page, '#tray [data-item="lasso"]');
      const paper = await centre(page, '#stage');
      for (const tool of ['hand', 'lasso']) {
        await input.penStroke(paper, { x: paper.x + 40, y: paper.y + 20 });
        await input.tap('touch', spot);
        await expect(slot(page)).toHaveAttribute('data-tool', tool);
      }
    });

    test('a long press still opens the menu, and only the menu', async ({ page }) => {
      const input = await open(page, viewport);
      const spot = await centre(page, '#tray [data-item="lasso"]');
      await input.tap('touch', spot);
      await input.tap('touch', spot);
      await expect(slot(page)).toHaveAttribute('data-tool', 'hand');

      await input.holdFinger(await centre(page, '#tray [data-item="lasso"]'));
      const items = page.locator('.menu .menu__item');
      await expect(items).toHaveCount(2);
      await expect(slot(page)).toHaveAttribute('data-tool', 'hand');

      const lasso = await items.first().boundingBox();
      if (!lasso) throw new Error('no menu item');
      await input.tap('touch', { x: lasso.x + lasso.width / 2, y: lasso.y + lasso.height / 2 });
      await expect(slot(page)).toHaveAttribute('data-tool', 'lasso');
      await expect(page.locator('.menu')).toHaveCount(0);
    });

    test('hiding the separate Hand button makes the combined one show the Hand again', async ({ page }) => {
      const input = await open(page, viewport);
      await showSeparateHand(page);
      await input.tap('touch', await centre(page, '#tray [data-item="hand"]'));
      await expect(slot(page)).toHaveAttribute('data-tool', 'lasso');

      await page.click('#btnEdMore');
      await page.locator('.menu__item', { hasText: 'Настроить панель' }).click();
      await page
        .locator('.toolbar-custom__row', { hasText: 'Рука' })
        .getByRole('button', { name: /Скрыть/ })
        .click();
      await page.keyboard.press('Escape');
      await expect(separateHand(page)).toHaveCount(0);
      await expect(slot(page)).toHaveAttribute('data-tool', 'hand');
      await expect(slot(page)).toHaveAttribute('aria-pressed', 'true');
    });

    test('an open tool popover does not swallow the tap', async ({ page }) => {
      const input = await open(page, viewport);
      await input.tap('touch', await centre(page, '#tray [data-item="pen"]'));
      await expect(page.locator('.popover')).toHaveCount(1);
      await input.tap('touch', await centre(page, '#tray [data-item="lasso"]'));
      await expect(page.locator('.popover')).toHaveCount(0);
      await expect(slot(page)).toHaveAttribute('aria-pressed', 'true');
    });
  });
}
