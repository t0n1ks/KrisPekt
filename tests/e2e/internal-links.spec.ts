import { readFileSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { exportDownload } from './downloads';
import { firstLinkPixel } from './link-pixel';

const VIEW = { width: 1200, height: 900 };
const PHONE = { width: 320, height: 568 };

interface StoredPage {
  id: string;
  anchors: { id: string; name: string; items: string[]; range?: number[] }[];
  inkLinks: { id: string; items: string[]; link: { kind: string; id?: string } }[];
  strokes: { id: string }[];
  texts: {
    id: string;
    toc?: boolean;
    paras?: { runs: { t: string; link?: { kind: string; id?: string } }[] }[];
  }[];
}

const cspViolations: string[] = [];

function watchCsp(page: Page): void {
  page.on('console', (message) => {
    if (/Content Security Policy/i.test(message.text())) cspViolations.push(message.text());
  });
}

/** The stored pages of a notebook, in order. */
function storedPages(page: Page, title: string): Promise<StoredPage[]> {
  return page.evaluate(
    (name) =>
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
              (n) => n.title === name,
            );
            const rows = pages.result as StoredPage[];
            resolve((nb?.pageIds ?? []).flatMap((id) => rows.filter((row) => row.id === id)));
          };
        };
      }),
    title,
  );
}

async function newNotebook(page: Page, title: string): Promise<void> {
  await page.locator('.subject').first().locator('.shelf__add').click();
  await page.fill('#nb-title', title);
  await page.click('.sheet__foot .btn--primary');
  await expect(page.locator('#editor')).toBeVisible();
  await page.locator('#tray [data-tool="pen"]').waitFor();
}

async function toShelf(page: Page): Promise<void> {
  await page.click('#btnBack');
  await expect(page.locator('#editor')).toBeHidden();
}

async function reopen(page: Page, title: string): Promise<void> {
  await page.locator('.notebook-card__title', { hasText: title }).click();
  await expect(page.locator('#editor')).toBeVisible();
}

async function at(page: Page, fx: number, fy: number): Promise<{ x: number; y: number }> {
  const box = await page.locator('#stage').boundingBox();
  if (!box) throw new Error('no stage');
  return { x: box.x + box.width * fx, y: box.y + box.height * fy };
}

const menuItem = (page: Page, label: string): Locator => page.locator('.menu__item', { hasText: label });

/** Writes a horizontal stroke with the pen. */
async function scribble(page: Page, fx: number, fy: number): Promise<{ x: number; y: number }> {
  // By key: tapping the selected tool would open its options, in the way of the stroke.
  await page.keyboard.press('p');
  const from = await at(page, fx, fy);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 80, from.y + 4, { steps: 8 });
  await page.mouse.up();
  return { x: from.x + 40, y: from.y + 2 };
}

/** Lassoes a client rectangle around a point. */
async function lassoAround(page: Page, c: { x: number; y: number }): Promise<void> {
  // By key: on a phone the lasso may be in the tray's overflow.
  await page.keyboard.press('l');
  const left = c.x - 70;
  const right = c.x + 70;
  const top = c.y - 30;
  const bottom = c.y + 30;
  await page.mouse.move(left, top);
  await page.mouse.down();
  for (const [x, y] of [
    [right, top],
    [right, bottom],
    [left, bottom],
    [left, top + 2],
  ]) {
    await page.mouse.move(x ?? 0, y ?? 0, { steps: 6 });
  }
  await page.mouse.up();
  await expect(page.locator('#selbar')).toBeVisible();
}

async function bookmarkSelection(page: Page, name: string): Promise<void> {
  await page.locator('#selbar').getByRole('button', { name: 'Ссылка и закладка' }).click();
  await menuItem(page, 'Сделать ссылку…').click();
  await page.fill('#anchorName', name);
  await page.click('.sheet__foot .btn--primary');
  await expect(page.locator('#anchorName')).toBeHidden();
}

