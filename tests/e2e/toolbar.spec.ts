import { expect, test, type Locator, type Page } from '@playwright/test';

const NOTEBOOK = 'Toolbar';
const PREFS_KEY = 'konspektnik.prefs.v1';

interface StoredStroke {
  b?: string;
  c: string;
  s: number;
}

async function open(page: Page): Promise<void> {
  await page.goto('./');
  await page.locator('.subject').first().locator('.shelf__add').click();
  await page.fill('#nb-title', NOTEBOOK);
  await page.click('.sheet__foot .btn--primary');
  await expect(page.locator('#editor')).toBeVisible();
}

async function reopen(page: Page): Promise<void> {
  await page.reload();
  await page.locator('.notebook-card__title', { hasText: NOTEBOOK }).click();
  await expect(page.locator('#editor')).toBeVisible();
}

function storedPrefs(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, unknown>,
    PREFS_KEY,
  );
}

function storedStrokes(page: Page): Promise<StoredStroke[]> {
  return page.evaluate(
    (title) =>
      new Promise<StoredStroke[]>((resolve) => {
        const req = indexedDB.open('konspektnik');
        req.onsuccess = () => {
          const tx = req.result.transaction(['notebooks', 'pages']);
          const notebooks = tx.objectStore('notebooks').getAll();
          const pages = tx.objectStore('pages').getAll();
          tx.oncomplete = () => {
            req.result.close();
            const id = (notebooks.result as { id: string; title: string }[]).find(
              (n) => n.title === title,
            )?.id;
            const rows = pages.result as { nbId: string; strokes: StoredStroke[] }[];
            resolve(rows.filter((r) => r.nbId === id).flatMap((r) => r.strokes));
          };
        };
      }),
    NOTEBOOK,
  );
}

/** A stroke in the middle of the stage, a bit lower each time. */
async function draw(page: Page, n: number): Promise<void> {
  const box = await page.locator('#stage').boundingBox();
  if (!box) throw new Error('no stage');
  const y = box.y + box.height * 0.3 + n * 30;
  await page.mouse.move(box.x + box.width * 0.4, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.55, y + 5, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await storedStrokes(page)).length).toBe(n + 1);
}

const tool = (page: Page, kind: string): Locator => page.locator(`#tray [data-tool="${kind}"]`);
const presets = (page: Page): Locator => page.locator('#tray [data-preset]');
const pop = (page: Page): Locator => page.locator('.popover');
const customizer = (page: Page): Locator => page.locator('#toolbarCustom');
const row = (page: Page, item: string): Locator => customizer(page).locator(`[data-row="${item}"]`);
const rowIds = (page: Page): Promise<(string | undefined)[]> =>
  customizer(page)
    .locator('[data-row]')
    .evaluateAll((rows) => rows.map((r) => (r as HTMLElement).dataset.row));
const barItems = (page: Page): Promise<(string | undefined)[]> =>
  page.locator('#tray [data-item]').evaluateAll((nodes) => nodes.map((n) => (n as HTMLElement).dataset.item));

/** With the pen's options open: picks a brush and pins it. */
async function pinBrush(page: Page, brushLabel: string): Promise<void> {
  await tool(page, 'pen').click();
  if (!(await tool(page, 'pen').getAttribute('aria-pressed'))?.includes('true'))
    await tool(page, 'pen').click();
  if (!(await pop(page).isVisible())) await tool(page, 'pen').click();
  await pop(page).getByRole('button', { name: brushLabel, exact: true }).click();
  await pop(page).locator('.popover__pin').click();
  await expect(pop(page)).toBeHidden();
}

