import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { exportDownload } from './downloads';
import { pdfTextItems, servePdfJs } from './pdf-view';

const NOTEBOOK = 'Attach';
/** Tall enough for a page to fit, wide enough for the whole bar. */
const VIEW = { width: 1200, height: 900 };

interface StoredCard {
  id: string;
  kind: string;
  y: number;
  thumb?: string | null;
  pages?: number;
  name?: string;
  title?: string;
  link?: { href: string };
}
interface StoredPage {
  id: string;
  nbId: string;
  cards?: StoredCard[];
  strokes: unknown[];
  texts: { paras?: { runs: { t: string; link?: { href: string } }[] }[] }[];
}

/** A small, valid two-page PDF, built by hand so that the test owns every byte of it. */
function twoPagePdf(): Buffer {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 280] >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 280] >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = body.length;
  const entries = offsets.map((at) => String(at).padStart(10, '0') + ' 00000 n \n').join('');
  body += `xref\n0 5\n0000000000 65535 f \n${entries}`;
  body += `trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

/** Opens a new notebook, and collects whatever the CSP blocks from then on. */
async function open(page: Page, view = VIEW): Promise<string[]> {
  const violations: string[] = [];
  page.on('console', (message) => {
    if (/Content Security Policy/i.test(message.text())) violations.push(message.text());
  });
  await page.setViewportSize(view);
  await page.goto('./');
  await page.locator('.subject').first().locator('.shelf__add').click();
  await page.fill('#nb-title', NOTEBOOK);
  await page.click('.sheet__foot .btn--primary');
  await expect(page.locator('#editor')).toBeVisible();
  await page.locator('#tray [data-tool="pen"]').waitFor();
  return violations;
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
            const nb = (notebooks.result as { id: string; title: string; pageIds: string[] }[]).find(
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

function storedBlobIds(page: Page): Promise<string[]> {
  return page.evaluate(
    () =>
      new Promise<string[]>((resolve, reject) => {
        const req = indexedDB.open('konspektnik');
        req.onerror = () => reject(new Error('no database'));
        req.onsuccess = () => {
          const keys = req.result.transaction('blobs').objectStore('blobs').getAllKeys();
          keys.onsuccess = () => {
            req.result.close();
            resolve(keys.result as string[]);
          };
        };
      }),
  );
}

const cardsOf = async (page: Page): Promise<StoredCard[]> =>
  (await storedPages(page)).flatMap((row) => row.cards ?? []);

/** A screen point at fractions of the stage; the first page is in the middle of it. */
async function at(page: Page, fx: number, fy: number): Promise<{ x: number; y: number }> {
  const box = await page.locator('#stage').boundingBox();
  if (!box) throw new Error('no stage');
  return { x: box.x + box.width * fx, y: box.y + box.height * fy };
}

const menuItem = (page: Page, name: string) => page.locator('.menu').getByText(name, { exact: true });

async function openInsertMenu(page: Page): Promise<void> {
  await page.click('#btnEdMore');
  await menuItem(page, 'Вставить').click();
}

async function insertPdf(page: Page, fx = 0.5, fy = 0.3): Promise<void> {
  await openInsertMenu(page);
  const chooser = page.waitForEvent('filechooser');
  await menuItem(page, 'PDF-файл').click();
  await (await chooser).setFiles({ name: 'lecture.pdf', mimeType: 'application/pdf', buffer: twoPagePdf() });
  await expect(page.locator('.snackbar')).toContainText('Нажмите на страницу');
  const spot = await at(page, fx, fy);
  await page.mouse.click(spot.x, spot.y);
  await expect.poll(async () => (await cardsOf(page)).length).toBeGreaterThan(0);
}

async function insertLinkAt(page: Page, address: string, y: number): Promise<void> {
  await openInsertMenu(page);
  await menuItem(page, 'Ссылка').click();
  await page.fill('#linkUrl', address);
  await page.click('.sheet__foot .btn--primary');
  await expect(page.locator('.snackbar')).toContainText('Нажмите на страницу');
  const spot = await at(page, 0.5, 0);
  await page.mouse.click(spot.x, y);
}

async function insertLink(page: Page, address: string, fy = 0.5): Promise<void> {
  await insertLinkAt(page, address, (await at(page, 0.5, fy)).y);
}

/** Two pages, scrolled so page 1's bottom and page 2's top are both on screen. */
async function showPageBoundary(page: Page, stageTop: number): Promise<void> {
  // Plain mouse wheel: scroll up 300 px from the top of page 2.
  await page.mouse.move(640, stageTop + 300);
  await page.mouse.wheel(0, -300);
  await page.waitForTimeout(200);
}

/** A tap on the middle of a card at this height of the stage. */
async function clickCard(page: Page, fy: number): Promise<void> {
  const spot = await at(page, 0.5, fy);
  await page.mouse.click(spot.x, spot.y);
}

/** Opens a card's menu with its ⋮, at the right end of a card as wide as the page's content. */
async function openCardMenu(page: Page, fy: number): Promise<void> {
  const spot = await at(page, 0.5, fy);
  const box = await page.locator('#stage').boundingBox();
  if (!box) throw new Error('no stage');
  for (let x = box.x + box.width - 4; x > spot.x; x -= 12) {
    await page.mouse.click(x, spot.y);
    if (await page.locator('.menu').isVisible()) return;
  }
  throw new Error('card menu not found');
}

test('a PDF card: thumbnail, viewer, saved copy, pages into the notebook, and it survives a reload', async ({
  page,
}) => {
  const violations = await open(page);
  const from = await at(page, 0.4, 0.3);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 200, from.y, { steps: 8 });
  await page.mouse.up();

  await insertPdf(page);
  const [card] = await cardsOf(page);
  expect(card).toMatchObject({ kind: 'pdf', pages: 2, name: 'lecture.pdf' });
  expect(card?.thumb).toBeTruthy();
  expect((await storedPages(page))[0]?.strokes).toHaveLength(1);

  await clickCard(page, 0.3);
  await expect(page.locator('.pdf-viewer')).toBeVisible();
  await expect(page.locator('.pdf-viewer__indicator')).toHaveText('1 / 2');
  await expect(page.locator('.pdf-viewer__page')).toHaveCount(2);
  await expect(page.locator('.pdf-viewer__canvas').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.pdf-viewer')).toHaveCount(0);

  await openCardMenu(page, 0.3);
  const download = exportDownload(page);
  await menuItem(page, 'Сохранить копию').click();
  const saved = await download;
  expect(saved.suggestedFilename()).toBe('lecture.pdf');

  await openCardMenu(page, 0.3);
  const before = (await storedPages(page)).length;
  await menuItem(page, 'Вставить страницы в тетрадь').click();
  await expect.poll(async () => (await storedPages(page)).length).toBe(before + 2);

  await page.reload();
  await page.getByText(NOTEBOOK, { exact: true }).first().click();
  await expect(page.locator('#editor')).toBeVisible();
  expect(await cardsOf(page)).toHaveLength(1);
  expect(await storedBlobIds(page)).toContain(card?.thumb);
  expect(violations).toEqual([]);
});

test('a file that is not a PDF is refused whatever it calls itself', async ({ page }) => {
  await open(page);
  await openInsertMenu(page);
  const chooser = page.waitForEvent('filechooser');
  await menuItem(page, 'PDF-файл').click();
  await (await chooser).setFiles({
    name: 'fake.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('<html></html>'),
  });
  await expect(page.locator('.toast')).toBeVisible();
  expect(await cardsOf(page)).toEqual([]);
});

test('a damaged PDF gets a card that explains, and can still be saved', async ({ page }) => {
  await open(page);
  await openInsertMenu(page);
  const chooser = page.waitForEvent('filechooser');
  await menuItem(page, 'PDF-файл').click();
  await (await chooser).setFiles({
    name: 'broken.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4\nthis is not really a pdf'),
  });
  await expect(page.locator('.snackbar')).toContainText('Нажмите на страницу', { timeout: 15000 });
  const spot = await at(page, 0.5, 0.3);
  await page.mouse.click(spot.x, spot.y);
  await expect.poll(async () => (await cardsOf(page))[0]?.name).toBe('broken.pdf');
  await clickCard(page, 0.3);
  const sheet = page.locator('.sheet');
  await expect(sheet).toContainText('повреждён');
  const download = exportDownload(page);
  await sheet.getByRole('button', { name: 'Сохранить копию' }).click();
  expect((await download).suggestedFilename()).toBe('broken.pdf');
});

test('a link card asks first, a dangerous address never gets in, and nothing is fetched', async ({
  page,
}) => {
  const outside: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('example.com')) outside.push(request.url());
  });
  await open(page);
  await openInsertMenu(page);
  await menuItem(page, 'Ссылка').click();
  await page.fill('#linkUrl', 'java' + 'script:alert(1)');
  await page.click('.sheet__foot .btn--primary');
  await expect(page.locator('.field__error')).toBeVisible();
  await page.fill('#linkUrl', 'data:text/html,x');
  await page.click('.sheet__foot .btn--primary');
  await expect(page.locator('.field__error')).toBeVisible();
  await page.fill('#linkUrl', '  example.com/page ');
  await page.click('.sheet__foot .btn--primary');
  await expect(page.locator('.snackbar')).toContainText('Нажмите на страницу');
  const spot = await at(page, 0.5, 0.5);
  await page.mouse.click(spot.x, spot.y);
  await expect.poll(async () => (await cardsOf(page))[0]?.link?.href).toBe('https://example.com/page');
  expect((await cardsOf(page))[0]?.title).toBe('example.com');

  await page.evaluate(() => {
    const opened: unknown[][] = [];
    window.open = (...args: unknown[]) => {
      opened.push(args);
      return null;
    };
    Object.assign(window, { openedForTest: opened });
  });
  await page.mouse.click(spot.x, spot.y);
  const sheet = page.locator('.sheet');
  await expect(sheet).toContainText('Открыть ссылку на example.com?');
  await sheet.getByRole('button', { name: 'Отмена' }).click();
  const openedCount = () =>
    page.evaluate(() => (window as unknown as { openedForTest: unknown[] }).openedForTest.length);
  expect(await openedCount()).toBe(0);

  await page.mouse.click(spot.x, spot.y);
  await sheet.getByRole('button', { name: 'Открыть' }).click();
  expect(await page.evaluate(() => (window as unknown as { openedForTest: unknown[] }).openedForTest[0])).toEqual([
    'https://example.com/page',
    '_blank',
    'noopener,noreferrer',
  ]);
  expect(outside).toEqual([]);
});

test('a word in a text box carries a link: coloured, asks before opening, and can be removed', async ({
  page,
}) => {
  await open(page);
  await page.locator('#tray [data-tool="text"]').click();
  const spot = await at(page, 0.35, 0.4);
  await page.mouse.click(spot.x, spot.y);
  await page.keyboard.type('hello');
  await page.keyboard.press('Control+A');
  await page.locator('.text-bar__button[aria-label="Ссылка"]').click();
  await page.fill('#linkUrl', 'example.org');
  await page.click('.sheet__foot .btn--primary');
  await expect(page.locator('[data-href="https://example.org/"]')).toHaveText('hello');

  await page.locator('#tray [data-tool="pen"]').click();
  await expect
    .poll(async () => (await storedPages(page))[0]?.texts[0]?.paras?.[0]?.runs[0]?.link?.href)
    .toBe('https://example.org/');
  await page.mouse.click(spot.x + 12, spot.y + 4);
  await expect(page.locator('.sheet')).toContainText('example.org');
  await page.locator('.sheet').getByRole('button', { name: 'Отмена' }).click();
  // The pen still writes over a link: only a press that does not move is a tap.
  await page.mouse.move(spot.x + 12, spot.y + 4);
  await page.mouse.down();
  await page.mouse.move(spot.x + 90, spot.y + 40, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator('.sheet')).toHaveCount(0);
  await expect.poll(async () => (await storedPages(page))[0]?.strokes.length).toBe(1);
});

test('the eraser leaves a card, and the lasso moves it to another page in one undo step', async ({
  page,
}) => {
  await open(page, { width: 1280, height: 720 });
  await page.click('#fab');
  await expect.poll(async () => (await storedPages(page)).length).toBe(2);
  const stage = await page.locator('#stage').boundingBox();
  if (!stage) throw new Error('no stage');
  const perPage = async () => (await storedPages(page)).map((row) => row.cards?.length ?? 0);
  const cx = stage.x + stage.width / 2;
  await showPageBoundary(page, stage.y);
  // As in the other cross-page test: page 1 ends about 333 px below the stage top.
  const y = stage.y + 240;
  await insertLinkAt(page, 'example.com', y);
  await expect.poll(perPage).toEqual([1, 0]);

  await page.locator('#tray [data-tool="eraser"]').click();
  await page.mouse.move(cx - 100, y);
  await page.mouse.down();
  await page.mouse.move(cx + 100, y, { steps: 8 });
  await page.mouse.up();
  expect(await cardsOf(page)).toHaveLength(1);

  await page.locator('#tray [data-tool="lasso"]').click();
  await page.mouse.move(stage.x + 60, y - 70);
  await page.mouse.down();
  await page.mouse.move(stage.x + stage.width - 60, y - 70, { steps: 6 });
  await page.mouse.move(stage.x + stage.width - 60, y + 70, { steps: 6 });
  await page.mouse.move(stage.x + 60, y + 70, { steps: 6 });
  await page.mouse.move(stage.x + 60, y - 70, { steps: 6 });
  await page.mouse.up();

  await page.mouse.move(cx, y);
  await page.mouse.down();
  await page.mouse.move(cx, y + 300, { steps: 12 });
  await page.mouse.up();
  await expect.poll(perPage).toEqual([0, 1]);

  await page.keyboard.press('Control+Z');
  await expect.poll(perPage).toEqual([1, 0]);
});

test('a vector PDF export has link cards and linked words as clickable annotations', async ({ page }) => {
  await servePdfJs(page);
  await open(page);
  await insertLink(page, 'example.com/annotated(1)', 0.3);
  await expect.poll(async () => (await cardsOf(page)).length).toBe(1);
  await page.locator('#tray [data-tool="text"]').click();
  const spot = await at(page, 0.35, 0.6);
  await page.mouse.click(spot.x, spot.y);
  await page.keyboard.type('hello');
  await page.keyboard.press('Control+A');
  await page.locator('.text-bar__button[aria-label="Ссылка"]').click();
  await page.fill('#linkUrl', 'example.org/word');
  await page.click('.sheet__foot .btn--primary');
  await page.locator('#tray [data-tool="pen"]').click();
  await page.click('#btnEdMore');
  await menuItem(page, 'Экспорт…').click();
  const sheet = page.locator('.sheet');
  await sheet.locator('.choice-list__item', { hasText: 'PDF' }).first().click();
  const download = exportDownload(page);
  await sheet.getByRole('button', { name: 'Экспортировать' }).click();
  const path = await (await download).path();
  const text = readFileSync(path).toString('latin1');
  expect(text).toContain('/URI (https://example.com/annotated%281%29)');
  expect(text).toContain('/URI (https://example.org/word)');
  const words = (await pdfTextItems(page, readFileSync(path))).map((item) => item.str).join(' ');
  expect(words).toContain('example.com');
});

test('the viewer fits a phone in both orientations and frees its canvases on close', async ({ page }) => {
  await open(page);
  await insertPdf(page);
  await page.setViewportSize({ width: 320, height: 568 });
  await expect.poll(async () => (await cardsOf(page)).length).toBe(1);
  const box = await page.locator('#stage').boundingBox();
  if (!box) throw new Error('no stage');
  const card = (await cardsOf(page))[0];
  if (!card) throw new Error('no card');
  // The view may have moved with the window, so the viewer is opened through the card's own spot.
  for (let y = box.y + 4; y < box.y + box.height; y += 10) {
    await page.mouse.click(box.x + box.width / 2, y);
    if (await page.locator('.pdf-viewer').isVisible()) break;
  }
  const canvas = page.locator('.pdf-viewer__canvas').first();
  await expect(canvas).toBeVisible();
  const portrait = await canvas.boundingBox();
  expect(portrait?.width).toBeLessThanOrEqual(320);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);

  await page.setViewportSize({ width: 568, height: 320 });
  await expect.poll(async () => (await canvas.boundingBox())?.width).toBeGreaterThan(portrait?.width ?? 0);
  await page.getByRole('button', { name: 'Увеличить' }).click();
  await page.getByRole('button', { name: 'Закрыть' }).click();
  await expect(page.locator('.pdf-viewer')).toHaveCount(0);
  await expect(page.locator('canvas.pdf-viewer__canvas')).toHaveCount(0);
});
