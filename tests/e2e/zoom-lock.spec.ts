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

/** Sets a page's size straight in IndexedDB (the editor must be closed). */
function resizeStoredPage(page: Page, title: string, index: number, w: number, h: number): Promise<void> {
  return page.evaluate(
    ([nbTitle, i, width, height]) =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('konspektnik', 1);
        req.onsuccess = () => {
          const tx = req.result.transaction(['notebooks', 'pages'], 'readwrite');
          const nbs = tx.objectStore('notebooks').getAll();
          nbs.onsuccess = () => {
            const nb = (nbs.result as { title: string; pageIds: string[] }[]).find(
              (n) => n.title === nbTitle,
            );
            const store = tx.objectStore('pages');
            const get = store.get(nb?.pageIds[i] ?? '');
            get.onsuccess = () =>
              store.put({ ...(get.result as object), w: width, h: height, locked: false });
          };
          tx.oncomplete = () => resolve();
          tx.onabort = () => reject(new Error('resize failed'));
        };
      }),
    [title, index, w, h] as const,
  );
}

function storedZoomLock(page: Page, title: string): Promise<number | undefined> {
  return page.evaluate(
    (nbTitle) =>
      new Promise<number | undefined>((resolve) => {
        const req = indexedDB.open('konspektnik', 1);
        req.onsuccess = () => {
          const all = req.result.transaction('notebooks').objectStore('notebooks').getAll();
          all.onsuccess = () => {
            const rows = all.result as { title: string; zoomLock?: number }[];
            resolve(rows.find((n) => n.title === nbTitle)?.zoomLock);
          };
        };
      }),
    title,
  );
}

type TwoPoints = [[number, number], [number, number]];

/** A real two-finger gesture, sent through the browser's touch pipeline. */
async function twoFingers(page: Page, from: TwoPoints, to: TwoPoints): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const points = (t: number): { id: number; x: number; y: number }[] =>
    from.map(([x, y], i) => ({
      id: i,
      x: x + ((to[i]?.[0] ?? x) - x) * t,
      y: y + ((to[i]?.[1] ?? y) - y) * t,
    }));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(0) });
  for (let step = 1; step <= 12; step++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points(step / 12) });
    await page.waitForTimeout(20);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(100);
}

/** Spreads two fingers apart in the middle of the page. */
const pinchOut = (page: Page): Promise<void> =>
  twoFingers(
    page,
    [
      [600, 400],
      [700, 400],
    ],
    [
      [450, 400],
      [850, 400],
    ],
  );

const menuItem = (page: Page, label: string) => page.locator('.menu__item', { hasText: label });

async function setLock(page: Page, label: 'Закрепить масштаб' | 'Открепить масштаб'): Promise<void> {
  await page.click('#btnZoom');
  await menuItem(page, label).click();
}

