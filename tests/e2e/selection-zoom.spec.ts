import { expect, test, type Page } from '@playwright/test';

/** A rectangle in client (viewport) px. */
interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface StoredPage {
  h: number;
  texts: { x: number; y: number; t: string }[];
  strokes: number;
}

/** Pages of a notebook in page order, straight from IndexedDB. */
function storedPages(page: Page, title: string): Promise<StoredPage[]> {
  return page.evaluate(
    (nbTitle) =>
      new Promise<StoredPage[]>((resolve) => {
        const req = indexedDB.open('konspektnik', 1);
        req.onsuccess = () => {
          const tx = req.result.transaction(['notebooks', 'pages']);
          const nbs = tx.objectStore('notebooks').getAll();
          nbs.onsuccess = () => {
            const nb = (nbs.result as { title: string; pageIds: string[] }[]).find(
              (n) => n.title === nbTitle,
            );
            const all = tx.objectStore('pages').getAll();
            all.onsuccess = () => {
              const rows = all.result as {
                id: string;
                h: number;
                texts: { x: number; y: number; t: string }[];
                strokes: unknown[];
              }[];
              resolve(
                (nb?.pageIds ?? []).map((id) => {
                  const row = rows.find((r) => r.id === id);
                  return { h: row?.h ?? 0, texts: row?.texts ?? [], strokes: row?.strokes.length ?? 0 };
                }),
              );
            };
          };
        };
      }),
    title,
  );
}

/** Zoom steps sent (as Ctrl + wheel) before counting ink; see {@link inkDuringZoom}. */
interface ZoomSteps {
  x: number;
  y: number;
  deltas: number[];
}

/**
 * Dark pixels ("ink") inside a client rect, on the page canvas and the live layer together.
 * Paper, grid lines and the light page shadow are all lighter than the threshold.
 */
function inkIn(page: Page, rect: Rect): Promise<number> {
  return page.evaluate(probeInk, { rect, zoom: null });
}

/**
 * Runs in the browser. Without `zoom`, counts ink in `rect` now. With it, sends each wheel
 * step, waits for the frame to be drawn and counts ink; returns the largest count.
 */