/** Chooses a place through the picker's search, with the dialog open on its notes tab. */
async function pickBySearch(page: Page, query: string, name: string): Promise<void> {
  await page.fill('#linkSearch', query);
  await page.locator('.link-pick__row', { hasText: name }).first().click();
  await expect(page.locator('#linkSearch')).toBeHidden();
}

/** Types a word and makes it a link through the text box's bar. */
async function typedLink(
  page: Page,
  fx: number,
  fy: number,
  word: string,
  query: string,
  name: string,
): Promise<{ x: number; y: number }> {
  await page.locator('#tray [data-tool="text"]').click();
  const spot = await at(page, fx, fy);
  await page.mouse.click(spot.x, spot.y);
  await expect(page.locator('#textEd')).toBeVisible();
  await page.keyboard.type(word);
  await page.evaluate(() => {
    const root = document.getElementById('textEd') as HTMLElement;
    document.getSelection()?.selectAllChildren(root);
  });
  await page.locator('.text-bar__button[aria-label="Вставить ссылку"]').click();
  await page.getByRole('button', { name: 'В моих записях' }).click();
  await pickBySearch(page, query, name);
  await page.keyboard.press('Escape');
  await expect(page.locator('#textEd')).toBeHidden();
  return { x: spot.x + 16, y: spot.y + 12 };
}

const backChip = (page: Page): Locator => page.locator('#backChip');
const highlight = (page: Page): Locator => page.locator('#jumpMark');

/** A tap with the Hand, which opens what it lands on, on a stage point. */
async function tap(page: Page, point: { x: number; y: number }): Promise<void> {
  await page.keyboard.press('g');
  await page.mouse.click(point.x, point.y);
}

test.beforeEach(async ({ page }) => {
  watchCsp(page);
  await page.setViewportSize(VIEW);
  await page.goto('./');
});

test.afterEach(() => {
  expect(cspViolations.splice(0)).toEqual([]);
});

/** Notebook A with a bookmarked stroke on its second page; opened on page 2. */
async function notebookWithAnchor(page: Page): Promise<void> {
  await newNotebook(page, 'Alpha');
  await page.click('#btnPages');
  await page.locator('.page-item').first().locator('.page-item__more').click();
  await menuItem(page, 'Дублировать').click();
  await expect(page.locator('#btnPages')).toContainText('/2');
  await expect(page.locator('.page-item')).toHaveCount(2);
  await page.locator('.page-item__thumb').nth(1).click();
  if (await page.locator('#panel').isVisible()) await page.click('#panelClose');
  await expect(page.locator('#btnPages')).toContainText('2/2');
  const ink = await scribble(page, 0.4, 0.4);
  await lassoAround(page, ink);
  await bookmarkSelection(page, 'Theorem');
  await expect.poll(async () => (await storedPages(page, 'Alpha'))[1]?.anchors.length).toBe(1);
}

