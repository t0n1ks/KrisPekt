import { readFileSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { exportDownload } from './downloads';
import { firstLinkPixel } from './link-pixel';
import { pdfOutline, servePdfJs } from './pdf-view';

interface StoredRun {
  t: string;
  c?: string;
  b?: boolean;
  i?: boolean;
  fs?: number;
  link?: { kind: string };
}
interface StoredPara {
  align?: string;
  runs: StoredRun[];
}
interface StoredPage {
  id: string;
  title?: string;
  texts: { toc?: boolean; x: number; y: number; w: number; fs: number; paras?: StoredPara[] }[];
  anchors: { name: string }[];
}

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

const menuItem = (page: Page, label: string): Locator => page.locator('.menu__item', { hasText: label });

async function newNotebook(page: Page, title: string): Promise<void> {
  await page.goto('./');
  await page.locator('.subject').first().locator('.shelf__add').click();
  await page.fill('#nb-title', title);
  await page.click('.sheet__foot .btn--primary');
  await expect(page.locator('#editor')).toBeVisible();
  await page.locator('#tray [data-tool="pen"]').waitFor();
}

async function nameCurrentPage(page: Page, title: string): Promise<void> {
  await page.click('#pageChip');
  await page.fill('#pageTitle', title);
  await page.click('.sheet__foot .btn--primary');
  await expect(page.locator('#pageTitle')).toBeHidden();
}

async function openContents(page: Page): Promise<void> {
  await page.click('#btnEdMore');
  await menuItem(page, 'Оглавление и закладки').click();
}

/** A word in a new text box, with the link dialog open on the notes tab. */
async function linkDialogOnNewWord(page: Page): Promise<void> {
  await page.keyboard.press('t');
  const box = await page.locator('#stage').boundingBox();
  if (!box) throw new Error('no stage');
  await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.5);
  await page.keyboard.type('Word');
  await page.evaluate(() => {
    document.getSelection()?.selectAllChildren(document.getElementById('textEd') as HTMLElement);
  });
  await page.locator('.text-bar__button[aria-label="Вставить ссылку"]').click();
  await page.getByRole('button', { name: 'В моих записях' }).click();
}

test.use({ viewport: { width: 1200, height: 900 } });

test('a page title shows in the chip, the organizer, the picker and the contents', async ({ page }) => {
  await newNotebook(page, 'Titles');
  await expect(page.locator('#pageChip')).toHaveText('Страница 1');

  await nameCurrentPage(page, 'Лекция 5. Интегралы');
  await expect(page.locator('#pageChip')).toHaveText('Лекция 5. Интегралы');
  await expect.poll(async () => (await storedPages(page, 'Titles'))[0]?.title).toBe('Лекция 5. Интегралы');

  // Undo takes it back, redo brings it again.
  await page.keyboard.press('Control+z');
  await expect(page.locator('#pageChip')).toHaveText('Страница 1');
  await page.keyboard.press('Control+y');
  await expect(page.locator('#pageChip')).toHaveText('Лекция 5. Интегралы');

  // The organizer shows it, and renames from the thumbnail's menu.
  await page.click('#btnPages');
  await expect(page.locator('.page-item__title')).toHaveText('Лекция 5. Интегралы');
  await page.locator('.page-item__more').first().click();
  await menuItem(page, 'Переименовать страницу').click();
  await expect(page.locator('#pageTitle')).toHaveValue('Лекция 5. Интегралы');
  await page.fill('#pageTitle', 'Лекция 6');
  await page.click('.sheet__foot .btn--primary');
  await expect(page.locator('.page-item__title')).toHaveText('Лекция 6');
  await page.click('#panelClose');

  // The contents panel lists it, and a whole-page bookmark starts with its name.
  await openContents(page);
  await expect(page.locator('.anchor-list__name')).toHaveText('Лекция 6');
  await page.getByRole('button', { name: 'Закладка на эту страницу' }).click();
  await expect(page.locator('#anchorName')).toHaveValue('Лекция 6');
  await page.locator('.sheet__foot .btn--primary').last().click();
  await expect(page.locator('#anchorName')).toBeHidden();
  await expect(page.locator('.anchor-list__row')).toHaveCount(1);
  await page.locator('.sheet__foot .btn--primary').click();
  await expect
    .poll(async () => (await storedPages(page, 'Titles'))[0]?.texts[0]?.paras?.[0]?.runs[0]?.t)
    .toMatch(/^Лекция 6 \.+ с\. 1$/);

  // The picker finds it, and shows it when browsing.
  await linkDialogOnNewWord(page);
  await page.fill('#linkSearch', 'лекция');
  await expect(page.locator('.link-pick__row', { hasText: 'Лекция 6' }).first()).toBeVisible();
  await page.fill('#linkSearch', '');
  await page.locator('.link-pick__row:has(.link-pick__more)').first().click();
  await page.locator('.link-pick__row', { hasText: 'Titles' }).click();
  await expect(page.locator('.link-pick__row', { hasText: 'Лекция 6' })).toBeVisible();
});

