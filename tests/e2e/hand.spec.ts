import { expect, test, type Page } from '@playwright/test';
import { dragWith, pointer, tapWith, type Spot } from './pointers';

const VIEW = { width: 1200, height: 900 };
const NOTEBOOK = 'Hand';
/** A held finger: longer than `HAND_HOLD_MS`, shorter than a long press. */
const HOLD_MS = 320;
/** Long enough for a writing session to be over, after a stylus was used. */
const SESSION_MS = 1600;

interface StoredPage {
  id: string;
  strokes: unknown[];
  texts: { id: string; x: number; y: number; t: string }[];
  images: { id: string; x: number; y: number }[];
  cards: { id: string; y: number; kind: string }[];
}

function storedPages(page: Page): Promise<StoredPage[]> {
  return page.evaluate(
    (title) =>
      new Promise<StoredPage[]>((resolve, reject) => {
        const req = indexedDB.open('konspektnik');
        req.onerror = () => reject(new Error('no database'));
        req.onsuccess = () => {
          const tx = req.result.transaction(['notebooks', 'pages']);
          const notebooks = tx.objectStore('notebooks').getAll();
          const pages = tx.objectStore('pages').getAll();
          tx.oncomplete = () => {
            req.result.close();
            const nb = (notebooks.result as { title: string; pageIds: string[] }[]).find(
              (n) => n.title === title,
            );
            const rows = pages.result as StoredPage[];
            resolve((nb?.pageIds ?? []).flatMap((id) => rows.filter((row) => row.id === id)));
          };
        };
      }),
    NOTEBOOK,
  );
}

async function at(page: Page, fx: number, fy: number): Promise<Spot> {
  const box = await page.locator('#stage').boundingBox();
  if (!box) throw new Error('no stage');
  return { x: box.x + box.width * fx, y: box.y + box.height * fy };
}

/** Sets the preferences before the app reads them, then opens a new notebook. */
async function open(page: Page, prefs: Record<string, unknown> = { fingerDraw: false }): Promise<void> {
  await page.setViewportSize(VIEW);
  await page.addInitScript(
    (stored) => {
      if (!localStorage.getItem('konspektnik.prefs.v1')) {
        localStorage.setItem('konspektnik.prefs.v1', JSON.stringify(stored));
      }
    },
    { seeded: false, ...prefs },
  );
  await page.goto('./');
  await page.locator('.subject').first().locator('.shelf__add').click();
  await page.fill('#nb-title', NOTEBOOK);
  await page.click('.sheet__foot .btn--primary');
  await expect(page.locator('#editor')).toBeVisible();
  await page.locator('#tray [data-tool="pen"]').waitFor();
}

async function typeText(page: Page, spot: Spot, text: string): Promise<void> {
  await page.keyboard.press('t');
  await page.mouse.click(spot.x, spot.y);
  await expect(page.locator('#textEd')).toBeVisible();
  await page.keyboard.type(text);
  await page.keyboard.press('Escape');
  await expect(page.locator('#textEd')).toBeHidden();
  await expect.poll(async () => (await storedPages(page))[0]?.texts.at(-1)?.t).toBe(text);
}

/** A text box whose whole word is a link to an address. */
async function webLinkWord(page: Page, spot: Spot): Promise<Spot> {
  await page.keyboard.press('t');
  await page.mouse.click(spot.x, spot.y);
  await page.keyboard.type('hello');
  await page.keyboard.press('Control+A');
  await page.locator('.text-bar__button[aria-label="Вставить ссылку"]').click();
  await page.fill('#linkUrl', 'example.org');
  await page.click('.sheet__foot .btn--primary');
  await expect(page.locator('[data-href="https://example.org/"]')).toHaveText('hello');
  await page.keyboard.press('Escape');
  await expect(page.locator('#textEd')).toBeHidden();
  await expect.poll(async () => (await storedPages(page))[0]?.texts.length).toBe(1);
  return { x: spot.x + 12, y: spot.y + 4 };
}

