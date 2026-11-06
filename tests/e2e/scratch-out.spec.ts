import { expect, test, type Page } from '@playwright/test';

const NOTEBOOK = 'Scratch';
const PREFS_KEY = 'konspektnik.prefs.v1';

type XY = readonly [number, number];

interface StoredStroke {
  id: string;
  k: string;
  p: number[];
}

interface StoredPage {
  strokes: StoredStroke[];
  texts: { t: string; paras?: { runs: { t: string; b?: boolean }[] }[] }[];
  images: unknown[];
}

async function open(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.goto('./');
  await page.locator('.subject').first().locator('.shelf__add').click();
  await page.fill('#nb-title', NOTEBOOK);
  await page.click('.sheet__foot .btn--primary');
  await expect(page.locator('#editor')).toBeVisible();
  await page.locator('#tray [data-tool="pen"]').waitFor();
}

function stored(page: Page): Promise<StoredPage> {
  return page.evaluate(
    (title) =>
      new Promise<StoredPage>((resolve) => {
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
            const row = (pages.result as (StoredPage & { nbId: string })[]).find((r) => r.nbId === id);
            resolve({ strokes: row?.strokes ?? [], texts: row?.texts ?? [], images: row?.images ?? [] });
          };
        };
      }),
    NOTEBOOK,
  );
}

const strokeCount = async (page: Page): Promise<number> => (await stored(page)).strokes.length;

/** Screen position of a spot given relative to the stage's top left corner. */
async function stageOrigin(page: Page): Promise<XY> {
  const box = await page.locator('#stage').boundingBox();
  if (!box) throw new Error('no stage');
  return [box.x, box.y];
}

/** A real mouse stroke through the corners, at the app's normal pen flow. */
async function drawThrough(page: Page, corners: readonly XY[]): Promise<void> {
  const [ox, oy] = await stageOrigin(page);
  const [first, ...rest] = corners;
  if (!first) return;
  await page.mouse.move(ox + first[0], oy + first[1]);
  await page.mouse.down();
  for (const [x, y] of rest) await page.mouse.move(ox + x, oy + y, { steps: 14 });
  await page.mouse.up();
}

/** A word of three letters, each a small zig of a few strokes; x, y is its top left corner. */
async function writeWord(page: Page, x: number, y: number): Promise<void> {
  for (let i = 0; i < 3; i++) {
    const left = x + i * 26;
    await drawThrough(page, [
      [left, y + 24],
      [left + 9, y],
      [left + 18, y + 24],
    ]);
  }
}

const zigzag = (x: number, y: number, width: number, legs: number, drop: number): XY[] =>
  Array.from({ length: legs + 1 }, (_, i): XY => [i % 2 ? x + width : x, y + i * drop]);

const WORD_Y = 300;
const WORD_1 = 200;
const WORD_2 = 330;
const WORD_3 = 460;
const LETTERS = 3;

test('a word is scratched out, its neighbours stay, undo brings it back', async ({ page }) => {
  await open(page);
  for (const x of [WORD_1, WORD_2, WORD_3]) await writeWord(page, x, WORD_Y);
  await expect.poll(() => strokeCount(page)).toBe(3 * LETTERS);
  const before = (await stored(page)).strokes.map((s) => s.id);

  await drawThrough(page, zigzag(WORD_2 - 2, WORD_Y + 3, 72, 8, 2.4));
  await expect.poll(() => strokeCount(page)).toBe(2 * LETTERS);
  const after = (await stored(page)).strokes.map((s) => s.id);
  expect(after).toEqual([...before.slice(0, LETTERS), ...before.slice(2 * LETTERS)]);

  // The first times there is a hint, with an undo of its own.
  const hint = page.locator('.snackbar');
  await expect(hint).toContainText('Зачёркнутое удалено');

  // One step brings it all back, and the scribble does not come with it.
  await page.click('#btnUndo');
  await expect.poll(async () => (await stored(page)).strokes.map((s) => s.id)).toEqual(before);
  await expect(page.locator('#btnUndo')).toBeEnabled();
  await page.click('#btnRedo');
  await expect.poll(() => strokeCount(page)).toBe(2 * LETTERS);
});

