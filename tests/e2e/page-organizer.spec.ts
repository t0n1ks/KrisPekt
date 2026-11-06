import { expect, test, type Locator, type Page } from '@playwright/test';
import { exportDownload } from './downloads';
import { pdfInfo, servePdfJs } from './pdf-view';

interface StoredNotebook {
  title: string;
  pageIds: string[];
}

interface StoredPage {
  id: string;
  texts: { t: string }[];
  strokes: unknown[];
  images: { blob: string }[];
  bgBlob: string | null;
  w: number;
  h: number;
  locked: boolean;
}

/** The notebook's stored pages, in their stored order. */
function storedOrder(page: Page, title: string): Promise<StoredPage[]> {
  return page.evaluate(
    (nbTitle) =>
      new Promise<StoredPage[]>((resolve) => {
        const req = indexedDB.open('konspektnik', 1);
        req.onsuccess = () => {
          const tx = req.result.transaction(['notebooks', 'pages']);
          const nbs = tx.objectStore('notebooks').getAll();
          const all = tx.objectStore('pages').getAll();
          tx.oncomplete = () => {
            const nb = (nbs.result as StoredNotebook[]).find((n) => n.title === nbTitle);
            const rows = all.result as StoredPage[];
            resolve((nb?.pageIds ?? []).flatMap((id) => rows.filter((r) => r.id === id)));
          };
        };
      }),
    title,
  );
}

/** Text labels of stored pages in order; a page without text shows as "". */
async function labels(page: Page, title: string): Promise<string[]> {
  return (await storedOrder(page, title)).map((p) => p.texts[0]?.t ?? '');
}

/** Creates a closed notebook whose pages each carry one text: its label. */
async function seedNotebook(
  page: Page,
  title: string,
  pageLabels: readonly string[],
  extra: { blobOn?: string } = {},
): Promise<void> {
  await page.goto('./');
  await page.locator('.subject').first().locator('.shelf__add').click();
  await page.fill('#nb-title', title);
  await page.click('.sheet__foot .btn--primary');
  await expect(page.locator('#editor')).toBeVisible();
  await page.click('#btnBack');
  await expect(page.locator('#editor')).toBeHidden();
  await page.evaluate(
    ([nbTitle, list, blobOn]) =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('konspektnik', 1);
        req.onsuccess = () => {
          const tx = req.result.transaction(['notebooks', 'pages', 'blobs'], 'readwrite');
          const nbs = tx.objectStore('notebooks').getAll();
          nbs.onsuccess = () => {
            const nb = (nbs.result as (StoredNotebook & { id: string })[]).find((n) => n.title === nbTitle);
            if (!nb) throw new Error('no notebook');
            const pages = list.map((label, i) => ({
              id: 'seed' + i,
              nbId: nb.id,
              w: 210,
              h: 297,
              locked: true,
              bg: 'plain',
              bgBlob: null,
              strokes: [],
              texts: [{ id: 'txt' + i, x: 60, y: 120, w: 500, t: label, fs: 72, c: '#101010' }],
              images:
                label === blobOn ? [{ id: 'img' + i, x: 60, y: 300, w: 200, h: 200, blob: 'seedblob' }] : [],
              updatedAt: 1,
            }));
            const store = tx.objectStore('pages');
            for (const p of pages) store.put(p);
            for (const old of nb.pageIds) store.delete(old);
            nb.pageIds = pages.map((p) => p.id);
            tx.objectStore('notebooks').put(nb);
            if (blobOn) {
              tx.objectStore('blobs').put({ id: 'seedblob', blob: new Blob(['x'], { type: 'image/png' }) });
            }
          };
          tx.oncomplete = () => resolve();
          tx.onabort = () => reject(new Error('seed failed'));
        };
      }),
    [title, pageLabels, extra.blobOn ?? ''] as const,
  );
  // The running app keeps the notebook in memory, so it must read the seeded order afresh.
  await page.reload();
}

async function openNotebook(page: Page, title: string): Promise<void> {
  await page.locator('.notebook-card__title', { hasText: title }).click();
  await expect(page.locator('#editor')).toBeVisible();
}

