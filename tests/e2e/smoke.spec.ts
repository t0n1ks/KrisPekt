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

/** Brush ids of the strokes on the first page of a notebook, straight from IndexedDB. */
function strokeBrushes(page: Page, title: string): Promise<(string | null)[]> {
  return page.evaluate(
    (nbTitle) =>
      new Promise<(string | null)[]>((resolve) => {
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
              resolve(
                ((pg.result as { strokes: { b?: string }[] } | undefined)?.strokes ?? []).map(
                  (s) => s.b ?? null,
                ),
              );
          };
        };
      }),
    title,
  );
}

/** A gentle wave from (x, y), 400 px wide. */
async function drawWave(page: Page, x: number, y: number): Promise<void> {
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 0; i <= 30; i++) await page.mouse.move(x + i * 13, y + Math.sin(i / 3) * 8);
  await page.mouse.up();
}

/** A vertical drag at x from y0 to y1 (used to erase). */
async function dragDown(page: Page, x: number, y0: number, y1: number): Promise<void> {
  await page.mouse.move(x, y0);
  await page.mouse.down();
  for (let y = y0; y <= y1; y += 4) await page.mouse.move(x, y);
  await page.mouse.up();
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

test('brushes, eraser modes and persistence', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  await page.goto('./');
  await page.locator('.subject').first().locator('.shelf__add').click();
  await page.fill('#nb-title', 'Brushes');
  await page.click('.sheet__foot .btn--primary');
  await expect(page.locator('#editor')).toBeVisible();

  const brushes = ['ballpoint', 'fountain', 'fineliner', 'pencil', 'brush'];
  for (const [i, brush] of brushes.entries()) {
    await page.click('[data-tool="pen"]');
    await page.click(`[data-brush="${brush}"]`);
    await expect(page.locator(`[data-brush="${brush}"]`)).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Escape');
    await drawWave(page, 300, 250 + i * 70);
  }
  await expect
    .poll(() => strokeBrushes(page, 'Brushes'))
    .toEqual([null, 'fountain', 'fineliner', 'pencil', 'brush']);

  // Pixel eraser (default): cutting through the ballpoint line splits it in two.
  await page.click('[data-tool="eraser"]');
  await expect(page.locator('[data-tool="eraser"] .tool-tray__badge--dot')).toBeVisible();
  await dragDown(page, 500, 225, 275);
  await expect.poll(async () => (await strokeBrushes(page, 'Brushes')).length).toBe(6);

  // Tapping the active eraser switches to the stroke eraser.
  await page.click('[data-tool="eraser"]');
  await expect(page.locator('[data-tool="eraser"] .tool-tray__badge--line')).toBeVisible();
  await expect(page.locator('.toast')).toHaveText('Ластик по штрихам');
  await dragDown(page, 600, 300, 340);
  await expect
    .poll(() => strokeBrushes(page, 'Brushes'))
    .toEqual([null, null, 'fineliner', 'pencil', 'brush']);

  // Back to the pixel eraser: the paint-brush stroke is split and both parts keep their brush.
  await page.click('[data-tool="eraser"]');
  await expect(page.locator('[data-tool="eraser"] .tool-tray__badge--dot')).toBeVisible();
  await dragDown(page, 500, 505, 555);
  await expect
    .poll(() => strokeBrushes(page, 'Brushes'))
    .toEqual([null, null, 'fineliner', 'pencil', 'brush', 'brush']);

  await page.reload();
  await expect
    .poll(() => strokeBrushes(page, 'Brushes'))
    .toEqual([null, null, 'fineliner', 'pencil', 'brush', 'brush']);
  await page.locator('.notebook-card', { hasText: 'Brushes' }).locator('.notebook-card__cover').click();
  await expect(page.locator('#editor')).toBeVisible();
  await expect(page.locator('[data-tool="eraser"] .tool-tray__badge--dot')).toBeVisible();

  expect(errors).toEqual([]);
});