test('the hint offers undo, and shows only the first three times', async ({ page }) => {
  await open(page);
  await writeWord(page, WORD_1, WORD_Y);
  await expect.poll(() => strokeCount(page)).toBe(LETTERS);
  const scratch = (): Promise<void> => drawThrough(page, zigzag(WORD_1 - 2, WORD_Y + 3, 72, 8, 2.4));
  await scratch();
  await expect.poll(() => strokeCount(page)).toBe(0);
  await page.locator('.snackbar__action').click();
  await expect.poll(() => strokeCount(page)).toBe(LETTERS);

  const hints = async (): Promise<number> => {
    const prefs = await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key) ?? '{}') as { scratch?: { hints?: number } },
      PREFS_KEY,
    );
    return prefs.scratch?.hints ?? 0;
  };
  expect(await hints()).toBe(1);
  await scratch();
  await expect.poll(() => strokeCount(page)).toBe(0);
  await page.click('#btnUndo');
  await expect.poll(() => strokeCount(page)).toBe(LETTERS);
  await scratch();
  await expect.poll(() => strokeCount(page)).toBe(0);
  await page.click('#btnUndo');
  await expect.poll(() => strokeCount(page)).toBe(LETTERS);
  expect(await hints()).toBe(3);

  // The last hint goes away by itself, and no other comes after it.
  await expect(page.locator('.snackbar')).toBeHidden({ timeout: 6000 });
  await scratch();
  await expect.poll(() => strokeCount(page)).toBe(0);
  await expect(page.locator('.snackbar')).toBeHidden();
  expect(await hints()).toBe(3);
});

test('a typed word is removed from its box, the rest stays', async ({ page }) => {
  await open(page);
  const [ox, oy] = await stageOrigin(page);
  await page.locator('#tray [data-tool="text"]').click();
  await page.mouse.click(ox + 300, oy + 300);
  await page.keyboard.type('alpha bravo charlie');
  await page.locator('#tray [data-tool="pen"]').click();
  await expect.poll(async () => (await stored(page)).texts[0]?.t).toBe('alpha bravo charlie');

  // Where the middle word is: the app measures with the real font, so ask the canvas the same.
  // A new box is centred on the tap, so the letters lie around y = 300.
  const geometry = await page.evaluate(() => {
    const ctx = document.createElement('canvas').getContext('2d');
    if (!ctx) throw new Error('no canvas');
    ctx.font = '18px Onest';
    return { before: ctx.measureText('alpha ').width, word: ctx.measureText('bravo').width };
  });
  const zoom = await page.locator('#btnZoom').innerText();
  const k = parseInt(zoom, 10) / 100;
  const left = 300 + geometry.before * k;
  const width = geometry.word * k;
  await drawThrough(page, zigzag(left + 1, 300 - 7 * k, width - 2, 8, 1.8 * k));
  await expect.poll(async () => (await stored(page)).texts[0]?.t).toBe('alpha charlie');
  expect((await stored(page)).strokes).toEqual([]);

  await page.click('#btnUndo');
  await expect.poll(async () => (await stored(page)).texts[0]?.t).toBe('alpha bravo charlie');
});

test('a zigzag on an empty area stays as a stroke', async ({ page }) => {
  await open(page);
  await writeWord(page, WORD_1, WORD_Y);
  await expect.poll(() => strokeCount(page)).toBe(LETTERS);
  await drawThrough(page, zigzag(WORD_1, WORD_Y + 200, 80, 8, 2.4));
  await expect.poll(() => strokeCount(page)).toBe(LETTERS + 1);
  await expect(page.locator('.snackbar')).toBeHidden();
});