async function setSlider(page: Page, value: number): Promise<void> {
  await pop(page)
    .locator('input[type=range]')
    .first()
    .evaluate((input, v) => {
      (input as HTMLInputElement).value = String(v);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, value);
}

/** Holds the mouse on a button until its long press fires. */
async function longPress(page: Page, target: Locator): Promise<void> {
  const box = await target.boundingBox();
  if (!box) throw new Error('nothing to press');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(650);
  await page.mouse.up();
}

test('pinned pencil and fountain pen: one tap switches, a change stays, a reload keeps it', async ({
  page,
}) => {
  await open(page);
  await draw(page, 0);
  expect((await storedStrokes(page))[0]?.b).toBeUndefined();

  await pinBrush(page, 'Карандаш');
  await expect(presets(page)).toHaveCount(1);
  // A new preset is in use at once; the base pen is not the active one any more.
  await expect(presets(page).first()).toHaveAttribute('aria-pressed', 'true');
  await expect(tool(page, 'pen')).toHaveAttribute('aria-pressed', 'false');

  await pinBrush(page, 'Перьевая ручка');
  await expect(presets(page)).toHaveCount(2);
  const [pencil, fountain] = [presets(page).nth(0), presets(page).nth(1)];
  await expect(pencil).toHaveAttribute('aria-label', /Карандаш/);
  await expect(fountain).toHaveAttribute('aria-label', /Перьевая/);

  await pencil.click();
  await draw(page, 1);
  await fountain.click();
  await draw(page, 2);
  const strokes = await storedStrokes(page);
  expect(strokes[1]?.b).toBe('pencil');
  expect(strokes[2]?.b).toBe('fountain');

  // A tap on the preset in use opens its settings; a change there goes into the preset.
  await fountain.click();
  await expect(pop(page)).toBeVisible();
  await setSlider(page, 7.5);
  await pop(page).locator('.palette__grid button').nth(4).click();
  const color = (await storedPrefs(page)).presets as { c: string }[];
  await page.keyboard.press('Escape');
  await page.mouse.click(5, 300);
  await expect(pop(page)).toBeHidden();
  await draw(page, 3);
  const last = (await storedStrokes(page))[3];
  expect(last).toMatchObject({ b: 'fountain', s: 7.5, c: color[1]?.c });
  await pencil.click();
  await draw(page, 4);
  expect((await storedStrokes(page))[4]?.b).toBe('pencil');

  await reopen(page);
  const after = (await storedPrefs(page)).presets as { brush: string; s: number; c: string }[];
  expect(after[1]).toMatchObject({ brush: 'fountain', s: 7.5, c: last?.c });
  await expect(presets(page)).toHaveCount(2);
  // The base pen is on the last brush picked for it, with that brush's own settings: the width
  // and colour given to the preset stayed with the preset.
  await tool(page, 'pen').click();
  await draw(page, 5);
  expect((await storedStrokes(page))[5]).toMatchObject({ b: 'fountain', s: 2.4, c: '#172554' });
});

test('a long press on a preset: edit, duplicate, unpin', async ({ page }) => {
  await open(page);
  await pinBrush(page, 'Карандаш');
  await tool(page, 'hl').click();
  await longPress(page, presets(page).first());
  const menu = page.locator('.menu');
  await menu.getByText('Дублировать').click();
  await expect(presets(page)).toHaveCount(2);

  await longPress(page, presets(page).nth(1));
  await menu.getByText('Настроить').click();
  await expect(pop(page)).toBeVisible();
  await expect(presets(page).nth(1)).toHaveAttribute('aria-pressed', 'true');
  await page.mouse.click(5, 300);

  await longPress(page, presets(page).nth(1));
  await menu.getByText('Открепить').click();
  await expect(presets(page)).toHaveCount(1);
  await expect(tool(page, 'pen')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => ((await storedPrefs(page)).presets as unknown[]).length).toBe(1);
});

test('an eraser preset switches its mode on a second tap, like the base eraser', async ({ page }) => {
  await open(page);
  await tool(page, 'eraser').click();
  await longPress(page, tool(page, 'eraser'));
  await pop(page).locator('.popover__pin').click();
  const preset = presets(page).first();
  await expect(preset.locator('.tool-tray__badge--dot')).toBeVisible();
  await preset.click();
  await expect(preset.locator('.tool-tray__badge--line')).toBeVisible();
  await expect(pop(page)).toBeHidden();
  const stored = (await storedPrefs(page)).presets as { mode: string }[];
  expect(stored[0]?.mode).toBe('whole');
  // The base eraser kept its own mode.
  await expect(tool(page, 'eraser').locator('.tool-tray__badge--dot')).toBeVisible();
});

test('the stylus eraser end still erases with a pen preset in use', async ({ page }) => {
  await open(page);
  await pinBrush(page, 'Карандаш');
  await draw(page, 0);
  const box = await page.locator('#stage').boundingBox();
  if (!box) throw new Error('no stage');
  const y = box.y + box.height * 0.3;
  await page.evaluate(
    ({ x0, x1, yy }) => {
      const canvas = document.querySelector('#stage canvas') as HTMLCanvasElement;
      canvas.setPointerCapture = () => undefined;
      const send = (type: string, x: number, buttons: number): void => {
        canvas.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            pointerId: 7,
            pointerType: 'pen',
            clientX: x,
            clientY: yy,
            button: type === 'pointermove' ? -1 : 5,
            buttons,
            pressure: 0.5,
          }),
        );
      };
      send('pointerdown', x0, 32);
      for (let x = x0; x <= x1; x += 8) send('pointermove', x, 32);
      send('pointerup', x1, 0);
    },
    { x0: box.x + box.width * 0.38, x1: box.x + box.width * 0.57, yy: y + 2 },
  );
  await expect.poll(async () => JSON.stringify(await storedStrokes(page))).not.toContain('pencil');
  await expect(presets(page).first()).toHaveAttribute('aria-pressed', 'true');
});