async function insertPhoto(page: Page): Promise<void> {
  const png = await page.evaluate(async () => {
    const canvas = new OffscreenCanvas(300, 200);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no canvas');
    ctx.fillStyle = '#c81e2c';
    ctx.fillRect(0, 0, 300, 200);
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    const reader = new FileReader();
    return new Promise<string>((resolve) => {
      reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
      reader.readAsDataURL(blob);
    });
  });
  const chooser = page.waitForEvent('filechooser');
  await page.locator('#tray [data-item="image"]').click();
  await (
    await chooser
  ).setFiles({ name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await expect.poll(async () => (await storedPages(page))[0]?.images.length).toBe(1);
  await page.keyboard.press('Escape');
}

/** Scrolls up to the first page of two, with the wheel. */
async function toFirstPage(page: Page): Promise<void> {
  const middle = await at(page, 0.5, 0.5);
  await page.mouse.move(middle.x, middle.y);
  await page.mouse.wheel(0, -5000);
  await expect(page.locator('#btnPages')).toContainText('1/2');
}

const selectionBar = (page: Page) => page.locator('#selbar');
const backChip = (page: Page) => page.locator('#backChip');

/** A real two-finger gesture, sent through the browser's touch pipeline. */
async function pinchOut(page: Page): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const points = (t: number) => [
    { id: 0, x: 600 - 150 * t, y: 450 },
    { id: 1, x: 700 + 150 * t, y: 450 },
  ];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(0) });
  for (let step = 1; step <= 12; step++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points(step / 12) });
    await page.waitForTimeout(20);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(100);
}

