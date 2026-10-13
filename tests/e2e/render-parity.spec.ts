import { expect, test, type Page } from '@playwright/test';
import { openNotebook, seedFixtureNotebook } from './fixture-page';

/** The page canvas' own pixels as PNG (no toolbar or toast on top). */
async function canvasPng(page: Page): Promise<Buffer> {
  const url = await page.evaluate(() =>
    (document.getElementById('cv') as HTMLCanvasElement).toDataURL('image/png'),
  );
  return Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
}

/**
 * Screen rendering must stay pixel-identical when the drawing code changes. The baseline
 * images were taken before strokes, text and patterns were turned into shared drawing
 * commands; every later change is compared against them.
 */
test('the editor draws the fixture page exactly as before', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 1300 });
  await page.goto('./');
  await seedFixtureNotebook(page, 'Parity');
  await openNotebook(page, 'Parity');
  expect(await canvasPng(page)).toMatchSnapshot('fixture-fit.png', { maxDiffPixels: 0 });

  // Zoomed in around the tiny handwriting: fine detail, thin pattern lines, pencil grain.
  for (let i = 0; i < 6; i++) {
    await page.evaluate(() =>
      document.getElementById('cv')?.dispatchEvent(
        new WheelEvent('wheel', {
          clientX: 490,
          clientY: 735,
          deltaY: -100,
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
  }
  await page.waitForTimeout(800);
  expect(await canvasPng(page)).toMatchSnapshot('fixture-zoom.png', { maxDiffPixels: 0 });
});