test('an empty title goes back to the page number, and titles survive a reload', async ({ page }) => {
  await newNotebook(page, 'Empty');
  await nameCurrentPage(page, 'Stays');
  await expect.poll(async () => (await storedPages(page, 'Empty'))[0]?.title).toBe('Stays');
  await page.reload();
  await page.locator('.notebook-card__title', { hasText: 'Empty' }).click();
  await expect(page.locator('#pageChip')).toHaveText('Stays');

  await nameCurrentPage(page, '   ');
  await expect(page.locator('#pageChip')).toHaveText('Страница 1');
  await expect.poll(async () => (await storedPages(page, 'Empty'))[0]?.title).toBeUndefined();
});

test('a vector PDF has its titles and bookmarks as its outline', async ({ page }) => {
  await servePdfJs(page);
  await newNotebook(page, 'Outline');
  await nameCurrentPage(page, 'Глава первая');
  await page.click('#btnPages');
  await page.locator('.page-item__more').first().click();
  await menuItem(page, 'Дублировать').click();
  await expect(page.locator('.page-item')).toHaveCount(2);
  await page.locator('.page-item__more').nth(1).click();
  await menuItem(page, 'Переименовать страницу').click();
  await page.fill('#pageTitle', 'Kapitel zwei');
  await page.click('.sheet__foot .btn--primary');
  await page.locator('.page-item__more').nth(1).click();
  await menuItem(page, 'Добавить закладку').click();
  await page.fill('#anchorName', 'Закладка');
  await page.click('.sheet__foot .btn--primary');
  await page.click('#panelClose');

  await page.click('#btnEdMore');
  await menuItem(page, 'Экспорт').click();
  const sheet = page.locator('.sheet');
  await sheet.locator('.choice-list__item', { hasText: 'PDF (вектор' }).first().click();
  const download = exportDownload(page);
  await sheet.getByRole('button', { name: 'Экспортировать' }).click();
  const path = await (await download).path();
  const outline = await pdfOutline(page, readFileSync(path));
  expect(outline).toEqual([
    { title: 'Глава первая', page: 1, items: [] },
    { title: 'Kapitel zwei', page: 2, items: [{ title: 'Закладка', page: 2, items: [] }] },
  ]);
});