test('customise mode: reorder by drag and by buttons, hide, reset; saved at once', async ({ page }) => {
  await open(page);
  await page.click('#btnEdMore');
  await page.locator('.menu').getByText('Настроить панель').click();
  await expect(customizer(page)).toBeVisible();
  expect((await rowIds(page))[0]).toBe('pen');

  // By drag: the pen goes below the lasso.
  const grip = row(page, 'pen').locator('.toolbar-custom__grip');
  const from = await grip.boundingBox();
  const to = await row(page, 'lasso').boundingBox();
  if (!from || !to) throw new Error('no rows');
  await page.mouse.move(from.x + 22, from.y + 22);
  await page.mouse.down();
  await page.mouse.move(from.x + 22, to.y + to.height * 0.8, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => rowIds(page)).toEqual(expect.arrayContaining(['pen']));
  expect((await rowIds(page)).slice(0, 4)).toEqual(['hl', 'eraser', 'lasso', 'pen']);
  expect((await barItems(page)).slice(0, 4)).toEqual(['hl', 'eraser', 'lasso', 'pen']);

  // By the accessible buttons, with the focus staying on the button.
  const left = row(page, 'pen').getByRole('button', { name: /Переместить влево/ });
  await left.focus();
  await page.keyboard.press('Enter');
  expect((await rowIds(page)).slice(0, 4)).toEqual(['hl', 'eraser', 'pen', 'lasso']);
  await expect(row(page, 'pen').getByRole('button', { name: /Переместить влево/ })).toBeFocused();

  // Hide and show.
  await row(page, 'ruler')
    .getByRole('button', { name: /Скрыть/ })
    .click();
  expect(await barItems(page)).not.toContain('ruler');
  await expect(row(page, 'undo').getByRole('button', { name: /Скрыть/ })).toBeDisabled();
  await expect(row(page, 'redo').getByRole('button', { name: /Скрыть/ })).toBeDisabled();

  // Everything is saved before Done.
  const saved = (await storedPrefs(page)).toolbar as { hidden: string[]; order: string[] };
  expect(saved.hidden).toEqual(['hand', 'ruler']);
  await customizer(page).getByRole('button', { name: 'Готово' }).click();
  await expect(customizer(page)).toBeHidden();

  await reopen(page);
  expect(await barItems(page)).not.toContain('ruler');
  expect((await barItems(page)).slice(0, 3)).toEqual(['hl', 'eraser', 'pen']);

  // Into customise mode from the More popover, this time.
  await page.click('#btnTrayMore');
  await page.click('#btnCustomizeToolbar');
  await customizer(page).getByRole('button', { name: 'Сбросить по умолчанию' }).click();
  expect((await barItems(page)).slice(0, 2)).toEqual(['pen', 'hl']);
  expect(await barItems(page)).toContain('ruler');
  await page.keyboard.press('Escape');
  await expect(customizer(page)).toBeHidden();
});