test('links from text and ink: jump, back, reorder, broken, undo, reload', async ({ page }) => {
  await notebookWithAnchor(page);
  await toShelf(page);

  // In notebook B: a typed word and a handwritten word, both leading to the anchor in A.
  await newNotebook(page, 'Beta');
  const word = await typedLink(page, 0.42, 0.25, 'Linked', 'theo', 'Theorem');
  const ink = await scribble(page, 0.4, 0.5);
  await lassoAround(page, ink);
  await page.locator('#selbar').getByRole('button', { name: 'Ссылка и закладка' }).click();
  await menuItem(page, 'Вставить ссылку…').click();
  await pickBySearch(page, 'theo', 'Theorem');
  await expect.poll(async () => (await storedPages(page, 'Beta'))[0]?.inkLinks.length).toBe(1);

  // No confirmation: the word goes straight to page 2 of A, shown and highlighted.
  await page.keyboard.press('p');
  await tap(page, word);
  await expect(page.locator('#btnPages')).toContainText('2/2');
  await expect(highlight(page)).toBeVisible();
  await expect(backChip(page)).toBeVisible();
  await expect(page.locator('.sheet')).toHaveCount(0);
  await expect(highlight(page)).toBeHidden({ timeout: 3000 });

  // Back returns to B, to the same place.
  await backChip(page).click();
  await expect(page.locator('#btnPages')).toContainText('1/1');
  await expect(backChip(page)).toBeHidden();

  // Handwriting works as well, and the system back button goes back through the jumps.
  await page.keyboard.press('l');
  await tap(page, ink);
  await expect(page.locator('#btnPages')).toContainText('2/2');
  await page.goBack();
  await expect(page.locator('#btnPages')).toContainText('1/1');
  await expect(page.locator('#editor')).toBeVisible();
  await expect(backChip(page)).toBeHidden();

  // A reorder in A does not break the link: page 2 becomes page 1.
  await page.keyboard.press('p');
  await tap(page, word);
  await expect(page.locator('#btnPages')).toContainText('2/2');
  await page.click('#btnPages');
  await page.locator('.page-item').nth(1).locator('.page-item__more').click();
  await menuItem(page, 'Переместить в начало').click();
  if (await page.locator('#panel').isVisible()) await page.click('#panelClose');
  await backChip(page).click();
  await expect(page.locator('#btnPages')).toContainText('1/1');
  await tap(page, word);
  await expect(page.locator('#btnPages')).toContainText('1/2');

  // Deleting the anchor breaks the link, and says so.
  await page.click('#btnEdMore');
  await menuItem(page, 'Оглавление и закладки').click();
  await page
    .locator('.anchor-list__row', { hasText: 'Theorem' })
    .getByRole('button', { name: 'Удалить закладку' })
    .click();
  // Two links lead there, one of them in the other notebook.
  await expect(page.locator('.sheet').last()).toContainText('Перестанут работать ссылки: 2');
  await page.locator('.sheet__foot .btn--danger').last().click();
  await expect(page.locator('.anchor-list__row')).toHaveCount(0);
  await page.locator('.sheet__head .icon-btn').click();
  await expect(page.locator('.sheet')).toHaveCount(0);
  await backChip(page).click();
  await expect(page.locator('#btnPages')).toContainText('1/1');
  await tap(page, word);
  await expect(page.locator('.sheet')).toContainText('Цель удалена');
  await expect(page.locator('#btnPages')).toContainText('1/1');
  await page.locator('.sheet__foot .btn', { hasText: 'Отмена' }).click();

  // A link to the notebook itself still works: the way back in, for undo.
  await lassoAround(page, ink);
  await page.locator('#selbar').getByRole('button', { name: 'Ссылка и закладка' }).click();
  await menuItem(page, 'Вставить ссылку…').click();
  await pickBySearch(page, 'alpha', 'Alpha');
  await expect
    .poll(async () => (await storedPages(page, 'Beta'))[0]?.inkLinks[0]?.link.kind)
    .toBe('notebook');
  await page.keyboard.press('p');
  await tap(page, ink);
  await expect(page.locator('#btnPages')).toContainText('1/2');

  // Undo in A brings the anchor back, and with it the link.
  await page.click('#btnUndo');
  await expect.poll(async () => (await storedPages(page, 'Alpha'))[0]?.anchors.length).toBe(1);
  await backChip(page).click();
  await expect(page.locator('#btnPages')).toContainText('1/1');
  await tap(page, word);
  await expect(page.locator('#btnPages')).toContainText('1/2');
  await expect(highlight(page)).toBeVisible();

  // Everything is still there after a reload.
  await backChip(page).click();
  await expect.poll(async () => (await storedPages(page, 'Beta'))[0]?.inkLinks.length).toBe(1);
  await page.waitForTimeout(600);
  await page.reload();
  await reopen(page, 'Beta');
  await page.keyboard.press('p');
  await tap(page, word);
  await expect(page.locator('#btnPages')).toContainText('1/2');
  await expect(backChip(page)).toBeVisible();
});