test.describe('the Hand', () => {
  test('a pinch zooms, unless the zoom is locked', async ({ page }) => {
    await open(page);
    await page.keyboard.press('g');
    const zoom = page.locator('#btnZoom');
    await expect(zoom).toHaveText(/%/);
    await page.click('#btnZoom');
    await page.locator('.menu__item', { hasText: 'Закрепить масштаб' }).click();
    const locked = await zoom.innerText();
    await pinchOut(page);
    await expect(zoom).toHaveText(locked);
    await page.click('#btnZoom');
    await page.locator('.menu__item', { hasText: 'Открепить масштаб' }).click();
    await pinchOut(page);
    await expect(zoom).not.toHaveText(locked);
    expect((await storedPages(page))[0]?.strokes).toEqual([]);
  });

  test('one finger scrolls and nothing gets drawn, whether fingers draw or not', async ({ page }) => {
    await open(page, { fingerDraw: true, fingerSet: true });
    await page.locator('#fab').click();
    await page.keyboard.press('g');
    const start = await at(page, 0.5, 0.8);
    const end = await at(page, 0.5, 0.1);
    const before = await page.locator('#btnPages').textContent();
    expect(before).toContain('2/2');
    for (let i = 0; i < 4; i++) await dragWith(page, 'touch', end, start);
    await expect(page.locator('#btnPages')).toContainText('1/2');
    await page.waitForTimeout(800);
    expect((await storedPages(page)).flatMap((row) => row.strokes)).toEqual([]);
  });

  test('a stylus scrolls too, and draws nothing', async ({ page }) => {
    await open(page);
    await page.locator('#fab').click();
    await page.keyboard.press('g');
    const start = await at(page, 0.5, 0.8);
    const end = await at(page, 0.5, 0.1);
    for (let i = 0; i < 4; i++) await dragWith(page, 'pen', end, start);
    await expect(page.locator('#btnPages')).toContainText('1/2');
    await page.waitForTimeout(800);
    expect((await storedPages(page)).flatMap((row) => row.strokes)).toEqual([]);
  });

  test('a tap on an internal link jumps, and Back returns', async ({ page }) => {
    await open(page);
    const ink = await at(page, 0.4, 0.3);
    await page.keyboard.press('p');
    await page.mouse.move(ink.x, ink.y);
    await page.mouse.down();
    await page.mouse.move(ink.x + 80, ink.y + 4, { steps: 8 });
    await page.mouse.up();
    await page.keyboard.press('l');
    await page.mouse.move(ink.x - 30, ink.y - 30);
    await page.mouse.down();
    for (const [x, y] of [
      [ink.x + 110, ink.y - 30],
      [ink.x + 110, ink.y + 30],
      [ink.x - 30, ink.y + 30],
      [ink.x - 30, ink.y - 28],
    ]) {
      await page.mouse.move(x ?? 0, y ?? 0, { steps: 6 });
    }
    await page.mouse.up();
    await selectionBar(page).getByRole('button', { name: 'Ссылка и закладка' }).click();
    await page.locator('.menu__item', { hasText: 'Сделать ссылку…' }).click();
    await page.fill('#anchorName', 'Цель');
    await page.click('.sheet__foot .btn--primary');
    await expect(page.locator('#anchorName')).toBeHidden();

    await page.locator('#fab').click();
    await expect(page.locator('#btnPages')).toContainText('2/2');
    const spot = await at(page, 0.4, 0.4);
    await page.keyboard.press('t');
    await page.mouse.click(spot.x, spot.y);
    await page.keyboard.type('туда');
    await page.keyboard.press('Control+A');
    await page.locator('.text-bar__button[aria-label="Вставить ссылку"]').click();
    await page.getByRole('button', { name: 'В моих записях' }).click();
    await page.locator('.link-pick__row', { hasText: 'Цель' }).first().click();
    await expect(page.locator('#linkSearch')).toBeHidden();
    await page.keyboard.press('Escape');
    await expect(page.locator('#textEd')).toBeHidden();
    await expect.poll(async () => (await storedPages(page))[1]?.texts.length).toBe(1);

    await page.keyboard.press('g');
    await tapWith(page, 'touch', { x: spot.x + 12, y: spot.y + 4 });
    await expect(page.locator('#btnPages')).toContainText('1/2');
    await expect(backChip(page)).toBeVisible();
    await backChip(page).click();
    await expect(page.locator('#btnPages')).toContainText('2/2');
  });

  test('a tap on a web link asks first, with a finger and with a stylus', async ({ page }) => {
    await open(page);
    const word = await webLinkWord(page, await at(page, 0.35, 0.4));
    await page.keyboard.press('g');
    await tapWith(page, 'touch', word);
    await expect(page.locator('.sheet')).toContainText('example.org');
    await page.locator('.sheet').getByRole('button', { name: 'Отмена' }).click();
    await tapWith(page, 'pen', word);
    await expect(page.locator('.sheet')).toContainText('example.org');
  });

  test('a mouse over a link shows that it opens, and elsewhere that the page can be grabbed', async ({
    page,
  }) => {
    await open(page);
    const word = await webLinkWord(page, await at(page, 0.35, 0.4));
    await page.keyboard.press('g');
    const cursor = () =>
      page.evaluate(() => getComputedStyle(document.getElementById('cv') as Element).cursor);
    const away = await at(page, 0.5, 0.8);
    await page.mouse.move(away.x, away.y);
    expect(await cursor()).toBe('grab');
    await page.mouse.move(word.x, word.y);
    await expect.poll(cursor).toBe('pointer');
  });

  test('a tap selects a text box, and a tap on empty paper lets it go', async ({ page }) => {
    await open(page);
    const spot = await at(page, 0.35, 0.3);
    await typeText(page, spot, 'заметка');
    await page.keyboard.press('g');
    await tapWith(page, 'touch', { x: spot.x + 10, y: spot.y + 4 });
    await expect(selectionBar(page)).toBeVisible();
    await tapWith(page, 'touch', await at(page, 0.5, 0.8));
    await expect(selectionBar(page)).toBeHidden();
  });

  test('a stylus moves a text box at once, a held finger moves it too', async ({ page }) => {
    await open(page);
    const spot = await at(page, 0.35, 0.3);
    await typeText(page, spot, 'заметка');
    const first = (await storedPages(page))[0]?.texts[0];
    await page.keyboard.press('g');

    const grip = { x: spot.x + 10, y: spot.y + 4 };
    await dragWith(page, 'pen', grip, { x: grip.x + 100, y: grip.y + 60 });
    await expect.poll(async () => (await storedPages(page))[0]?.texts[0]?.x).toBeGreaterThan(first?.x ?? 0);
    const moved = (await storedPages(page))[0]?.texts[0];
    await tapWith(page, 'pen', await at(page, 0.5, 0.8));
    await expect(selectionBar(page)).toBeHidden();

    await page.waitForTimeout(SESSION_MS);
    const grip2 = { x: grip.x + 100, y: grip.y + 60 };
    await dragWith(page, 'touch', grip2, { x: grip2.x, y: grip2.y + 80 }, HOLD_MS);
    await expect.poll(async () => (await storedPages(page))[0]?.texts[0]?.y).toBeGreaterThan(moved?.y ?? 0);
    expect((await storedPages(page))[0]?.strokes).toEqual([]);
  });

  test('a quick swipe of a finger over a photo scrolls, and a held one moves the photo', async ({ page }) => {
    await open(page);
    await page.keyboard.press('g');
    await insertPhoto(page);
    const spot = await at(page, 0.5, 0.5);
    await tapWith(page, 'touch', await at(page, 0.03, 0.5));
    await expect(selectionBar(page)).toBeHidden();
    const start = (await storedPages(page))[0]?.images[0];

    const moved = { x: spot.x + 60, y: spot.y + 40 };
    await dragWith(page, 'touch', spot, moved, HOLD_MS);
    await expect.poll(async () => (await storedPages(page))[0]?.images[0]?.x).not.toBe(start?.x);
    await tapWith(page, 'touch', await at(page, 0.03, 0.5));
    await expect(selectionBar(page)).toBeHidden();

    const place = (await storedPages(page))[0]?.images[0];
    const before = await page.screenshot();
    await dragWith(page, 'touch', moved, { x: moved.x, y: moved.y - 240 });
    await page.waitForTimeout(800);
    expect(Buffer.compare(await page.screenshot(), before)).not.toBe(0);
    await expect(selectionBar(page)).toBeHidden();
    expect((await storedPages(page))[0]?.images[0]).toEqual(place);
  });

  test('a card dragged to the next page goes there in one undo step', async ({ page }) => {
    await open(page);
    await page.locator('#fab').click();
    await toFirstPage(page);
    await page.click('#btnEdMore');
    await page.locator('.menu').getByText('Вставить', { exact: true }).click();
    await page.locator('.menu').getByText('Ссылка', { exact: true }).click();
    await page.fill('#linkUrl', 'example.com');
    await page.click('.sheet__foot .btn--primary');
    await expect(page.locator('.snackbar')).toContainText('Нажмите на страницу');
    const place = await at(page, 0.5, 0.75);
    await page.mouse.click(place.x, place.y);
    await expect.poll(async () => (await storedPages(page))[0]?.cards.length).toBe(1);

    await page.keyboard.press('g');
    await dragWith(page, 'pen', place, { x: place.x, y: place.y + 2000 });
    await expect.poll(async () => (await storedPages(page))[1]?.cards.length).toBe(1);
    expect((await storedPages(page))[0]?.cards).toEqual([]);

    await page.locator('#btnUndo').click();
    await expect.poll(async () => (await storedPages(page))[0]?.cards.length).toBe(1);
    expect((await storedPages(page))[1]?.cards).toEqual([]);
  });

  test('a tap on a PDF card opens the viewer', async ({ page }) => {
    await open(page);
    const pdf = [
      '%PDF-1.4',
      '1 0 obj',
      '<< /Type /Catalog /Pages 2 0 R >>',
      'endobj',
      '2 0 obj',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      'endobj',
      '3 0 obj',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 280] >>',
      'endobj',
      'trailer',
      '<< /Root 1 0 R >>',
      '%%EOF',
    ].join('\n');
    await page.click('#btnEdMore');
    await page.locator('.menu').getByText('Вставить', { exact: true }).click();
    const chooser = page.waitForEvent('filechooser');
    await page.locator('.menu').getByText('PDF-файл', { exact: true }).click();
    await (
      await chooser
    ).setFiles({ name: 'lecture.pdf', mimeType: 'application/pdf', buffer: Buffer.from(pdf, 'latin1') });
    await expect(page.locator('.snackbar')).toContainText('Нажмите на страницу');
    const spot = await at(page, 0.5, 0.3);
    await page.mouse.click(spot.x, spot.y);
    await expect.poll(async () => (await storedPages(page))[0]?.cards.length).toBe(1);
    await page.keyboard.press('g');
    await tapWith(page, 'touch', spot);
    await expect(page.locator('.pdf-viewer')).toBeVisible();
  });
});