const thumb = (page: Page, index: number): Locator => page.locator('.page-item__thumb').nth(index);
const cell = (page: Page, index: number): Locator => page.locator('.page-item').nth(index);
const menuItem = (page: Page, label: string): Locator => page.locator('.menu__item', { hasText: label });

async function openOrganizer(page: Page): Promise<void> {
  await page.click('#btnPages');
  await expect(page.locator('#panel')).toBeVisible();
  await expect(page.locator('.page-item__canvas').first()).toBeVisible();
}

async function pageMenu(page: Page, index: number, label: string): Promise<void> {
  await cell(page, index).locator('.page-item__more').click();
  await menuItem(page, label).click();
}

/** Drags a thumbnail with the mouse so it lands just before thumbnail `gap`. */
async function mouseDrag(page: Page, from: number, gap: number): Promise<void> {
  const source = await thumb(page, from).boundingBox();
  const target = await cell(page, gap).boundingBox();
  if (!source || !target) throw new Error('no thumbnail');
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + 2, target.y + target.height / 2, { steps: 8 });
  await expect(page.locator('.pages-panel__drop')).toBeVisible();
  await page.mouse.up();
}

test('organizer: insert, draw, reorder, duplicate, delete, undo, reload', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await seedNotebook(page, 'Org', ['A', 'B', 'C', 'D']);
  await openNotebook(page, 'Org');
  await openOrganizer(page);
  await expect(page.locator('#panelTitle')).toContainText('4');

  // Insert in the middle, with "+", then draw on the new page.
  await cell(page, 2).locator('.page-item__insert').click();
  await expect(page.locator('.page-item')).toHaveCount(5);
  await thumb(page, 2).click();
  await expect(page.locator('#panel')).toBeHidden();
  await expect(page.locator('#btnPages')).toContainText('3/5');
  const stage = await page.locator('#stage').boundingBox();
  if (!stage) throw new Error('no stage');
  await page.mouse.move(stage.x + stage.width / 2 - 60, stage.y + 300);
  await page.mouse.down();
  await page.mouse.move(stage.x + stage.width / 2 + 60, stage.y + 340, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await storedOrder(page, 'Org'))[2]?.strokes.length).toBe(1);
  expect(await labels(page, 'Org')).toEqual(['A', 'B', '', 'C', 'D']);

  // The thumbnail shows the new stroke when the organizer opens again.
  await openOrganizer(page);
  await expect(cell(page, 2)).toHaveClass(/page-item--active/);
  await expect
    .poll(() =>
      cell(page, 2)
        .locator('canvas')
        .evaluate((node) => {
          const canvas = node as HTMLCanvasElement;
          const ctx = canvas.getContext('2d');
          if (!ctx) return 0;
          const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
          let inked = 0;
          for (let i = 0; i < data.length; i += 4) if ((data[i] ?? 0) < 200) inked++;
          return inked;
        }),
    )
    .toBeGreaterThan(0);

  // Reorder by drag: D lands before B.
  await mouseDrag(page, 4, 1);
  await expect.poll(() => labels(page, 'Org')).toEqual(['A', 'D', 'B', '', 'C']);

  // Dropping outside the list, and Escape, change nothing.
  const source = await thumb(page, 0).boundingBox();
  const head = await page.locator('.pages-panel__head').boundingBox();
  if (!source || !head) throw new Error('no layout');
  await page.mouse.move(source.x + 40, source.y + 40);
  await page.mouse.down();
  await page.mouse.move(head.x + 200, head.y + 10, { steps: 6 });
  await page.mouse.up();
  await page.mouse.move(source.x + 40, source.y + 40);
  await page.mouse.down();
  await page.mouse.move(source.x + 300, source.y + 40, { steps: 6 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(page.locator('#panel')).toBeVisible();
  expect(await labels(page, 'Org')).toEqual(['A', 'D', 'B', '', 'C']);

  // Reorder by menu; the moved page keeps its number in the grid.
  await pageMenu(page, 0, 'Переместить позже');
  await expect.poll(() => labels(page, 'Org')).toEqual(['D', 'A', 'B', '', 'C']);
  await cell(page, 0).locator('.page-item__more').click();
  await expect(menuItem(page, 'Переместить раньше')).toBeDisabled();
  await page.keyboard.press('Escape');
  await pageMenu(page, 4, 'Переместить в начало');
  await expect.poll(() => labels(page, 'Org')).toEqual(['C', 'D', 'A', 'B', '']);

  // Duplicate: the copy comes right after the original.
  await pageMenu(page, 2, 'Дублировать');
  await expect.poll(() => labels(page, 'Org')).toEqual(['C', 'D', 'A', 'A', 'B', '']);
  await page.waitForTimeout(100);
  await openOrganizerIfClosed(page);

  // Delete two pages in selection mode, then Undo.
  await page.click('#panelSelect');
  await expect(page.locator('#panelDelete')).toBeDisabled();
  await thumb(page, 0).click();
  await thumb(page, 4).click();
  await expect(page.locator('#panelSelCount')).toContainText('2');
  await page.click('#panelDelete');
  await expect(page.locator('.sheet')).toContainText('Будет удалено: 2 страницы');
  await page.locator('.sheet__foot .btn--danger').click();
  await expect(page.locator('.snackbar')).toContainText('Удалено: 2 страницы');
  await expect.poll(() => labels(page, 'Org')).toEqual(['D', 'A', 'A', '']);
  await page.locator('.snackbar__action').click();
  await expect.poll(() => labels(page, 'Org')).toEqual(['C', 'D', 'A', 'A', 'B', '']);
  await expect(page.locator('.page-item')).toHaveCount(6);

  // Everything survives a restart, with the drawn stroke on its page.
  await page.reload();
  await openNotebook(page, 'Org');
  await expect(page.locator('#btnPages')).toContainText('/6');
  expect((await storedOrder(page, 'Org')).map((p) => p.strokes.length)).toEqual([0, 0, 0, 0, 0, 1]);
  await openOrganizer(page);
  await expect(page.locator('.page-item')).toHaveCount(6);
  expect(errors).toEqual([]);
});

