import { expect, test, type Page } from '@playwright/test';

/** Creates a notebook and leaves it open in the editor. */
async function openNewNotebook(page: Page, title: string): Promise<void> {
  await page.goto('./');
  await page.locator('.subject').first().locator('.shelf__add').click();
  await page.fill('#nb-title', title);
  await page.click('.sheet__foot .btn--primary');
  await expect(page.locator('#editor')).toBeVisible();
}

async function openExisting(page: Page, title: string): Promise<void> {
  await page.locator('.notebook-card__title', { hasText: title }).click();
  await expect(page.locator('#editor')).toBeVisible();
}

/** One Ctrl + wheel step on the canvas (what a trackpad pinch sends too). */
async function ctrlWheel(page: Page, deltaY: number): Promise<void> {
  await page.evaluate(
    (dy) =>
      document.getElementById('cv')?.dispatchEvent(
        new WheelEvent('wheel', {
          clientX: 640,
          clientY: 400,
          deltaY: dy,
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      ),
    deltaY,
  );
}

const zoomPill = (page: Page) => page.locator('#btnZoom');

test('the zoom survives a reload without leaving through the back button', async ({ page }) => {
  await openNewNotebook(page, 'Reload');
  await expect(zoomPill(page)).toHaveText(/%/);
  const fitted = await zoomPill(page).innerText();
  await ctrlWheel(page, -60);
  await expect(zoomPill(page)).not.toHaveText(fitted);
  const zoom = await zoomPill(page).innerText();
  // Going to the background is the last chance to save before Android may kill the app.
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
  await page.waitForTimeout(300);
  await page.reload();
  await openExisting(page, 'Reload');
  await expect(zoomPill(page)).toHaveText(zoom);
});