test('a linked stroke scratched out or deleted takes its link along, and undo restores both', async ({
  page,
}) => {
  await newNotebook(page, 'Solo');
  const ink = await scribble(page, 0.4, 0.4);
  await lassoAround(page, ink);
  await bookmarkSelection(page, 'Spot');
  await lassoAround(page, ink);
  await page.locator('#selbar').getByRole('button', { name: 'Ссылка и закладка' }).click();
  await menuItem(page, 'Вставить ссылку…').click();
  await pickBySearch(page, 'spot', 'Spot');
  await expect.poll(async () => (await storedPages(page, 'Solo'))[0]?.inkLinks.length).toBe(1);

  await lassoAround(page, ink);
  await page.locator('#selbar').getByRole('button', { name: 'Удалить' }).click();
  await expect
    .poll(async () => {
      const [stored] = await storedPages(page, 'Solo');
      return [stored?.strokes.length, stored?.inkLinks.length, stored?.anchors.length];
    })
    .toEqual([0, 0, 0]);

  await page.click('#btnUndo');
  await expect
    .poll(async () => {
      const [stored] = await storedPages(page, 'Solo');
      return [stored?.strokes.length, stored?.inkLinks.length, stored?.anchors.length];
    })
    .toEqual([1, 1, 1]);
});

test('moved items carry their bookmark, and the jump finds them there', async ({ page }) => {
  await newNotebook(page, 'Moves');
  const ink = await scribble(page, 0.4, 0.3);
  await lassoAround(page, ink);
  await bookmarkSelection(page, 'Roams');
  await expect.poll(async () => (await storedPages(page, 'Moves'))[0]?.anchors.length).toBe(1);
  const before = await storedPages(page, 'Moves');
  await lassoAround(page, ink);
  await page.mouse.move(ink.x, ink.y);
  await page.mouse.down();
  await page.mouse.move(ink.x, ink.y + 200, { steps: 10 });
  await page.mouse.up();
  await page.keyboard.press('p');
  await expect
    .poll(async () => {
      const after = await storedPages(page, 'Moves');
      return JSON.stringify(after[0]?.anchors) !== JSON.stringify(before[0]?.anchors);
    })
    .toBe(true);
  expect((await storedPages(page, 'Moves'))[0]?.anchors[0]?.items).toEqual(before[0]?.anchors[0]?.items);
});