test('a long press on the bar itself opens customise mode', async ({ page }) => {
  await open(page);
  const bar = await page.locator('#tray').boundingBox();
  if (!bar) throw new Error('no bar');
  // The bar's own edge, between the border and the first button.
  await page.mouse.move(bar.x + 3, bar.y + bar.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(650);
  await page.mouse.up();
  await expect(customizer(page)).toBeVisible();
  // A long press on a button does not.
  await page.keyboard.press('Escape');
  await longPress(page, tool(page, 'pen'));
  await expect(customizer(page)).toBeHidden();
});

test('a preset can be added from customise mode without being put in use', async ({ page }) => {
  await open(page);
  await page.click('#btnEdMore');
  await page.locator('.menu').getByText('Настроить панель').click();
  await customizer(page).getByRole('button', { name: 'Добавить набор' }).click();
  await page.locator('.menu').getByText('Перьевая ручка').click();
  await expect(customizer(page).locator('[data-row^="preset:"]')).toHaveCount(1);
  await expect(presets(page)).toHaveCount(1);
  await expect(tool(page, 'pen')).toHaveAttribute('aria-pressed', 'true');
});

test('a narrow window moves items into More and back, and the active tool stays', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await open(page);
  const wide = await barItems(page);
  expect(wide).toEqual([
    'pen',
    'hl',
    'eraser',
    'lasso',
    'text',
    'colors',
    'ruler',
    'image',
    'attach',
    'undo',
    'redo',
  ]);
  await page.click('#btnTrayMore');
  await expect(page.locator('.toolbar-grid__cell')).toHaveCount(0);
  await page.mouse.click(5, 300);

  await page.setViewportSize({ width: 390, height: 800 });
  await expect.poll(() => barItems(page)).not.toContain('image');
  const narrow = await barItems(page);
  expect(narrow).toContain('undo');
  expect(narrow).toContain('redo');
  expect(narrow).toContain('pen');
  // Nothing sticks out, and it all has a proper touch size.
  const fit = await page.locator('#tray').evaluate((tray) => ({
    scroll: tray.scrollWidth,
    client: tray.clientWidth,
    right: tray.getBoundingClientRect().right,
    sizes: Array.from(tray.querySelectorAll('button')).map((b) => {
      const r = b.getBoundingClientRect();
      return [r.width, r.height];
    }),
    labels: Array.from(tray.querySelectorAll('button')).every((b) => b.getAttribute('aria-label') && b.title),
  }));
  expect(fit.scroll).toBeLessThanOrEqual(fit.client);
  expect(fit.right).toBeLessThanOrEqual(390);
  expect(fit.labels).toBe(true);
  for (const [w, h] of fit.sizes) {
    expect(w).toBeGreaterThanOrEqual(44);
    expect(h).toBeGreaterThanOrEqual(44);
  }

  // A tool from More moves to the bar while it is in use, and something else makes room.
  await page.click('#btnTrayMore');
  const cell = page.locator('.toolbar-grid__cell', { hasText: 'Текст' });
  await expect(cell).toBeVisible();
  await cell.locator('button').click();
  await expect(page.locator('.menu')).toBeHidden();
  await expect(tool(page, 'text')).toHaveAttribute('aria-pressed', 'true');
  expect(await barItems(page)).toContain('undo');
  await expect
    .poll(async () => await page.locator('#tray').evaluate((t) => t.scrollWidth <= t.clientWidth))
    .toBe(true);

  // The way back: wide again, nothing is left in More.
  await page.setViewportSize({ width: 1200, height: 800 });
  await expect.poll(() => barItems(page)).toEqual(wide);
});

test('a hidden tool in use shows on the bar until another one is chosen', async ({ page }) => {
  await open(page);
  await page.click('#btnEdMore');
  await page.locator('.menu').getByText('Настроить панель').click();
  await row(page, 'text')
    .getByRole('button', { name: /Скрыть/ })
    .click();
  await customizer(page).getByRole('button', { name: 'Готово' }).click();
  expect(await barItems(page)).not.toContain('text');
  await page.keyboard.press('t');
  expect(await barItems(page)).toContain('text');
  await page.keyboard.press('p');
  expect(await barItems(page)).not.toContain('text');
});

test('damaged toolbar settings give the default bar and keep other settings', async ({ page }) => {
  // Written before the app starts, not after page.goto: the first boot saves its own settings when
  // it seeds the sample, and that save could land after the damaged ones and replace them.
  await page.addInitScript((key) => {
    localStorage.setItem(
      key,
      JSON.stringify({
        autoBackup: 'off',
        favs: ['#123456'],
        toolbar: { order: 7, hidden: null },
        presets: [{ id: '<img onerror=1>', tool: 'pen', brush: 'x', c: 'red', s: 99 }, 'junk'],
      }),
    );
  }, PREFS_KEY);
  await open(page);
  await expect(presets(page)).toHaveCount(0);
  await expect(page.locator('#tray .tool-tray__swatch')).toHaveCount(1);
  expect((await barItems(page))[0]).toBe('pen');
});