async function probeInk({ rect, zoom }: { rect: Rect; zoom: ZoomSteps | null }): Promise<number> {
  const count = (): number => {
    let total = 0;
    for (const id of ['cv', 'live']) {
      const canvas = document.getElementById(id) as HTMLCanvasElement;
      const box = canvas.getBoundingClientRect();
      const k = canvas.width / box.width;
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;
      const x = Math.round((rect.x - box.left) * k);
      const y = Math.round((rect.y - box.top) * k);
      const data = ctx.getImageData(x, y, Math.round(rect.w * k), Math.round(rect.h * k)).data;
      for (let i = 0; i < data.length; i += 4) {
        const lum = 0.299 * (data[i] ?? 255) + 0.587 * (data[i + 1] ?? 255) + 0.114 * (data[i + 2] ?? 255);
        if ((data[i + 3] ?? 0) > 128 && lum < 140) total++;
      }
    }
    return total;
  };
  if (!zoom) return count();
  const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
  let worst = 0;
  for (const deltaY of zoom.deltas) {
    document.getElementById('cv')?.dispatchEvent(
      new WheelEvent('wheel', {
        clientX: zoom.x,
        clientY: zoom.y,
        deltaY,
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    await frame();
    await frame();
    worst = Math.max(worst, count());
  }
  return worst;
}

/** One wheel event on the page canvas; with `ctrl` it zooms around (x, y) like a pinch. */
function wheel(page: Page, x: number, y: number, deltaY: number, ctrl = false): Promise<void> {
  return page.evaluate(
    ([cx, cy, dy, ctrlKey]) => {
      document.getElementById('cv')?.dispatchEvent(
        new WheelEvent('wheel', {
          clientX: cx,
          clientY: cy,
          deltaY: dy,
          ctrlKey,
          bubbles: true,
          cancelable: true,
        }),
      );
    },
    [x, y, deltaY, ctrl] as const,
  );
}

/** Waits for two animation frames, so a requested render has happened. */
function frames(page: Page): Promise<void> {
  return page.evaluate(
    () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
  );
}

/**
 * Zooms with small Ctrl + wheel steps around (x, y) and, while the zoom is still in progress
 * (the renderer treats wheel zoom as a pinch for 160 ms), counts the ink in `rect` after
 * every frame. Returns the largest count.
 */
function inkDuringZoom(page: Page, x: number, y: number, rect: Rect): Promise<number> {
  return page.evaluate(probeInk, { rect, zoom: { x, y, deltas: [8, 8, -8, -8] } });
}

/** Creates a notebook in the first subject and opens it. */
async function openNewNotebook(page: Page, title: string): Promise<void> {
  await page.goto('./');
  await page.locator('.subject').first().locator('.shelf__add').click();
  await page.fill('#nb-title', title);
  await page.click('.sheet__foot .btn--primary');
  await expect(page.locator('#editor')).toBeVisible();
}

/** Types a text box at a client point with the text tool. */
async function writeText(page: Page, x: number, y: number, text: string): Promise<void> {
  await page.keyboard.press('t');
  await page.mouse.click(x, y);
  await expect(page.locator('#textEd')).toBeVisible();
  await page.keyboard.type(text);
  await page.keyboard.press('Escape');
  await expect(page.locator('#textEd')).toBeHidden();
}

/** Draws a closed lasso loop around a client rect. */
async function lasso(page: Page, r: Rect): Promise<void> {
  await page.keyboard.press('l');
  const corners = [
    [r.x, r.y],
    [r.x + r.w, r.y],
    [r.x + r.w, r.y + r.h],
    [r.x, r.y + r.h],
    [r.x, r.y + 2],
  ];
  await page.mouse.move(r.x, r.y);
  await page.mouse.down();
  for (const [x, y] of corners) await page.mouse.move(x ?? 0, y ?? 0, { steps: 6 });
  await page.mouse.up();
}

/** Drags with the mouse in small steps. */
async function drag(page: Page, x0: number, y0: number, x1: number, y1: number): Promise<void> {
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(x1, y1, { steps: 20 });
  await page.mouse.up();
}

/** Two pages, scrolled so page 1's bottom and page 2's top are both on screen. */
async function showPageBoundary(page: Page, stageTop: number): Promise<void> {
  // Plain mouse wheel: scroll up 300 px from the top of page 2.
  await wheel(page, 640, stageTop + 300, -300);
  await frames(page);
}

/** Opens the pages panel and scrolls to page 2, then closes the panel. */
async function goToPage2(page: Page): Promise<void> {
  await page.click('#btnPages');
  await page.locator('.page-item__thumb').nth(1).click();
  if (await page.locator('#panel').isVisible()) await page.click('#panelClose');
}

test('bug 1: a selection dragged onto the next page lands there', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openNewNotebook(page, 'Move');
  await page.click('#fab');
  await expect.poll(async () => (await storedPages(page, 'Move')).length).toBe(2);
  const stage = await page.locator('#stage').boundingBox();
  if (!stage) throw new Error('no stage');
  await showPageBoundary(page, stage.y);

  // Page 1 ends about 333 px below the stage top, page 2 starts about 378 px below it.
  const a = { x: 300, y: stage.y + 240 };
  await writeText(page, a.x, a.y, 'ЖЖЖЖЖЖ');
  const source: Rect = { x: a.x, y: a.y - 14, w: 120, h: 28 };
  await expect.poll(() => inkIn(page, source)).toBeGreaterThan(50);

  await lasso(page, { x: a.x - 40, y: a.y - 50, w: 760, h: 90 });
  const drop = { x: a.x, y: a.y + 300 };
  await page.mouse.move(a.x + 40, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x + 40, a.y + 150, { steps: 10 });
  // Half way, over the gap: the moving text is visible, not cut off at the page edge.
  expect(await inkIn(page, { ...source, y: source.y + 150 })).toBeGreaterThan(50);
  await page.mouse.move(a.x + 40, a.y + 300, { steps: 10 });
  await page.mouse.up();
  await frames(page);

  const target: Rect = { ...source, y: drop.y - 14 };
  expect(await inkIn(page, target)).toBeGreaterThan(50);
  expect(await inkIn(page, source)).toBe(0);
  await expect.poll(async () => (await storedPages(page, 'Move')).map((p) => p.texts.length)).toEqual([0, 1]);
  const [, page2] = await storedPages(page, 'Move');
  const moved = page2?.texts[0];
  expect(moved?.y).toBeGreaterThan(0);
  expect(moved?.y).toBeLessThan(page2?.h ? (page2.h * 96) / 25.4 : 0);

  // Deselected, the text is part of page 2's bitmap.
  await page.keyboard.press('Escape');
  await frames(page);
  expect(await inkIn(page, target)).toBeGreaterThan(50);

  // One undo step puts it back on page 1, redo moves it again.
  await page.click('#btnUndo');
  await expect.poll(async () => (await storedPages(page, 'Move')).map((p) => p.texts.length)).toEqual([1, 0]);
  await frames(page);
  expect(await inkIn(page, source)).toBeGreaterThan(50);
  expect(await inkIn(page, target)).toBe(0);
  await page.click('#btnRedo');
  await expect.poll(async () => (await storedPages(page, 'Move')).map((p) => p.texts.length)).toEqual([0, 1]);

  await page.reload();
  await page.locator('.notebook-card__title', { hasText: 'Move' }).click();
  await expect(page.locator('#editor')).toBeVisible();
  await goToPage2(page);
  await showPageBoundary(page, stage.y);
  await expect.poll(() => inkIn(page, target)).toBeGreaterThan(50);
  expect(await inkIn(page, source)).toBe(0);
  expect(errors).toEqual([]);
});

test('bug 2: zooming never shows deleted or moved content', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openNewNotebook(page, 'Zoom');
  const stage = await page.locator('#stage').boundingBox();
  if (!stage) throw new Error('no stage');

  // 1. Text written at the normal zoom, then deleted while zoomed in.
  const a = { x: 400, y: stage.y + 300 };
  await writeText(page, a.x, a.y, 'ЖЖЖЖЖЖ');
  await frames(page);
  const anchor = { x: a.x + 30, y: a.y };
  for (let i = 0; i < 3; i++) await wheel(page, anchor.x, anchor.y, -100, true);
  await page.waitForTimeout(300);
  const around: Rect = { x: anchor.x - 40, y: anchor.y - 40, w: 80, h: 80 };
  await expect.poll(() => inkIn(page, around)).toBeGreaterThan(200);

  await page.mouse.click(anchor.x, anchor.y);
  await expect(page.locator('#textEd')).toBeVisible();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Escape');
  await expect(page.locator('#textEd')).toBeHidden();
  await page.waitForTimeout(300);
  expect(await inkIn(page, around)).toBe(0);
  expect(await inkDuringZoom(page, anchor.x, anchor.y, around)).toBe(0);

  // 2. A stroke written at the normal zoom, then moved with the lasso while zoomed in.
  await page.click('#btnZoom');
  await page.waitForTimeout(300);
  await page.keyboard.press('p');
  await drag(page, a.x, a.y, a.x + 40, a.y + 10);
  await frames(page);
  for (let i = 0; i < 3; i++) await wheel(page, a.x + 20, a.y + 5, -100, true);
  await page.waitForTimeout(300);
  const old: Rect = { x: a.x - 60, y: a.y - 40, w: 160, h: 80 };
  await expect.poll(() => inkIn(page, old)).toBeGreaterThan(50);
  await lasso(page, { x: a.x - 160, y: a.y - 120, w: 400, h: 240 });
  await drag(page, a.x + 20, a.y + 5, a.x + 20, a.y + 265);
  await page.waitForTimeout(300);
  expect(await inkIn(page, old)).toBe(0);
  expect(await inkIn(page, { ...old, y: old.y + 260 })).toBeGreaterThan(50);
  expect(await inkDuringZoom(page, a.x + 20, a.y + 5, old)).toBe(0);
  expect(errors).toEqual([]);
});

test('bug 1: text lost below its page by older versions comes back on open', async ({ page }) => {
  await openNewNotebook(page, 'Lost');
  await page.click('#btnBack');
  // What the old drag left behind: a text on page 1, 200 px below its bottom edge.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const req = indexedDB.open('konspektnik', 1);
        req.onsuccess = () => {
          const tx = req.result.transaction(['notebooks', 'pages'], 'readwrite');
          const nbs = tx.objectStore('notebooks').getAll();
          nbs.onsuccess = () => {
            const nb = (nbs.result as { title: string; pageIds: string[] }[]).find((n) => n.title === 'Lost');
            const store = tx.objectStore('pages');
            const get = store.get(nb?.pageIds[0] ?? '');
            get.onsuccess = () => {
              const record = get.result as { texts: unknown[] };
              record.texts = [{ id: 'lost1', x: 80, y: 1323, w: 300, t: 'ЖЖЖЖ', fs: 18, c: '#16181D' }];
              store.put(record);
            };
          };
          tx.oncomplete = () => resolve();
        };
      }),
  );
  await page.locator('.notebook-card__title', { hasText: 'Lost' }).click();
  await expect(page.locator('#editor')).toBeVisible();
  await expect
    .poll(async () => {
      const [first] = await storedPages(page, 'Lost');
      const text = first?.texts[0];
      return !!first && !!text && text.y > 0 && text.y < (first.h * 96) / 25.4;
    })
    .toBe(true);
  await page.click('#btnEdMore');
  await page.click('.menu__item:has-text("Рисовать пальцем")', { button: 'right' });
  await expect(page.locator('#inputDiag')).toContainText('Возвращено на страницу объектов за её краем: 1');
});