test('a strike-through, or a scribble with the highlighter, erases nothing', async ({ page }) => {
  await open(page);
  await writeWord(page, WORD_1, WORD_Y);
  await expect.poll(() => strokeCount(page)).toBe(LETTERS);
  // A strike-through with the pen stays a stroke beside the letters it crosses.
  await drawThrough(page, [
    [WORD_1 - 5, WORD_Y + 12],
    [WORD_1 + 80, WORD_Y + 12],
  ]);
  await expect.poll(() => strokeCount(page)).toBe(LETTERS + 1);
  // The same scribble as above, with the highlighter: only the pen scratches out.
  await page.locator('#tray [data-tool="hl"]').click();
  await drawThrough(page, zigzag(WORD_1 - 2, WORD_Y + 3, 72, 8, 2.4));
  await expect.poll(() => strokeCount(page)).toBe(LETTERS + 2);
});

async function openScratchMenu(page: Page): Promise<void> {
  await page.click('#btnEdMore');
  await page.locator('.menu').getByText('Стирать зачёркиванием').click();
  await expect(page.locator('.menu__item', { hasText: 'Обычная чувствительность' })).toBeVisible();
}

test('with the setting off nothing is erased; it stays off after a reload', async ({ page }) => {
  await open(page);
  await writeWord(page, WORD_1, WORD_Y);
  await expect.poll(() => strokeCount(page)).toBe(LETTERS);
  await openScratchMenu(page);
  await page.locator('.menu__item', { hasText: 'Стирать зачёркиванием' }).click();
  await expect
    .poll(async () =>
      page.evaluate(
        (key) =>
          (JSON.parse(localStorage.getItem(key) ?? '{}') as { scratch?: { on?: boolean } }).scratch?.on,
        PREFS_KEY,
      ),
    )
    .toBe(false);

  await drawThrough(page, zigzag(WORD_1 - 2, WORD_Y + 3, 72, 8, 2.4));
  await expect.poll(() => strokeCount(page)).toBe(LETTERS + 1);

  await page.reload();
  await page.locator('.notebook-card__title', { hasText: NOTEBOOK }).click();
  await expect(page.locator('#editor')).toBeVisible();
  await page.click('#btnEdMore');
  await expect(page.locator('.menu')).toContainText('Стирать зачёркиванием · выкл.');
});

test('the sensitivity can be changed and is greyed out while off', async ({ page }) => {
  await open(page);
  await openScratchMenu(page);
  await page.locator('.menu__item', { hasText: 'Высокая чувствительность' }).click();
  await page.click('#btnEdMore');
  await expect(page.locator('.menu')).toContainText('Стирать зачёркиванием · Высокая чувствительность');
  await page.locator('.menu').getByText('Стирать зачёркиванием').click();
  await page.locator('.menu__item', { hasText: 'Стирать зачёркиванием' }).click();
  await openScratchMenu(page);
  await expect(page.locator('.menu__item', { hasText: 'Высокая чувствительность' })).toBeDisabled();
});

test('the diagnostics show how the last stroke was judged', async ({ page }) => {
  await open(page);
  await writeWord(page, WORD_1, WORD_Y);
  await expect.poll(() => strokeCount(page)).toBe(LETTERS);
  const box = page.locator('#inputDiag');
  await page.click('#btnEdMore');
  const finger = page.locator('.menu__item', { hasText: 'Рисовать пальцем' });
  await finger.click({ button: 'right' });
  await expect(box).toBeVisible();
  await expect(box).toContainText('оставлено: похоже на письмо');

  await drawThrough(page, zigzag(WORD_1 - 2, WORD_Y + 3, 72, 8, 2.4));
  await expect(box).toContainText('зачёркивание: удалено');
  await expect(box).toContainText('развороты 7');
  await expect(box).toContainText(/Покрытие: удалено 3 из \d+ рядом, лучшее \d+%/);

  await drawThrough(page, zigzag(WORD_1, WORD_Y + 200, 80, 8, 2.4));
  await expect(box).toContainText('оставлено: ничего не закрыто в достаточной мере');
});