test('a stretch of text can be bookmarked, and a copied link pasted on handwriting', async ({ page }) => {
  await newNotebook(page, 'Parts');
  await page.keyboard.press('t');
  const spot = await at(page, 0.42, 0.2);
  await page.mouse.click(spot.x, spot.y);
  await page.keyboard.type('Chapter one');
  await page.evaluate(() => {
    document.getSelection()?.selectAllChildren(document.getElementById('textEd') as HTMLElement);
  });
  await page.locator('.text-bar__button[aria-label="Сделать ссылку"]').click();
  await expect(page.locator('#anchorName')).toHaveValue('Chapter one');
  await page.locator('.sheet__foot .btn--primary').click();
  await expect(page.locator('#anchorName')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(page.locator('#textEd')).toBeHidden();
  await expect.poll(async () => (await storedPages(page, 'Parts'))[0]?.anchors[0]?.name).toBe('Chapter one');
  const [stored] = await storedPages(page, 'Parts');
  expect(stored?.anchors[0]?.items).toEqual([stored?.texts[0]?.id]);
  expect(stored?.anchors[0]?.range).toEqual([0, 11]);

  // A name is required.
  await page.click('#btnEdMore');
  await menuItem(page, 'Оглавление и закладки').click();
  await page.locator('.anchor-list__row').getByRole('button', { name: 'Переименовать закладку' }).click();
  await page.fill('#anchorName', '   ');
  await page.locator('.sheet__foot .btn--primary').last().click();
  await expect(page.locator('.sheet').last().locator('.field__error')).toBeVisible();
  await page.fill('#anchorName', 'Renamed');
  await page.locator('.sheet__foot .btn--primary').last().click();
  await expect(page.locator('.anchor-list__name')).toHaveText('Renamed');

  // The copied link stays in the app, and goes on a selection.
  await page.locator('.anchor-list__row').getByRole('button', { name: 'Копировать ссылку' }).click();
  await page.locator('.sheet__head .icon-btn').click();
  const ink = await scribble(page, 0.42, 0.6);
  await lassoAround(page, ink);
  await page.locator('#selbar').getByRole('button', { name: 'Ссылка и закладка' }).click();
  await menuItem(page, 'Вставить скопированную ссылку').click();
  await expect.poll(async () => (await storedPages(page, 'Parts'))[0]?.inkLinks[0]?.link.kind).toBe('anchor');
});

test('Back returns to the very same place', async ({ page }) => {
  await notebookWithAnchor(page);
  await page.click('#btnPages');
  await page.locator('.page-item__thumb').first().click();
  if (await page.locator('#panel').isVisible()) await page.click('#panelClose');
  await typedLink(page, 0.42, 0.45, 'Away', 'theo', 'Theorem');
  await expect.poll(async () => (await storedPages(page, 'Alpha'))[0]?.texts.length).toBe(1);
  // Before the picture: the toolbar in it shows the tool in use.
  await page.keyboard.press('g');
  const middle = await at(page, 0.5, 0.5);
  await page.mouse.move(middle.x, middle.y);
  await page.mouse.wheel(0, 90);
  await expect(page.locator('.toast')).toBeHidden({ timeout: 15_000 });
  await page.waitForTimeout(300);
  const stage = page.locator('#stage');
  const before = await stage.screenshot();
  const word = await firstLinkPixel(page);
  await tap(page, word);
  await expect(page.locator('#btnPages')).toContainText('2/2');
  await backChip(page).click();
  await expect(backChip(page)).toBeHidden();
  await expect(highlight(page)).toBeHidden();
  await page.waitForTimeout(300);
  expect((await stage.screenshot()).equals(before)).toBe(true);
});

test('a contents block lists the bookmarks, each line leads there, and it can be updated', async ({
  page,
}) => {
  await notebookWithAnchor(page);
  await page.click('#btnEdMore');
  await menuItem(page, 'Оглавление и закладки').click();
  await expect(page.locator('.anchor-list__row')).toContainText('Theorem');
  await expect(page.locator('.anchor-list__page')).toContainText('с. 2');
  await page.locator('.sheet__foot .btn--primary').click();

  const read = async (): Promise<StoredPage['texts'][number] | undefined> =>
    (await storedPages(page, 'Alpha')).flatMap((row) => row.texts).find((text) => text.toc);
  await expect.poll(async () => (await read())?.paras?.length).toBe(1);
  const line = (await read())?.paras?.[0]?.runs[0];
  expect(line?.t).toMatch(/^Theorem \.+ с\. 2$/);
  expect(line?.link?.kind).toBe('anchor');

  // A new bookmark shows up only once the block is updated, from the long-press menu on a line.
  await page.click('#btnPages');
  await page.locator('.page-item').nth(1).locator('.page-item__more').click();
  await menuItem(page, 'Добавить закладку').click();
  await page.fill('#anchorName', 'Whole page');
  await page.click('.sheet__foot .btn--primary');
  await expect(page.locator('#anchorName')).toBeHidden();
  if (await page.locator('#panel').isVisible()) await page.click('#panelClose');
  await expect.poll(async () => (await storedPages(page, 'Alpha'))[1]?.anchors.length).toBe(2);
  expect((await read())?.paras?.length).toBe(1);

  const lineAt = await firstLinkPixel(page);
  await page.keyboard.press('g');
  await page.mouse.move(lineAt.x, lineAt.y);
  await page.mouse.down();
  await expect(menuItem(page, 'Обновить оглавление')).toBeVisible({ timeout: 3000 });
  await page.mouse.up();
  await menuItem(page, 'Обновить оглавление').click();
  await expect.poll(async () => (await read())?.paras?.length).toBe(2);
});

test('tapping a contents line jumps to the bookmark', async ({ page }) => {
  await newNotebook(page, 'Toc');
  await page.click('#btnPages');
  await page.locator('.page-item').first().locator('.page-item__more').click();
  await menuItem(page, 'Дублировать').click();
  await expect(page.locator('.page-item')).toHaveCount(2);
  await page.locator('.page-item').nth(1).locator('.page-item__more').click();
  await menuItem(page, 'Добавить закладку').click();
  await page.fill('#anchorName', 'Second');
  await page.click('.sheet__foot .btn--primary');
  await expect(page.locator('#anchorName')).toBeHidden();
  await page.locator('.page-item__thumb').first().click();
  if (await page.locator('#panel').isVisible()) await page.click('#panelClose');
  await expect(page.locator('#btnPages')).toContainText('1/2');

  await page.click('#btnEdMore');
  await menuItem(page, 'Оглавление и закладки').click();
  await page.locator('.sheet__foot .btn--primary').click();
  await expect
    .poll(
      async () => (await storedPages(page, 'Toc')).flatMap((row) => row.texts).filter((t) => t.toc).length,
    )
    .toBe(1);

  const pos = await firstLinkPixel(page);
  await page.keyboard.press('p');
  await tap(page, pos);
  await expect(page.locator('#btnPages')).toContainText('2/2');
  await expect(highlight(page)).toBeVisible();
  await backChip(page).click();
  await expect(page.locator('#btnPages')).toContainText('1/2');
});

test('a vector PDF makes links inside the notebook go to their page', async ({ page }) => {
  await notebookWithAnchor(page);
  await page.click('#btnPages');
  await page.locator('.page-item__thumb').first().click();
  if (await page.locator('#panel').isVisible()) await page.click('#panelClose');
  await expect(page.locator('#btnPages')).toContainText('1/2');
  await typedLink(page, 0.42, 0.25, 'Go', 'theo', 'Theorem');
  await expect
    .poll(async () => (await storedPages(page, 'Alpha'))[0]?.texts[0]?.paras?.[0]?.runs[0]?.link?.kind)
    .toBe('anchor');

  await page.click('#btnEdMore');
  await menuItem(page, 'Экспорт').click();
  const exported = exportDownload(page);
  await page.locator('.sheet .choice-list__item', { hasText: 'PDF (вектор' }).first().click();
  await page.locator('.sheet').getByRole('button', { name: 'Экспортировать' }).click();
  const pdf = readFileSync(await (await exported).path()).toString('latin1');
  expect(pdf).toMatch(/\/Subtype \/Link/);
  expect(pdf).toMatch(/\/Dest \[\d+ 0 R \/Fit\]/);
});

test('every new panel fits a small phone', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto('./');
  await newNotebook(page, 'Phone');
  const ink = await scribble(page, 0.3, 0.4);
  await lassoAround(page, ink);
  const bar = await page.locator('#selbar').boundingBox();
  expect(bar?.x ?? -1).toBeGreaterThanOrEqual(0);
  expect((bar?.x ?? 0) + (bar?.width ?? 999)).toBeLessThanOrEqual(PHONE.width);
  await bookmarkSelection(page, 'Tiny');

  await page.click('#btnEdMore');
  await menuItem(page, 'Оглавление и закладки').click();
  const fits = async (selector: string): Promise<void> => {
    const box = await page.locator(selector).first().boundingBox();
    expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 0) + (box?.width ?? 999)).toBeLessThanOrEqual(PHONE.width + 0.5);
  };
  await fits('.anchor-list__row');
  await fits('.sheet__foot');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  expect(overflow).toBe(false);
});