test.describe('zoom lock', () => {
  test.use({ hasTouch: true });

  test('holds through scrolling, page sizes, pinch, Ctrl + wheel, resize and restart', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await openNewNotebook(page, 'Locked');
    for (let i = 0; i < 3; i++) await page.click('#fab');
    await page.click('#btnBack');
    await expect(page.locator('#editor')).toBeHidden();
    await resizeStoredPage(page, 'Locked', 2, 297, 210);
    await openExisting(page, 'Locked');

    // A non-default zoom, locked.
    await expect(zoomPill(page)).toHaveText(/%/);
    const fitted = await zoomPill(page).innerText();
    await ctrlWheel(page, -40);
    await expect(zoomPill(page)).not.toHaveText(fitted);
    await setLock(page, 'Закрепить масштаб');
    await expect(zoomPill(page).locator('svg')).toBeVisible();
    const locked = await zoomPill(page).innerText();
    await expect.poll(() => storedZoomLock(page, 'Locked')).toBeDefined();
    const exact = await storedZoomLock(page, 'Locked');

    // Through every page, including the one with another size.
    await page.mouse.move(640, 400);
    await page.mouse.wheel(0, -100000);
    await expect(page.locator('#btnPages')).toContainText('1/4');
    const seen = new Set<string>();
    for (let i = 0; i < 60 && !seen.has('4/4'); i++) {
      await page.mouse.wheel(i % 2 ? 40 : -10, 200);
      await page.waitForTimeout(32);
      seen.add(await page.locator('#btnPages').innerText());
      await expect(zoomPill(page)).toHaveText(locked);
    }
    expect(seen).toContain('3/4');
    expect(seen).toContain('4/4');

    // A pinch only scrolls, and says why it did not zoom.
    await pinchOut(page);
    await expect(zoomPill(page)).toHaveText(locked);
    await expect(page.getByText(`Масштаб закреплён: ${locked}`)).toBeVisible();

    // Two fingers still scroll: back to the first page.
    await page.mouse.wheel(0, -100000);
    await expect(page.locator('#btnPages')).toContainText('1/4');
    for (let i = 0; i < 6; i++) {
      await twoFingers(
        page,
        [
          [600, 650],
          [720, 650],
        ],
        [
          [600, 100],
          [720, 100],
        ],
      );
    }
    await expect(page.locator('#btnPages')).not.toContainText('1/4');
    await expect(zoomPill(page)).toHaveText(locked);

    // Ctrl + wheel, and a window resize.
    await ctrlWheel(page, -200);
    await page.setViewportSize({ width: 900, height: 1100 });
    await page.waitForTimeout(100);
    await expect(zoomPill(page)).toHaveText(locked);
    await page.setViewportSize({ width: 1280, height: 720 });

    // The presets wait for an explicit unlock.
    await page.click('#btnZoom');
    await expect(menuItem(page, 'Вписать по ширине')).toBeDisabled();
    await expect(menuItem(page, 'Сейчас')).toContainText(locked);
    await page.locator('#btnEdMore').click();
    await expect(menuItem(page, 'Открепить масштаб')).toBeVisible();
    await page.keyboard.press('Escape');

    // App restart.
    await page.reload();
    await openExisting(page, 'Locked');
    await expect(zoomPill(page)).toHaveText(locked);
    await expect(zoomPill(page).locator('svg')).toBeVisible();
    expect(await storedZoomLock(page, 'Locked')).toBe(exact);
    await pinchOut(page);
    await expect(zoomPill(page)).toHaveText(locked);

    // Unlocked: the pinch works again and the record forgets the lock.
    await setLock(page, 'Открепить масштаб');
    await expect(zoomPill(page).locator('svg')).toHaveCount(0);
    await pinchOut(page);
    await expect(zoomPill(page)).not.toHaveText(locked);
    await expect.poll(() => storedZoomLock(page, 'Locked')).toBeUndefined();
    expect(errors).toEqual([]);
  });

  test('the lock belongs to one notebook, and the presets work when unlocked', async ({ page }) => {
    await openNewNotebook(page, 'First');
    await page.click('#btnZoom');
    await menuItem(page, '100%').click();
    await expect(zoomPill(page)).toHaveText('100%');
    await setLock(page, 'Закрепить масштаб');
    await page.click('#btnBack');

    await page.locator('.subject').first().locator('.shelf__add').click();
    await page.fill('#nb-title', 'Second');
    await page.click('.sheet__foot .btn--primary');
    await expect(page.locator('#editor')).toBeVisible();
    await expect(zoomPill(page).locator('svg')).toHaveCount(0);
    await ctrlWheel(page, -60);
    await expect(zoomPill(page)).not.toHaveText('100%');
    await page.click('#btnZoom');
    await menuItem(page, 'Вписать по ширине').click();
    await page.click('#btnBack');

    await openExisting(page, 'First');
    await expect(zoomPill(page)).toHaveText('100%');
    await expect(zoomPill(page).locator('svg')).toBeVisible();
  });
});