test('an image under a scribble is untouched', async ({ page }) => {
  await open(page);
  await page.evaluate(
    (title) =>
      new Promise<void>((resolve) => {
        const req = indexedDB.open('konspektnik');
        req.onsuccess = () => {
          const tx = req.result.transaction(['notebooks', 'pages'], 'readwrite');
          const list = tx.objectStore('notebooks').getAll();
          list.onsuccess = () => {
            const id = (list.result as { id: string; title: string }[]).find((n) => n.title === title)?.id;
            const pages = tx.objectStore('pages').getAll();
            pages.onsuccess = () => {
              const row = (pages.result as { nbId: string; images: unknown[] }[]).find((r) => r.nbId === id);
              if (!row) return;
              row.images = [{ id: 'img1', x: 0, y: 0, w: 700, h: 700, blob: 'missing' }];
              tx.objectStore('pages').put(row);
            };
          };
          tx.oncomplete = () => {
            req.result.close();
            resolve();
          };
        };
      }),
    NOTEBOOK,
  );
  await page.reload();
  await page.locator('.notebook-card__title', { hasText: NOTEBOOK }).click();
  await expect(page.locator('#editor')).toBeVisible();
  await writeWord(page, WORD_1, WORD_Y);
  await expect.poll(() => strokeCount(page)).toBe(LETTERS);
  await drawThrough(page, zigzag(WORD_1 - 2, WORD_Y + 3, 72, 8, 2.4));
  await expect.poll(() => strokeCount(page)).toBe(0);
  expect((await stored(page)).images).toHaveLength(1);
  // On the image alone there is nothing to delete, so the scribble is an ordinary stroke.
  await drawThrough(page, zigzag(WORD_1 - 2, WORD_Y + 3, 72, 8, 2.4));
  await expect.poll(() => strokeCount(page)).toBe(1);
  expect((await stored(page)).images).toHaveLength(1);
});

test('a pinned pen preset scratches out too, and stays in use', async ({ page }) => {
  await open(page);
  const pen = page.locator('#tray [data-tool="pen"]');
  await pen.click();
  await page.locator('.popover .popover__pin').click();
  const preset = page.locator('#tray [data-preset]').first();
  await expect(preset).toHaveAttribute('aria-pressed', 'true');
  await writeWord(page, WORD_1, WORD_Y);
  await expect.poll(() => strokeCount(page)).toBe(LETTERS);
  await drawThrough(page, zigzag(WORD_1 - 2, WORD_Y + 3, 72, 8, 2.4));
  await expect.poll(() => strokeCount(page)).toBe(0);
  await expect(preset).toHaveAttribute('aria-pressed', 'true');
});

test.describe('with a finger', () => {
  test.use({ hasTouch: true });

  test('draw with finger scratches out too, with its stronger smoothing', async ({ page }) => {
    await open(page);
    const cdp = await page.context().newCDPSession(page);
    const [ox, oy] = await stageOrigin(page);
    const fingerThrough = async (corners: readonly XY[]): Promise<void> => {
      const send = (type: 'touchStart' | 'touchMove' | 'touchEnd', x = 0, y = 0): Promise<unknown> =>
        cdp.send('Input.dispatchTouchEvent', {
          type,
          touchPoints: type === 'touchEnd' ? [] : [{ x: ox + x, y: oy + y }],
        });
      const [first, ...rest] = corners;
      if (!first) return;
      await send('touchStart', first[0], first[1]);
      let [px, py] = first;
      for (const [x, y] of rest) {
        for (let step = 1; step <= 8; step++) {
          await send('touchMove', px + ((x - px) * step) / 8, py + ((y - py) * step) / 8);
        }
        [px, py] = [x, y];
      }
      await send('touchEnd');
    };
    for (let i = 0; i < LETTERS; i++) {
      const left = WORD_1 + i * 26;
      await fingerThrough([
        [left, WORD_Y + 24],
        [left + 9, WORD_Y],
        [left + 18, WORD_Y + 24],
      ]);
    }
    await expect.poll(() => strokeCount(page)).toBe(LETTERS);
    await fingerThrough(zigzag(WORD_1 - 2, WORD_Y + 3, 72, 10, 2.2));
    await expect.poll(() => strokeCount(page)).toBe(0);
  });
});