/** Where the marker of a bookmark on the scribble around this point is. */
function markerOf(ink: { x: number; y: number }): { x: number; y: number } {
  return { x: ink.x - 50, y: ink.y };
}

const linkMenu = (page: Page): Locator =>
  page.locator('#selbar').getByRole('button', { name: 'Ссылка и закладка' });

test('Make link, then Insert link elsewhere: a tap jumps there', async ({ page }) => {
  await newNotebook(page, 'Flow');
  const target = await scribble(page, 0.4, 0.3);
  await lassoAround(page, target);
  await linkMenu(page).click();
  await menuItem(page, 'Сделать ссылку…').click();
  await expect(page.locator('.sheet__title')).toHaveText('Сделать ссылку');
  await expect(page.getByText('Назовите для себя')).toBeVisible();
  await page.fill('#anchorName', 'Definition');
  await page.click('.sheet__foot .btn--primary');
  await expect(page.getByText('Закладка «Definition» сохранена')).toBeVisible();

  const source = await scribble(page, 0.4, 0.6);
  await lassoAround(page, source);
  await linkMenu(page).click();
  await menuItem(page, 'Вставить ссылку…').click();
  await expect(page.locator('.sheet__title')).toHaveText('Вставить ссылку');
  // The new bookmark waits first in the recent list.
  await expect(page.locator('.link-pick__heading').first()).toHaveText('Недавние');
  await page.locator('.link-pick__row', { hasText: 'Definition' }).first().click();
  await expect.poll(async () => (await storedPages(page, 'Flow'))[0]?.inkLinks.length).toBe(1);

  await page.keyboard.press('p');
  await tap(page, source);
  await expect(highlight(page)).toBeVisible();
});

