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

/** Subject names in stored order, straight from IndexedDB. */
function storedSubjectNames(page: Page): Promise<string[]> {
  return page.evaluate(
    () =>
      new Promise<string[]>((resolve) => {
        const req = indexedDB.open('konspektnik', 1);
        req.onsuccess = () => {
          const all = req.result.transaction('subjects').objectStore('subjects').getAll();
          all.onsuccess = () =>
            resolve(
              (all.result as { name: string; order: number }[])
                .sort((a, b) => a.order - b.order)
                .map((s) => s.name),
            );
        };
      }),
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

test('automatic backup downloads when due, and the file restores', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('./');
  await expect(page.locator('.notebook-card')).toHaveCount(2);
  await expect(page.locator('#libBackup')).toHaveText('Последняя копия: ещё не было');

  // Pretend the last backup is 4 days old and something changed since.
  await page.evaluate(() => {
    const key = 'konspektnik.prefs.v1';
    const prefs = JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, unknown>;
    const day = 24 * 60 * 60 * 1000;
    prefs.lastBackupAt = Date.now() - 4 * day;
    prefs.lastChangeAt = Date.now() - 60 * 60 * 1000;
    localStorage.setItem(key, JSON.stringify(prefs));
  });
  await expect(page.locator('#libBackup')).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.reload();
  await expect(page.locator('#libBackup')).toHaveText('Последняя копия: 4 дня назад');
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^krispekt-backup-\d{4}-\d{2}-\d{2}\.json$/);
  await expect(page.locator('.toast')).toHaveText('Резервная копия сохранена в Загрузки');
  await expect(page.locator('.backup-banner')).toBeVisible();
  await expect(page.locator('#libBackup')).toHaveText('Последняя копия: сегодня');
  const file = await download.path();

  // The automatic file restores like a manual backup.
  await page.click('.backup-banner .icon-btn');
  await expect(page.locator('.backup-banner')).toHaveCount(0);
  await page.click('#btnLibMore');
  const chooserPromise = page.waitForEvent('filechooser');
  await page.click('.menu__item:has-text("Восстановить")');
  await (await chooserPromise).setFiles(file);
  await page.click('.sheet__foot .btn--primary');
  await expect(page.locator('.toast')).toHaveText('Копия восстановлена');
  await expect(page.locator('.notebook-card')).toHaveCount(2);

  // Only one automatic download per session, and not again after a reload (nothing changed).
  let extra = 0;
  page.on('download', () => extra++);
  await page.reload();
  await page.waitForTimeout(3000);
  expect(extra).toBe(0);
  expect(errors).toEqual([]);
});

test('subjects reorder with the menu and by dragging, and the order persists', async ({ page }) => {
  await page.goto('./');
  const names = page.locator('.subject__name');
  await expect(names).toHaveCount(2);
  const [first, second] = await names.allTextContents();

  await page.locator('.subject').first().locator('.subject__more').click();
  await page.click('.menu__item:has-text("Ниже")');
  await expect(names).toHaveText([second ?? '', first ?? '']);
  await page.reload();
  await expect(names).toHaveText([second ?? '', first ?? '']);

  // Drag the second subject's handle above the first one.
  const handle = page.locator('.subject').nth(1).locator('.subject__handle');
  const box = await handle.boundingBox();
  const target = await page.locator('.subject').first().boundingBox();
  if (!box || !target) throw new Error('missing layout');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, target.y + 5, { steps: 12 });
  await page.mouse.up();
  await expect(names).toHaveText([first ?? '', second ?? '']);
  // The drop updates the shelf at once; wait until the new order is stored.
  await expect.poll(() => storedSubjectNames(page)).toEqual([first, second]);
  await page.reload();
  await expect(names).toHaveText([first ?? '', second ?? '']);
});