/** Duplicating scrolls to the copy behind the organizer, which stays open. */
async function openOrganizerIfClosed(page: Page): Promise<void> {
  if (!(await page.locator('#panel').isVisible())) await openOrganizer(page);
}

test('the last page cannot be deleted', async ({ page }) => {
  await seedNotebook(page, 'One', ['A', 'B']);
  await openNotebook(page, 'One');
  await openOrganizer(page);
  await page.click('#panelSelect');
  await thumb(page, 0).click();
  await thumb(page, 1).click();
  await page.click('#panelDelete');
  await expect(page.locator('.sheet')).toHaveCount(0);
  await expect(page.locator('.toast')).toBeVisible();
  expect(await labels(page, 'One')).toEqual(['A', 'B']);
});

test('export follows the new order', async ({ page }) => {
  await servePdfJs(page);
  await seedNotebook(page, 'Exp', ['AAAA', 'BBBB', 'CCCC']);
  await openNotebook(page, 'Exp');
  await openOrganizer(page);
  await pageMenu(page, 2, 'Переместить в начало');
  await expect.poll(() => labels(page, 'Exp')).toEqual(['CCCC', 'AAAA', 'BBBB']);
  await page.click('#panelClose');
  await page.click('#btnBack');
  await expect(page.locator('#editor')).toBeHidden();
  const card = page.locator('.notebook-card', {
    has: page.locator('.notebook-card__title', { hasText: 'Exp' }),
  });
  await card.locator('button[aria-haspopup], .notebook-card__more, .icon-btn').first().click();
  await page.getByText('Экспорт…').first().click();
  await page.locator('.sheet').getByText('PDF (вектор').click();
  const download = exportDownload(page);
  await page.locator('.sheet__foot .btn--primary').click();
  const file = await download;
  const path = await file.path();
  const { readFileSync } = await import('node:fs');
  const info = await pdfInfo(page, readFileSync(path));
  expect(info.pages).toBe(3);
  expect(info.text.replace(/\s/g, '')).toBe('CCCCAAAABBBB');
});