test('recent targets can be removed one by one and cleared', async ({ page }) => {
  await newNotebook(page, 'Recent');
  await page.click('#btnPages');
  await page.locator('.page-item__more').first().click();
  await menuItem(page, 'Добавить закладку').click();
  await page.fill('#anchorName', 'One');
  await page.click('.sheet__foot .btn--primary');
  await expect(page.locator('#anchorName')).toBeHidden();
  await page.locator('.page-item__more').first().click();
  await menuItem(page, 'Добавить закладку').click();
  await page.fill('#anchorName', 'Two');
  await page.click('.sheet__foot .btn--primary');
  await expect(page.locator('#anchorName')).toBeHidden();
  await page.click('#panelClose');

  await linkDialogOnNewWord(page);
  const recent = page.locator('.link-pick__recent');
  await expect(recent).toHaveCount(2);
  await expect(recent.first()).toContainText('Two');

  await recent.first().getByRole('button', { name: 'Убрать из недавних' }).click();
  await expect(recent).toHaveCount(1);
  await expect(recent.first()).toContainText('One');

  // The confirmation comes first; saying no keeps the list, and the dialog stays open.
  await page.locator('.link-pick__clear').click();
  await expect(page.locator('.sheet').last()).toContainText('Очистить недавние?');
  await page.keyboard.press('Escape');
  await expect(recent).toHaveCount(1);
  await page.locator('.link-pick__clear').click();
  await page.locator('.sheet__foot .btn--danger').last().click();
  await expect(recent).toHaveCount(0);
  await expect(page.locator('.link-pick__clear')).toHaveCount(0);
  await expect(page.locator('#linkSearch')).toBeVisible();

  // Stays empty the next time.
  await page.reload();
  await page.locator('.notebook-card__title', { hasText: 'Recent' }).click();
  await expect(page.locator('#editor')).toBeVisible();
  await linkDialogOnNewWord(page);
  await expect(recent).toHaveCount(0);
});

test('a styled table of contents keeps its look when updated', async ({ page }) => {
  await newNotebook(page, 'Styled');
  await nameCurrentPage(page, 'First');
  await openContents(page);
  await page.locator('.sheet__foot .btn--primary').click();
  await expect(page.locator('.sheet')).toHaveCount(0);
  const contents = async (): Promise<StoredPage['texts'][number] | undefined> =>
    (await storedPages(page, 'Styled'))[0]?.texts.find((text) => text.toc);
  await expect.poll(async () => (await contents())?.paras?.length).toBe(1);
  const before = await contents();
  if (!before) throw new Error('no contents');

  // Pick the box with the text tool and style all of it.
  await page.keyboard.press('t');
  const line = await firstLinkPixel(page);
  await page.mouse.click(line.x, line.y);
  await expect(page.locator('#textEd')).toBeVisible();
  await page.evaluate(() => {
    document.getSelection()?.selectAllChildren(document.getElementById('textEd') as HTMLElement);
  });
  await page.locator('.text-bar__button[aria-label="Жирный"]').click();
  await page.locator('.text-bar__button[aria-label="Курсив"]').click();
  await page.locator('.text-bar__button[aria-label="По центру"]').click();
  await page.locator('.text-bar__button[aria-label="Крупнее"]').click();
  await page.locator('.text-bar__button[aria-label="Цвет текста"]').click();
  await page.locator('.swatch').nth(1).click();
  await expect(page.locator('.text-bar__button[aria-label="Обновить оглавление"]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#textEd')).toBeHidden();
  await expect.poll(async () => (await contents())?.paras?.[0]?.runs[0]?.b).toBe(true);
  const chosen = (await contents())?.paras?.[0]?.runs[0];
  expect(chosen?.c).toMatch(/^#/);
  expect(chosen?.fs).toBeGreaterThan(before.fs);
  // The colour shows: nothing on the page is the colour of a link any more.
  await expect(firstLinkPixel(page)).rejects.toThrow();

  // A new line, from a bookmark, and the update.
  await page.click('#btnPages');
  await page.locator('.page-item__more').first().click();
  await menuItem(page, 'Добавить закладку').click();
  await page.fill('#anchorName', 'Second');
  await page.click('.sheet__foot .btn--primary');
  await expect(page.locator('#anchorName')).toBeHidden();
  await page.click('#panelClose');
  await page.keyboard.press('t');
  await page.mouse.click(line.x, line.y);
  await page.locator('.text-bar__button[aria-label="Обновить оглавление"]').click();

  await expect.poll(async () => (await contents())?.paras?.length).toBe(2);
  const after = await contents();
  expect([after?.x, after?.y, after?.w]).toEqual([before.x, before.y, before.w]);
  for (const para of after?.paras ?? []) {
    expect(para.align).toBe('center');
    expect(para.runs[0]).toMatchObject({ b: true, i: true, c: chosen?.c, fs: chosen?.fs });
    expect(para.runs[0]?.link).toBeDefined();
  }
});
