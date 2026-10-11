import { expect, test, type Page } from '@playwright/test';

/** Counts strokes on the first page of a notebook, straight from IndexedDB. */
function strokeCount(page: Page, title: string): Promise<number> {
  return page.evaluate(
    (nbTitle) =>
      new Promise<number>((resolve) => {
        const req = indexedDB.open('konspektnik', 1);
        req.onsuccess = () => {
          const tx = req.result.transaction(['notebooks', 'pages']);
          const nbs = tx.objectStore('notebooks').getAll();
          nbs.onsuccess = () => {
            const nb = (nbs.result as { title: string; pageIds: string[] }[]).find(
              (n) => n.title === nbTitle,
            );
            const pg = tx.objectStore('pages').get(nb?.pageIds[0] ?? '');
            pg.onsuccess = () =>
              resolve((pg.result as { strokes: unknown[] } | undefined)?.strokes.length ?? -1);
          };
        };
      }),
    title,
  );
}

test('shelf, notebook, drawing, persistence and language', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  await page.goto('./');
  await expect(page.locator('.notebook-card')).toHaveCount(2);

  await page.click('#btnAddSubject');
  await page.fill('#subj-name', '<b>Физика</b>');
  await page.click('.sheet__foot .btn--primary');
  await expect(page.locator('.subject__name').last()).toHaveText('<b>Физика</b>');

  await page.locator('.subject').last().locator('.shelf__add').click();
  await page.fill('#nb-title', 'Smoke');
  await page.click('.sheet__foot .btn--primary');
  await expect(page.locator('#editor')).toBeVisible();
  await expect(page.locator('#edTitle')).toHaveText('Smoke');

  await page.mouse.move(300, 400);
  await page.mouse.down();
  for (let i = 0; i < 20; i++) await page.mouse.move(300 + i * 10, 400 + Math.sin(i / 3) * 20);
  await page.mouse.up();
  await expect.poll(() => strokeCount(page, 'Smoke')).toBe(1);

  await page.click('#btnUndo');
  await expect.poll(() => strokeCount(page, 'Smoke')).toBe(0);
  await page.click('#btnRedo');
  await expect.poll(() => strokeCount(page, 'Smoke')).toBe(1);

  await page.reload();
  await expect(page.locator('.notebook-card__title', { hasText: 'Smoke' })).toBeVisible();

  await page.click('#btnLang');
  await page.click('.menu__item:has-text("English")');
  await expect(page.locator('#btnAddNb')).toContainText('Notebook');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');

  expect(errors).toEqual([]);
});
