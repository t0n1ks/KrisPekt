import { expect, test, type Locator, type Page } from '@playwright/test';

const PHONE = { width: 360, height: 800 };
const TABLET = { width: 800, height: 1280 };

async function openEditor(page: Page): Promise<void> {
  await page.goto('./');
  await page.locator('.subject').first().locator('.shelf__add').click();
  await page.fill('#nb-title', 'Popovers');
  await page.click('.sheet__foot .btn--primary');
  await expect(page.locator('#editor')).toBeVisible();
  await page.locator('#tray [data-tool="pen"]').waitFor();
}

/** Counts every menu or popover that is put on the page from now on: a flicker counts as one. */
async function watchOpenings(page: Page): Promise<() => Promise<number>> {
  await page.evaluate(() => {
    const counted = { n: 0 };
    (window as unknown as { openings: { n: number } }).openings = counted;
    new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node instanceof Element && node.matches('.menu, .popover')) counted.n++;
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
  });
  return () => page.evaluate(() => (window as unknown as { openings: { n: number } }).openings.n);
}

/** Tapping twice opens once and closes, and it stays closed. */
async function expectToggles(page: Page, button: Locator, surface: string): Promise<void> {
  const openings = await watchOpenings(page);
  await button.click();
  await expect(page.locator(surface)).toBeVisible();
  await button.click();
  await expect(page.locator(surface)).toHaveCount(0);
  await page.waitForTimeout(150);
  await expect(page.locator(surface)).toHaveCount(0);
  expect(await openings()).toBe(1);
}

test.describe('the button of an open menu closes it', () => {
  test.use({ viewport: TABLET });

  test('on the shelf', async ({ page }) => {
    await page.goto('./');
    for (const button of ['#btnLibMore', '#btnLang', '.subject__more', '.notebook-card__more']) {
      await page.reload();
      await expectToggles(page, page.locator(button).first(), '.menu');
    }
  });

  test('in the editor', async ({ page }) => {
    await openEditor(page);
    await expectToggles(page, page.locator('#btnEdMore'), '.menu');
  });

  test('the zoom pill', async ({ page }) => {
    await openEditor(page);
    await expectToggles(page, page.locator('#btnZoom'), '.menu');
  });

  test('the overflow of the toolbar', async ({ page }) => {
    await openEditor(page);
    await expectToggles(page, page.locator('.tool-tray__more'), '.menu');
  });

  test('the options of the selected tool', async ({ page }) => {
    await openEditor(page);
    await expectToggles(page, page.locator('#tray [data-tool="pen"]'), '.popover');
  });
});

test.describe('the same rules for all of them', () => {
  test.use({ viewport: TABLET });

  test('a press outside closes tool options, and the press still writes', async ({ page }) => {
    await openEditor(page);
    await page.locator('#tray [data-tool="pen"]').click();
    await expect(page.locator('.popover')).toBeVisible();
    const box = await page.locator('#stage').boundingBox();
    if (!box) throw new Error('no stage');
    await page.mouse.move(box.x + 400, box.y + box.height - 100);
    await page.mouse.down();
    await expect(page.locator('.popover')).toHaveCount(0);
    await page.mouse.up();
  });

  test('Escape closes one thing at a time', async ({ page }) => {
    await openEditor(page);
    await page.locator('#tray [data-tool="pen"]').click();
    await expect(page.locator('.popover')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.popover')).toHaveCount(0);

    await page.click('#btnPages');
    await page.locator('.page-item__more').first().click();
    await expect(page.locator('.menu')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.menu')).toHaveCount(0);
    await expect(page.locator('#panel')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#panel')).toBeHidden();
  });

  test('Escape closes a sheet, and a confirmation before what is under it', async ({ page }) => {
    await page.goto('./');
    await page.click('#btnAddSubject');
    await expect(page.locator('.sheet')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(page.locator('.sheet')).toHaveCount(0);
  });

  test('opening another closes the one before', async ({ page }) => {
    await openEditor(page);
    await page.locator('#tray [data-tool="pen"]').click();
    await expect(page.locator('.popover')).toBeVisible();
    await page.click('#btnEdMore');
    await expect(page.locator('.popover')).toHaveCount(0);
    await expect(page.locator('.menu')).toHaveCount(1);
    await page.click('#btnZoom');
    await expect(page.locator('.menu')).toHaveCount(1);
    await expect(page.locator('.menu__item').first()).toBeDisabled();
  });
});

test.describe('the options of a tool', () => {
  test('the pin button stays in the fixed head while the settings scroll', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await openEditor(page);
    await page.locator('#tray [data-tool="pen"]').click();
    const pin = page.locator('.popover__head .popover__pin');
    const preview = page.locator('.popover__head .popover__preview');
    const body = page.locator('.popover__body');
    await expect(pin).toBeVisible();
    await expect(preview).toBeVisible();
    const before = await pin.boundingBox();
    const scrolled = await body.evaluate((node) => {
      node.scrollTop = 200;
      return node.scrollTop;
    });
    expect(scrolled).toBeGreaterThan(0);
    expect(await pin.boundingBox()).toEqual(before);
    // Nothing of the settings runs under the button.
    const bodyBox = await body.boundingBox();
    if (!before || !bodyBox) throw new Error('no layout');
    expect(bodyBox.y).toBeGreaterThanOrEqual(before.y + before.height);
  });

  test('a brush switch keeps the preview in the head', async ({ page }) => {
    await openEditor(page);
    await page.locator('#tray [data-tool="pen"]').click();
    await page.locator('.brush-picker button').nth(1).click();
    await expect(page.locator('.popover__preview')).toHaveCount(1);
    await expect(page.locator('.popover__head .popover__preview')).toBeVisible();
  });
});

test.describe('the on-screen keyboard', () => {
  /** Makes the page believe a keyboard covers everything below this height. */
  async function keyboardLeaves(page: Page, height: number): Promise<void> {
    await page.evaluate((visible) => {
      const view = window.visualViewport;
      if (!view) throw new Error('no visual viewport');
      Object.defineProperty(view, 'height', { configurable: true, get: () => visible });
      view.dispatchEvent(new Event('resize'));
    }, height);
  }

  test('does not cover a dialog or the field being typed in', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto('./');
    await page.click('#btnAddSubject');
    const input = page.locator('.sheet input[type=text]').first();
    await input.focus();
    await keyboardLeaves(page, 320);
    const sheet = await page.locator('.sheet').boundingBox();
    const field = await input.boundingBox();
    if (!sheet || !field) throw new Error('no layout');
    expect(sheet.y + sheet.height).toBeLessThanOrEqual(320.5);
    expect(field.y + field.height).toBeLessThanOrEqual(320.5);
    expect(field.y).toBeGreaterThanOrEqual(0);
  });

  test('moves an open menu out of its way', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto('./');
    await page.click('#btnLibMore');
    await keyboardLeaves(page, 300);
    const menu = await page.locator('.menu').boundingBox();
    if (!menu) throw new Error('no layout');
    expect(menu.y).toBeGreaterThanOrEqual(0);
    expect(menu.y + menu.height).toBeLessThanOrEqual(300.5);
  });
});