test('images of deleted pages go after the undo window, or at the next start', async ({ page }) => {
  const blobExists = (): Promise<boolean> =>
    page.evaluate(
      () =>
        new Promise<boolean>((resolve) => {
          const req = indexedDB.open('konspektnik', 1);
          req.onsuccess = () => {
            const get = req.result.transaction('blobs').objectStore('blobs').getKey('seedblob');
            get.onsuccess = () => resolve(get.result !== undefined);
          };
        }),
    );
  await seedNotebook(page, 'Blobs', ['A', 'B'], { blobOn: 'B' });
  await openNotebook(page, 'Blobs');
  await openOrganizer(page);
  await pageMenu(page, 1, 'Удалить страницу');
  await page.locator('.sheet__foot .btn--danger').click();
  await expect(page.locator('.snackbar')).toBeVisible();
  await expect.poll(() => labels(page, 'Blobs')).toEqual(['A']);
  expect(await blobExists()).toBe(true);

  // The app closes during the undo window: the next start cleans up.
  await page.reload();
  await expect(page.locator('.notebook-card__title', { hasText: 'Blobs' })).toBeVisible();
  await expect.poll(blobExists, { timeout: 10_000 }).toBe(false);
});

test('a notebook of 220 pages opens smoothly and paints only what is near the screen', async ({ page }) => {
  await seedNotebook(
    page,
    'Long',
    Array.from({ length: 220 }, (_, i) => 'P' + i),
  );
  await openNotebook(page, 'Long');
  const started = Date.now();
  await openOrganizer(page);
  expect(Date.now() - started).toBeLessThan(3000);
  await expect(page.locator('.page-item')).toHaveCount(220);
  await page.waitForTimeout(500);
  const painted = await page.locator('.page-item__canvas').count();
  expect(painted).toBeGreaterThan(0);
  expect(painted).toBeLessThan(80);

  // Scrolling paints the pages that come into view, and memory stays bounded.
  const list = page.locator('#plist');
  const frames = await list.evaluate(async (node) => {
    const times: number[] = [];
    let last = performance.now();
    for (let i = 0; i < 90; i++) {
      node.scrollTop += 220;
      await new Promise((r) => requestAnimationFrame(r));
      const t = performance.now();
      times.push(t - last);
      last = t;
    }
    return times.sort((a, b) => a - b);
  });
  expect(frames[Math.floor(frames.length * 0.95)]).toBeLessThan(120);
  await page.waitForTimeout(400);
  expect(await page.locator('.page-item__canvas').count()).toBeLessThan(80);
  const last = await page
    .locator('.page-item')
    .evaluateAll((nodes) =>
      nodes.findIndex((n) => n.getBoundingClientRect().top > 0 && !!n.querySelector('canvas')),
    );
  expect(last).toBeGreaterThan(20);

  // Moving a page across the whole notebook keeps the order of all the others.
  await pageMenu(page, 219, 'Переместить в начало');
  await expect.poll(async () => (await labels(page, 'Long'))[0]).toBe('P219');
  expect(await labels(page, 'Long')).toHaveLength(220);
});