test('a bookmark removed from its marker warns, breaks its link, and undo mends it', async ({ page }) => {
  await newNotebook(page, 'Marker');
  const target = await scribble(page, 0.4, 0.3);
  await lassoAround(page, target);
  await bookmarkSelection(page, 'Spot');
  const source = await scribble(page, 0.4, 0.6);
  await lassoAround(page, source);
  await linkMenu(page).click();
  await menuItem(page, 'Вставить ссылку…').click();
  await page.locator('.link-pick__row', { hasText: 'Spot' }).first().click();
  await expect.poll(async () => (await storedPages(page, 'Marker'))[0]?.inkLinks.length).toBe(1);

  await page.keyboard.press('p');
  await tap(page, markerOf(target));
  await expect(menuItem(page, 'Переименовать закладку')).toBeVisible();
  await expect(menuItem(page, 'Копировать ссылку')).toBeVisible();
  await menuItem(page, 'Удалить закладку').click();

  await expect(page.locator('.sheet')).toContainText('Перестанут работать ссылки: 1');
  await page.click('.sheet__foot .btn--danger');
  await expect.poll(async () => (await storedPages(page, 'Marker'))[0]?.anchors.length).toBe(0);

  await tap(page, source);
  await expect(page.locator('.sheet__title')).toHaveText('Цель удалена');
  await page.keyboard.press('Escape');
  await expect(page.locator('.sheet')).toHaveCount(0);

  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await storedPages(page, 'Marker'))[0]?.anchors.length).toBe(1);
  await tap(page, source);
  await expect(highlight(page)).toBeVisible();
});

test('a selection with a bookmark offers to remove it', async ({ page }) => {
  await newNotebook(page, 'Here');
  const ink = await scribble(page, 0.4, 0.3);
  await lassoAround(page, ink);
  await linkMenu(page).click();
  await expect(menuItem(page, 'Убрать закладку здесь')).toHaveCount(0);
  await menuItem(page, 'Сделать ссылку…').click();
  await page.fill('#anchorName', 'Ink');
  await page.click('.sheet__foot .btn--primary');
  await expect.poll(async () => (await storedPages(page, 'Here'))[0]?.anchors.length).toBe(1);

  await lassoAround(page, ink);
  await linkMenu(page).click();
  await menuItem(page, 'Убрать закладку здесь').click();
  await expect.poll(async () => (await storedPages(page, 'Here'))[0]?.anchors.length).toBe(0);
});