test.describe('the button shared by the lasso and the Hand', () => {
  const slot = (page: Page) => page.locator('#tray [data-item="lasso"]');

  test('a tap on it in use switches, says so once, and the icon follows', async ({ page }) => {
    await open(page);
    await slot(page).click();
    await expect(slot(page)).toHaveAttribute('data-tool', 'lasso');
    await slot(page).click();
    await expect(slot(page)).toHaveAttribute('data-tool', 'hand');
    await expect(slot(page)).toHaveAttribute('aria-label', 'Рука');
    await expect(page.locator('.toast')).toHaveText('Нажмите ещё раз: Лассо ↔ Рука');
    await page.locator('.toast').waitFor({ state: 'hidden', timeout: 15_000 });
    await slot(page).click();
    await expect(slot(page)).toHaveAttribute('data-tool', 'lasso');
    await expect(page.locator('.toast')).toBeHidden();
    await expect(page.locator('.popover')).toHaveCount(0);
  });

  test('a long press offers both, and it remembers the last one', async ({ page }) => {
    await open(page);
    await slot(page).dispatchEvent('contextmenu');
    const items = page.locator('.menu .menu__item');
    await expect(items).toHaveCount(2);
    await items.nth(1).click();
    await expect(slot(page)).toHaveAttribute('data-tool', 'hand');
    await page.keyboard.press('p');
    await expect(slot(page)).toHaveAttribute('data-tool', 'hand');
    await expect(slot(page)).toHaveAttribute('aria-pressed', 'false');
    await slot(page).click();
    await expect(slot(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(slot(page)).toHaveAttribute('data-tool', 'hand');
  });

  test('the Hand is its own item in customise mode, hidden until asked for, and cannot be pinned', async ({
    page,
  }) => {
    await open(page);
    await expect(page.locator('#tray [data-item="hand"]')).toHaveCount(0);
    await page.click('#btnEdMore');
    await page.locator('.menu__item', { hasText: 'Настроить панель' }).click();
    const row = page.locator('.toolbar-custom__row', { hasText: 'Рука' });
    await expect(row).toHaveClass(/toolbar-custom__row--hidden/);
    await row.getByRole('button', { name: /Показать/ }).click();
    await page.keyboard.press('Escape');
    const item = page.locator('#tray [data-item="hand"]');
    await expect(item).toBeVisible();
    await item.click();
    await expect(item).toHaveAttribute('aria-pressed', 'true');
    await item.click();
    await expect(page.locator('.popover')).toHaveCount(0);
  });
});

test.describe('a tool that writes only writes', () => {
  test('a stylus tap on a link draws a dot, and a finger opens it', async ({ page }) => {
    await open(page);
    const word = await webLinkWord(page, await at(page, 0.35, 0.4));
    await page.keyboard.press('p');
    await tapWith(page, 'pen', word);
    await expect.poll(async () => (await storedPages(page))[0]?.strokes.length).toBe(1);
    await expect(page.locator('.sheet')).toHaveCount(0);

    await page.waitForTimeout(SESSION_MS);
    await tapWith(page, 'touch', word);
    await expect(page.locator('.sheet')).toContainText('example.org');
  });

  test('a finger that draws draws on a link too', async ({ page }) => {
    await open(page, { fingerDraw: true, fingerSet: true });
    const word = await webLinkWord(page, await at(page, 0.35, 0.4));
    await page.keyboard.press('p');
    await tapWith(page, 'touch', word);
    await expect.poll(async () => (await storedPages(page))[0]?.strokes.length).toBe(1);
    await expect(page.locator('.sheet')).toHaveCount(0);
  });

  test('a lasso tap with a stylus does not open a link', async ({ page }) => {
    await open(page);
    const word = await webLinkWord(page, await at(page, 0.35, 0.4));
    await page.keyboard.press('l');
    await tapWith(page, 'pen', word);
    await page.waitForTimeout(150);
    await expect(page.locator('.sheet')).toHaveCount(0);
  });

  test('two taps on a link with the pen earn a tip, once', async ({ page }) => {
    await open(page);
    const word = await webLinkWord(page, await at(page, 0.35, 0.4));
    await page.keyboard.press('p');
    await tapWith(page, 'pen', word);
    await tapWith(page, 'pen', word);
    const tip = page.locator('.toast', { hasText: 'Чтобы открывать ссылки' });
    await expect(tip).toBeVisible();
    await tip.waitFor({ state: 'hidden', timeout: 15_000 });
    await tapWith(page, 'pen', word);
    await tapWith(page, 'pen', word);
    await page.waitForTimeout(150);
    await expect(tip).toBeHidden();
  });
});

test.describe('the page button', () => {
  const chip = (page: Page) => page.locator('#pageChip');
  const opacity = (page: Page) =>
    page.evaluate(() => getComputedStyle(document.getElementById('pageChip') as Element).opacity);

  test('fades while writing, lets the stylus through, and comes back', async ({ page }) => {
    await open(page);
    await page.keyboard.press('p');
    const box = await chip(page).boundingBox();
    if (!box) throw new Error('no chip');
    const on = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

    await pointer(page, 'pen', 'pointerdown', on, 'pageChip');
    await expect(chip(page)).toHaveClass(/page-chip--faded/);
    await pointer(page, 'pen', 'pointermove', { x: on.x + 30, y: on.y - 30 });
    await pointer(page, 'pen', 'pointerup', { x: on.x + 30, y: on.y - 30 });
    await expect(page.locator('#pageTitle')).toHaveCount(0);
    await expect.poll(async () => (await storedPages(page))[0]?.strokes.length).toBe(1);
    await expect(chip(page)).not.toHaveClass(/page-chip--faded/, { timeout: 3000 });
    await expect.poll(() => opacity(page)).toBe('1');

    await chip(page).click();
    await expect(page.locator('#pageTitle')).toBeVisible();
  });

  test('stays with the Hand, and the keyboard reaches it while faded', async ({ page }) => {
    await open(page);
    await page.keyboard.press('g');
    await dragWith(page, 'pen', await at(page, 0.5, 0.5), await at(page, 0.5, 0.4));
    await expect(chip(page)).not.toHaveClass(/page-chip--faded/);
    await expect(chip(page)).toHaveAttribute('aria-label', /.+/);
  });
});