test('thumbnails of pages with images settle, even with more images than the cache holds', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = CanvasRenderingContext2D.prototype.drawImage;
    const counter = window as unknown as { drawn: number };
    counter.drawn = 0;
    CanvasRenderingContext2D.prototype.drawImage = function (
      this: CanvasRenderingContext2D,
      ...args: never[]
    ) {
      counter.drawn++;
      return (original as (...a: never[]) => void).apply(this, args);
    } as typeof original;
  });
  await seedNotebook(page, 'Pics', ['A', 'B']);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 4;
        canvas.toBlob((png) => {
          const req = indexedDB.open('konspektnik', 1);
          req.onsuccess = () => {
            const tx = req.result.transaction(['notebooks', 'pages', 'blobs'], 'readwrite');
            const nbs = tx.objectStore('notebooks').getAll();
            nbs.onsuccess = () => {
              const nb = (nbs.result as (StoredNotebook & { id: string })[]).find((n) => n.title === 'Pics');
              if (!nb) throw new Error('no notebook');
              nb.pageIds = [];
              for (let i = 0; i < 24; i++) {
                const id = 'pic' + i;
                nb.pageIds.push(id);
                tx.objectStore('blobs').put({ id: 'blob' + i, blob: png });
                tx.objectStore('pages').put({
                  id,
                  nbId: nb.id,
                  w: 210,
                  h: 297,
                  locked: true,
                  bg: 'plain',
                  bgBlob: 'blob' + i,
                  strokes: [],
                  texts: [],
                  images: [],
                  updatedAt: 1,
                });
              }
              tx.objectStore('notebooks').put(nb);
            };
            tx.oncomplete = () => resolve();
          };
        });
      }),
  );
  await page.reload();
  await openNotebook(page, 'Pics');
  await openOrganizer(page);
  await expect(page.locator('.page-item')).toHaveCount(26);
  await page.waitForTimeout(1500);
  const read = (): Promise<number> => page.evaluate(() => (window as unknown as { drawn: number }).drawn);
  const settled = await read();
  expect(settled).toBeGreaterThan(0);
  await page.waitForTimeout(1000);
  expect(await read()).toBe(settled);
});

test('dragging near the bottom edge scrolls the list', async ({ page }) => {
  await seedNotebook(
    page,
    'Edge',
    Array.from({ length: 60 }, (_, i) => 'E' + i),
  );
  await openNotebook(page, 'Edge');
  await openOrganizer(page);
  const box = await thumb(page, 0).boundingBox();
  const list = await page.locator('#plist').boundingBox();
  if (!box || !list) throw new Error('no layout');
  await page.mouse.move(box.x + 40, box.y + 40);
  await page.mouse.down();
  await page.mouse.move(box.x + 40, list.y + list.height - 8, { steps: 6 });
  await expect.poll(() => page.locator('#plist').evaluate((n) => n.scrollTop)).toBeGreaterThan(200);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect((await labels(page, 'Edge'))[0]).toBe('E0');
});

test('a stylus picks a page up with a long press too', async ({ page }) => {
  await seedNotebook(page, 'Pen', ['A', 'B', 'C']);
  await openNotebook(page, 'Pen');
  await openOrganizer(page);
  const cdp = await page.context().newCDPSession(page);
  const source = await thumb(page, 0).boundingBox();
  const target = await cell(page, 2).boundingBox();
  if (!source || !target) throw new Error('no layout');
  const pen = (type: string, x: number, y: number, buttons = 1): Promise<unknown> =>
    cdp.send('Input.dispatchMouseEvent', {
      type: type as 'mouseMoved',
      x,
      y,
      button: 'left',
      buttons,
      clickCount: 1,
      pointerType: 'pen',
    });
  await pen('mouseMoved', source.x + 40, source.y + 40, 0);
  await pen('mousePressed', source.x + 40, source.y + 40);
  await page.waitForTimeout(650);
  await pen('mouseMoved', target.x + 20, target.y + 40);
  await pen('mouseMoved', target.x + 2, target.y + 40);
  await expect(page.locator('.pages-panel__drop')).toBeVisible();
  await pen('mouseReleased', target.x + 2, target.y + 40, 0);
  await expect.poll(() => labels(page, 'Pen')).toEqual(['B', 'A', 'C']);
  await expect(page.locator('#panel')).toBeVisible();
});

