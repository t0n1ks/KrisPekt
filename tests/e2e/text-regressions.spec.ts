import { expect, test, type Page } from '@playwright/test';

/** Bugs of the first text tool; each of these failed before the text box rework. */

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface StoredText {
  x: number;
  y: number;
  w: number;
  t: string;
}

async function newNotebook(page: Page, title: string): Promise<void> {
  await page.goto('./');
  await page.locator('.subject').first().locator('.shelf__add').click();
  await page.fill('#nb-title', title);
  await page.click('.sheet__foot .btn--primary');
  await expect(page.locator('#editor')).toBeVisible();
}

function storedTexts(page: Page, title: string): Promise<StoredText[]> {
  return page.evaluate(
    (nbTitle) =>
      new Promise<StoredText[]>((resolve) => {
        const req = indexedDB.open('konspektnik', 1);
        req.onsuccess = () => {
          const tx = req.result.transaction(['notebooks', 'pages']);
          const nbs = tx.objectStore('notebooks').getAll();
          const all = tx.objectStore('pages').getAll();
          tx.oncomplete = () => {
            const nb = (nbs.result as { id: string; title: string }[]).find((n) => n.title === nbTitle);
            const rows = all.result as { nbId: string; texts: StoredText[] }[];
            resolve(rows.filter((r) => r.nbId === nb?.id).flatMap((r) => r.texts));
          };
        };
      }),
    title,
  );
}

/** The bounding box of dark pixels on the page canvas, in client px. */
function inkBounds(page: Page, area: Rect): Promise<Rect | null> {
  return page.evaluate((r) => {
    const stage = document.querySelector<HTMLCanvasElement>('#stage canvas');
    const ctx = stage?.getContext('2d');
    if (!stage || !ctx) return null;
    const box = stage.getBoundingClientRect();
    const k = stage.width / box.width;
    const sx = Math.round((r.x - box.left) * k);
    const sy = Math.round((r.y - box.top) * k);
    const w = Math.round(r.w * k);
    const h = Math.round(r.h * k);
    const { data } = ctx.getImageData(sx, sy, w, h);
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if ((data[(y * w + x) * 4] ?? 255) > 110) continue;
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
    }
    if (x0 === Infinity) return null;
    return { x: r.x + x0 / k, y: r.y + y0 / k, w: (x1 - x0 + 1) / k, h: (y1 - y0 + 1) / k };
  }, area);
}

async function stageCenter(page: Page): Promise<{ x: number; y: number }> {
  const box = await page.locator('#stage').boundingBox();
  if (!box) throw new Error('no stage');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test('a short text can be lassoed by looping around the words you can see', async ({ page }) => {
  await newNotebook(page, 'Lasso short');
  const c = await stageCenter(page);
  await page.keyboard.press('t');
  await page.mouse.click(c.x - 200, c.y);
  await page.keyboard.type('Hi');
  await page.keyboard.press('Escape');
  await page.keyboard.press('l');
  const r = { x: c.x - 230, y: c.y - 40, w: 90, h: 70 };
  await page.mouse.move(r.x, r.y);
  await page.mouse.down();
  await page.mouse.move(r.x + r.w, r.y, { steps: 3 });
  await page.mouse.move(r.x + r.w, r.y + r.h, { steps: 3 });
  await page.mouse.move(r.x, r.y + r.h, { steps: 3 });
  await page.mouse.move(r.x, r.y, { steps: 3 });
  await page.mouse.up();
  await expect(page.locator('#selbar')).toBeVisible();
});

test('a very long word stays inside the page', async ({ page }) => {
  await newNotebook(page, 'Long word');
  const c = await stageCenter(page);
  await page.keyboard.press('t');
  await page.mouse.click(c.x, c.y);
  await page.keyboard.type('Ж'.repeat(120));
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await storedTexts(page, 'Long word')).length).toBe(1);
  await page.waitForTimeout(300);
  // Without breaking the word, the rest of it is cut off at the page edge and lost from view.
  const below = await inkBounds(page, { x: c.x - 300, y: c.y + 22, w: 600, h: 60 });
  expect(below).not.toBeNull();
});

test('text does not jump when editing ends', async ({ page }) => {
  await newNotebook(page, 'No jump');
  const c = await stageCenter(page);
  await page.keyboard.press('t');
  await page.mouse.click(c.x - 150, c.y);
  await page.keyboard.type('HHHH');
  await page.waitForTimeout(100);
  const stage = await page.locator('#stage').boundingBox();
  if (!stage) throw new Error('no stage');
  const during = (await page.locator('#stage').screenshot()).toString('base64');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const after = (await page.locator('#stage').screenshot()).toString('base64');
  const band = { x: Math.round(c.x - 150 - stage.x), width: 120, top: Math.round(c.y - stage.y - 40) };
  const before = await firstRow(page, during, { ...band, want: 'dark' });
  expect(before).toBeGreaterThan(0);
  expect(Math.abs(before - (await firstRow(page, after, { ...band, want: 'dark' })))).toBeLessThanOrEqual(1);
});

/**
 * The first row of a screenshot, from `top` down, with a wanted pixel in a band of columns.
 * "dark" is near-black, so the blue frame and caret do not count as text.
 */
function firstRow(
  page: Page,
  shot: string,
  band: { x: number; width: number; top: number; want: 'paper' | 'dark' },
): Promise<number> {
  return page.evaluate(
    async ([png, { x, width, top, want }]) => {
      const image = new Image();
      image.src = 'data:image/png;base64,' + png;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return -1;
      ctx.drawImage(image, 0, 0);
      const height = image.height - top;
      const { data } = ctx.getImageData(x, top, width, height);
      for (let y = 0; y < height; y++) {
        for (let i = 0; i < width; i++) {
          const o = (y * width + i) * 4;
          const low = Math.min(data[o] ?? 0, data[o + 1] ?? 0, data[o + 2] ?? 0);
          const high = Math.max(data[o] ?? 0, data[o + 1] ?? 0, data[o + 2] ?? 0);
          if (want === 'paper' ? low > 248 : high < 70) return top + y;
        }
      }
      return -1;
    },
    [shot, band] as const,
  );
}