test.describe('touch', () => {
  test.use({ hasTouch: true });

  interface Finger {
    start(x: number, y: number): Promise<void>;
    moveTo(x: number, y: number): Promise<void>;
    end(): Promise<void>;
  }

  async function finger(page: Page): Promise<Finger> {
    const cdp = await page.context().newCDPSession(page);
    let at = { x: 0, y: 0 };
    return {
      start: async (x, y) => {
        at = { x, y };
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      },
      moveTo: async (x, y) => {
        const from = at;
        for (let step = 1; step <= 10; step++) {
          const point = { x: from.x + ((x - from.x) * step) / 10, y: from.y + ((y - from.y) * step) / 10 };
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point] });
          await page.waitForTimeout(16);
        }
        at = { x, y };
      },
      end: async () => {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      },
    };
  }

  /** Waits until the list of thumbnails has kept its position for a moment. */
  async function listAtRest(page: Page): Promise<void> {
    let last = -1;
    await expect
      .poll(
        async () => {
          const top = await page.locator('#plist').evaluate((n) => n.scrollTop);
          const resting = top === last;
          last = top;
          return resting;
        },
        { intervals: [200] },
      )
      .toBe(true);
  }

  test('a long press picks a page up, a swipe scrolls, a still long press opens the menu', async ({
    page,
  }) => {
    await seedNotebook(
      page,
      'Touch',
      Array.from({ length: 30 }, (_, i) => 'T' + i),
    );
    await openNotebook(page, 'Touch');
    await openOrganizer(page);
    const touch = await finger(page);
    const before = await labels(page, 'Touch');

    // A long press on the first page, then a drag to just before the third.
    const source = await thumb(page, 0).boundingBox();
    const target = await cell(page, 2).boundingBox();
    if (!source || !target) throw new Error('no layout');
    await touch.start(source.x + 60, source.y + 80);
    await page.waitForTimeout(650);
    await touch.moveTo(target.x + 2, target.y + 80);
    await expect(page.locator('.pages-panel__drop')).toBeVisible();
    await touch.end();
    await expect
      .poll(async () => (await labels(page, 'Touch')).slice(0, 3))
      .toEqual([before[1], before[0], before[2]]);
    await expect(page.locator('#panel')).toBeVisible();

    // A swipe does not reorder; it scrolls.
    const scrollBefore = await page.locator('#plist').evaluate((n) => n.scrollTop);
    const box = await thumb(page, 8).boundingBox();
    if (!box) throw new Error('no layout');
    await touch.start(box.x + 60, box.y + 150);
    await touch.moveTo(box.x + 60, box.y - 150);
    await touch.end();
    await expect
      .poll(() => page.locator('#plist').evaluate((n) => n.scrollTop))
      .toBeGreaterThan(scrollBefore);
    expect((await labels(page, 'Touch')).slice(0, 3)).toEqual([before[1], before[0], before[2]]);

    // A long press without moving opens the page's menu. A finger landing on a list that is still
    // gliding from the swipe stops the glide instead of pressing a page, so wait for it to rest.
    await thumb(page, 8).scrollIntoViewIfNeeded();
    await listAtRest(page);
    const still = await thumb(page, 8).boundingBox();
    if (!still) throw new Error('no layout');
    await touch.start(still.x + 60, still.y + 60);
    await page.waitForTimeout(650);
    await touch.end();
    await expect(menuItem(page, 'Дублировать')).toBeVisible();
  });

  test('a still long press near the edge of the list does not scroll it', async ({ page }) => {
    await seedNotebook(
      page,
      'Edge',
      Array.from({ length: 30 }, (_, i) => 'E' + i),
    );
    await openNotebook(page, 'Edge');
    await openOrganizer(page);
    const touch = await finger(page);
    await page.locator('#plist').evaluate((list) => (list.scrollTop = 400));
    const box = await page.locator('#plist').boundingBox();
    if (!box) throw new Error('no layout');
    await touch.start(box.x + box.width / 2, box.y + 12);
    await page.waitForTimeout(650);
    const scrolled = await page.locator('#plist').evaluate((list) => list.scrollTop);
    await touch.end();
    expect(scrolled).toBe(400);
  });
});

test('the tap that ends a long press cannot choose from the menu it opened', async ({ page }) => {
  await seedNotebook(page, 'Stray', ['A', 'B']);
  await openNotebook(page, 'Stray');
  await openOrganizer(page);
  await thumb(page, 0).click({ button: 'right' });
  const item = menuItem(page, 'Дублировать');
  await expect(item).toBeVisible();
  // What a browser may send after lifting a finger: a click with no press on the menu before it.
  await item.evaluate((node) => node.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 })));
  await expect(item).toBeVisible();
  expect(await labels(page, 'Stray')).toHaveLength(2);
  // A real tap on the menu still works.
  await item.click();
  await expect.poll(async () => (await labels(page, 'Stray')).length).toBe(3);
});
