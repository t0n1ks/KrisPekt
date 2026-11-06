import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { exportDownload } from './downloads';
import { pdfTextItems, servePdfJs, type PdfTextItem } from './pdf-view';

const NOTEBOOK = 'Text boxes';
const cspViolations: string[] = [];

/** A new notebook, with the Text tool on. Any CSP violation fails the test that caused it. */
async function openWithText(page: Page): Promise<void> {
  page.on('console', (m) => {
    if (m.text().includes('Content Security Policy')) cspViolations.push(m.text());
  });
  await page.goto('./');
  await page.locator('.subject').first().locator('.shelf__add').click();
  await page.fill('#nb-title', NOTEBOOK);
  await page.click('.sheet__foot .btn--primary');
  await expect(page.locator('#editor')).toBeVisible();
  await page.keyboard.press('t');
}

async function stageBox(page: Page) {
  const box = await page.locator('#stage').boundingBox();
  if (!box) throw new Error('no stage');
  return box;
}

/** Tap in the stage, as a fraction of its size. */
async function tap(page: Page, fx: number, fy: number): Promise<{ x: number; y: number }> {
  const box = await stageBox(page);
  const at = { x: box.x + box.width * fx, y: box.y + box.height * fy };
  await page.mouse.click(at.x, at.y);
  return at;
}

async function storedTexts(page: Page): Promise<Record<string, unknown>[]> {
  return page.evaluate(
    (title) =>
      new Promise<Record<string, unknown>[]>((resolve, reject) => {
        const open = indexedDB.open('konspektnik');
        open.onerror = () => reject(new Error('no db'));
        open.onsuccess = () => {
          const tx = open.result.transaction(['notebooks', 'pages']);
          const notebooks = tx.objectStore('notebooks').getAll();
          const all = tx.objectStore('pages').getAll();
          tx.oncomplete = () => {
            open.result.close();
            const id = (notebooks.result as { id: string; title: string }[]).find(
              (n) => n.title === title,
            )?.id;
            const pages = all.result as { nbId: string; texts: Record<string, unknown>[] }[];
            resolve(pages.filter((p) => p.nbId === id).flatMap((p) => p.texts));
          };
        };
      }),
    NOTEBOOK,
  );
}

async function waitStored(page: Page, count: number): Promise<Record<string, unknown>[]> {
  await expect.poll(async () => (await storedTexts(page)).length).toBe(count);
  return storedTexts(page);
}

/** The texts and the number of strokes of each page of the test notebook. */
async function storedPageTexts(page: Page): Promise<{ texts: Record<string, unknown>[]; strokes: number }[]> {
  return page.evaluate(
    (title) =>
      new Promise<{ texts: Record<string, unknown>[]; strokes: number }[]>((resolve) => {
        const open = indexedDB.open('konspektnik');
        open.onsuccess = () => {
          const tx = open.result.transaction(['notebooks', 'pages']);
          const notebooks = tx.objectStore('notebooks').getAll();
          const all = tx.objectStore('pages').getAll();
          tx.oncomplete = () => {
            open.result.close();
            const nb = (notebooks.result as { id: string; title: string; pageIds?: string[] }[]).find(
              (n) => n.title === title,
            );
            const rows = (
              all.result as {
                id: string;
                nbId: string;
                texts: Record<string, unknown>[];
                strokes: unknown[];
              }[]
            ).filter((p) => p.nbId === nb?.id);
            const order = nb?.pageIds ?? [];
            rows.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
            resolve(rows.map((p) => ({ texts: p.texts, strokes: p.strokes.length })));
          };
        };
      }),
    NOTEBOOK,
  );
}

/** Reloads the app and opens the test notebook again. */
async function reopen(page: Page): Promise<void> {
  await page.reload();
  await page.locator('.notebook-card__title', { hasText: NOTEBOOK }).click();
  await expect(page.locator('#editor')).toBeVisible();
}

interface InkLine {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** The lines of text in a screenshot: bands of rows with near-black pixels, in image px. */
function inkLines(page: Page, png: Buffer): Promise<InkLine[]> {
  return page.evaluate(async (data) => {
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D;
    ctx.drawImage(bitmap, 0, 0);
    const { data: px, width, height } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    const lines: { top: number; bottom: number; left: number; right: number }[] = [];
    let open: (typeof lines)[number] | null = null;
    for (let y = 0; y < height; y++) {
      let left = Infinity;
      let right = -Infinity;
      for (let x = 0; x < width; x++) {
        if ((px[(y * width + x) * 4] ?? 255) > 110) continue;
        left = Math.min(left, x);
        right = Math.max(right, x);
      }
      if (left === Infinity) {
        open = null;
        continue;
      }
      if (!open) {
        open = { top: y, bottom: y, left, right };
        lines.push(open);
      }
      open.bottom = y;
      open.left = Math.min(open.left, left);
      open.right = Math.max(open.right, right);
    }
    return lines;
  }, png.toString('base64'));
}

const editor = (page: Page) => page.locator('#textEd');
const frame = (page: Page) => page.locator('#textFrame');
const bar = (page: Page) => page.locator('#textBar');

async function editorSize(page: Page): Promise<{ width: number; height: number }> {
  const box = await editor(page).boundingBox();
  if (!box) throw new Error('no editor');
  return box;
}

/** Selects characters in the editor, the way a person drags over them. */
async function selectWord(page: Page, word: string): Promise<void> {
  await page.evaluate((target) => {
    const root = document.getElementById('textEd') as HTMLElement;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      const at = node.data.indexOf(target);
      if (at < 0) continue;
      document.getSelection()?.setBaseAndExtent(node, at, node, at + target.length);
      return;
    }
    throw new Error('word not found');
  }, word);
}

test.describe('text boxes', () => {
  test.afterEach(() => {
    expect(cspViolations.splice(0)).toEqual([]);
  });

  test('tapping outside saves the box, and only the next tap starts another', async ({ page }) => {
    await openWithText(page);
    await tap(page, 0.3, 0.3);
    await page.keyboard.type('раз');
    await tap(page, 0.6, 0.6);
    await expect(editor(page)).toBeHidden();
    await waitStored(page, 1);
    await tap(page, 0.6, 0.6);
    await expect(editor(page)).toBeFocused();
    await page.keyboard.type('два');
    await page.keyboard.press('Escape');
    await waitStored(page, 2);
  });

  test('a selected box goes with the Delete key and comes back with undo', async ({ page }) => {
    await openWithText(page);
    const at = await tap(page, 0.3, 0.3);
    await page.keyboard.type('удали');
    await page.keyboard.press('Escape');
    await waitStored(page, 1);
    await page.mouse.click(at.x + 4, at.y);
    await expect(frame(page)).toBeVisible();
    await page.keyboard.press('Delete');
    await waitStored(page, 0);
    await page.keyboard.press('Control+Z');
    await waitStored(page, 1);
  });

  test('a style chosen at the caret applies to what is typed next, and is the next default', async ({
    page,
  }) => {
    await openWithText(page);
    const at = await tap(page, 0.3, 0.3);
    await page.keyboard.type('раз ');
    await page.keyboard.press('Control+B');
    await page.keyboard.type('два');
    await page.keyboard.press('Escape');
    const [item] = await waitStored(page, 1);
    expect((item?.paras as { runs: unknown[] }[])[0]?.runs).toEqual([{ t: 'раз ' }, { t: 'два', b: true }]);

    await page.mouse.click(at.x, at.y + 200);
    await page.keyboard.type('новый');
    await page.keyboard.press('Escape');
    const all = await waitStored(page, 2);
    expect((all[1]?.paras as { runs: unknown[] }[])[0]?.runs).toEqual([{ t: 'новый', b: true }]);
  });

  test('handles work with a stylus', async ({ page, context }) => {
    await openWithText(page);
    const at = await tap(page, 0.3, 0.3);
    await page.keyboard.type('пером можно тянуть за край');
    await page.keyboard.press('Escape');
    await waitStored(page, 1);
    await page.mouse.click(at.x + 4, at.y);
    const before = await editorSize(page);
    const box = await frame(page).locator('.text-frame__handle--right').boundingBox();
    if (!box) throw new Error('no handle');
    const cdp = await context.newCDPSession(page);
    const y = box.y + box.height / 2;
    const start = box.x + box.width / 2;
    const send = (type: 'mousePressed' | 'mouseMoved' | 'mouseReleased', x: number, buttons: number) =>
      cdp.send('Input.dispatchMouseEvent', {
        type,
        x,
        y,
        button: 'left',
        buttons,
        clickCount: 1,
        pointerType: 'pen',
        force: 0.5,
      });
    await send('mousePressed', start, 1);
    for (const dx of [-30, -60, -90]) await send('mouseMoved', start + dx, 1);
    await send('mouseReleased', start - 90, 0);
    const after = await editorSize(page);
    expect(after.width).toBeLessThan(before.width - 60);
  });

  test('a new box starts small and grows while typing, then wraps at the page margin', async ({ page }) => {
    await openWithText(page);
    await tap(page, 0.5, 0.3);
    await expect(editor(page)).toBeFocused();
    const empty = await editorSize(page);
    expect(empty.width).toBeLessThan(120);

    await page.keyboard.type('Привет');
    const word = await editorSize(page);
    expect(word.width).toBeGreaterThan(empty.width);
    expect(word.height).toBeCloseTo(empty.height, 0);

    await page.keyboard.type(' мир как у тебя дела сегодня и вообще всё ли хорошо на этой странице');
    const long = await editorSize(page);
    expect(long.height).toBeGreaterThan(word.height * 1.5);
    await page.keyboard.press('Escape');
    await expect(editor(page)).toBeHidden();
    const [item] = await waitStored(page, 1);
    expect(item?.auto).toBe(true);
  });

  test('leaving an empty box removes it, and spaces count as empty', async ({ page }) => {
    await openWithText(page);
    await tap(page, 0.5, 0.3);
    await page.keyboard.press('Escape');
    await tap(page, 0.5, 0.5);
    await page.keyboard.type('   ');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    expect(await storedTexts(page)).toEqual([]);
    await expect(frame(page)).toBeHidden();
  });

  test('deleting all the text of an old box removes that box', async ({ page }) => {
    await openWithText(page);
    const at = await tap(page, 0.5, 0.3);
    await page.keyboard.type('Текст');
    await page.keyboard.press('Escape');
    await waitStored(page, 1);
    await page.mouse.click(at.x + 4, at.y);
    await page.mouse.click(at.x + 4, at.y);
    await expect(editor(page)).toBeFocused();
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Delete');
    await page.keyboard.press('Escape');
    await waitStored(page, 0);
  });

  test('handles change the width with a mouse: text wraps, height fits, and stays fixed after', async ({
    page,
  }) => {
    await openWithText(page);
    const at = await tap(page, 0.3, 0.3);
    await page.keyboard.type('один два три четыре пять шесть');
    await page.keyboard.press('Escape');
    await waitStored(page, 1);
    await page.mouse.click(at.x + 4, at.y);
    await expect(frame(page)).toBeVisible();
    const before = await editorSize(page);

    const handle = frame(page).locator('.text-frame__handle--right');
    const box = await handle.boundingBox();
    if (!box) throw new Error('no handle');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - before.width * 0.6, box.y + box.height / 2, { steps: 6 });
    await page.mouse.up();

    const narrow = await editorSize(page);
    expect(narrow.width).toBeLessThan(before.width * 0.6);
    expect(narrow.height).toBeGreaterThan(before.height * 1.5);
    await expect.poll(async () => (await storedTexts(page))[0]?.auto).toBeUndefined();

    // Typing more wraps, the width does not follow it.
    const shown = await editor(page).boundingBox();
    if (!shown) throw new Error('no editor');
    await page.mouse.click(shown.x + narrow.width / 2, shown.y + 6);
    await expect(editor(page)).toBeFocused();
    await page.keyboard.press('Control+End');
    await page.keyboard.type(' семь восемь девять десять');
    const typed = await editorSize(page);
    expect(typed.width).toBeCloseTo(narrow.width, 0);
    expect(typed.height).toBeGreaterThan(narrow.height);
  });

  for (const zoomSteps of [0, 3]) {
    test(`handles have a 44 px touch area at zoom step ${zoomSteps}`, async ({ page }) => {
      await openWithText(page);
      const at = await tap(page, 0.4, 0.3);
      await page.keyboard.type('Масштаб');
      await page.keyboard.press('Escape');
      await waitStored(page, 1);
      await page.mouse.click(at.x + 4, at.y);
      await expect(frame(page)).toBeVisible();
      const scale = (): Promise<string> => editor(page).evaluate((node) => node.style.transform);
      const before = await scale();
      for (let i = 0; i < zoomSteps; i++) {
        await page.evaluate(
          (point) =>
            document.querySelector('#stage canvas')?.dispatchEvent(
              new WheelEvent('wheel', {
                clientX: point.x,
                clientY: point.y,
                deltaY: -200,
                ctrlKey: true,
                bubbles: true,
                cancelable: true,
              }),
            ),
          at,
        );
      }
      if (zoomSteps) await expect.poll(scale).not.toBe(before);
      const sizes = await frame(page)
        .locator('.text-frame__handle, .text-frame__move')
        .evaluateAll((nodes) => nodes.map((n) => n.getBoundingClientRect()).map((r) => [r.width, r.height]));
      expect(sizes.length).toBe(7);
      for (const [w, h] of sizes) {
        // Rounding of the transform can take a hair off.
        expect(w).toBeGreaterThan(43.9);
        expect(h).toBeGreaterThan(43.9);
      }
    });
  }

  test('handles work with a finger', async ({ browser }) => {
    const context = await browser.newContext({ hasTouch: true, viewport: { width: 1000, height: 800 } });
    const page = await context.newPage();
    await openWithText(page);
    const at = await tap(page, 0.3, 0.3);
    await page.keyboard.type('пальцем можно тянуть за край');
    await page.keyboard.press('Escape');
    await waitStored(page, 1);
    await page.mouse.click(at.x + 4, at.y);
    const before = await editorSize(page);
    const box = await frame(page).locator('.text-frame__handle--right').boundingBox();
    if (!box) throw new Error('no handle');
    const cdp = await context.newCDPSession(page);
    const point = (x: number) => [{ x, y: box.y + box.height / 2, radiusX: 8, radiusY: 8, id: 1 }];
    const start = box.x + box.width / 2;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point(start) });
    for (const dx of [-30, -60, -90]) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: point(start + dx) });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const after = await editorSize(page);
    expect(after.width).toBeLessThan(before.width - 60);
    await context.close();
  });

  test('moves by its grip; one undo puts it back; it stays on the page', async ({ page }) => {
    await openWithText(page);
    const at = await tap(page, 0.4, 0.4);
    await page.keyboard.type('Двигай');
    await page.keyboard.press('Escape');
    const [original] = await waitStored(page, 1);
    await page.mouse.click(at.x + 4, at.y);
    const grip = await frame(page).locator('.text-frame__move').boundingBox();
    if (!grip) throw new Error('no grip');
    await page.mouse.move(grip.x + 22, grip.y + 22);
    await page.mouse.down();
    await page.mouse.move(grip.x - 3000, grip.y - 3000, { steps: 4 });
    await page.mouse.up();
    await expect.poll(async () => (await storedTexts(page))[0]?.x).toBe(0);
    expect((await storedTexts(page))[0]?.y).toBe(0);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+Z');
    await expect.poll(async () => (await storedTexts(page))[0]?.x).toBe(original?.x);
    expect((await storedTexts(page))[0]?.y).toBe(original?.y);
  });

  test('formats one word: bold, italic and colour, and it survives a reload', async ({ page }) => {
    await openWithText(page);
    await tap(page, 0.3, 0.3);
    await page.keyboard.type('простое важное простое');
    await selectWord(page, 'важное');
    await page.keyboard.press('Control+B');
    await page.keyboard.press('Control+I');
    await bar(page).getByRole('button', { name: 'Цвет текста' }).click();
    await page.locator('.palette__grid button').nth(2).click();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
    const [item] = await waitStored(page, 1);
    const runs = (item?.paras as { runs: Record<string, unknown>[] }[])[0]?.runs;
    expect(runs?.map((run) => run.t)).toEqual(['простое ', 'важное', ' простое']);
    expect(runs?.[1]).toMatchObject({ b: true, i: true });
    expect(runs?.[1]?.c).toMatch(/^#[0-9a-f]{6}$/i);
    expect(runs?.[0]?.b).toBeUndefined();

    await reopen(page);
    expect(await storedTexts(page)).toEqual([item]);
  });

  test('Ctrl+Z inside a box undoes the box only, in sensible steps', async ({ page }) => {
    await openWithText(page);
    await tap(page, 0.3, 0.3);
    await page.keyboard.type('один ');
    await page.waitForTimeout(1100);
    await page.keyboard.type('два');
    await page.keyboard.press('Control+Z');
    await expect(editor(page)).toHaveText('один ');
    await page.keyboard.press('Control+Y');
    await expect(editor(page)).toHaveText('один два');
    await page.keyboard.press('Escape');
    await waitStored(page, 1);
    await page.keyboard.press('Control+Z');
    await waitStored(page, 0);
  });

  test('Enter makes paragraphs, a list numbers them, and an empty item ends it', async ({ page }) => {
    await openWithText(page);
    await tap(page, 0.3, 0.3);
    await page.keyboard.type('первый');
    await bar(page).getByRole('button', { name: 'Нумерованный список' }).click();
    await page.keyboard.press('Enter');
    await page.keyboard.type('второй');
    const markers = editor(page).locator('.text-para--list');
    await expect(markers).toHaveCount(2);
    await expect(markers.nth(1)).toHaveAttribute('data-marker', '2.');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await expect(markers).toHaveCount(2);
    await page.keyboard.press('Escape');
    const [item] = await waitStored(page, 1);
    expect((item?.paras as { list?: string }[]).map((p) => p.list)).toEqual(['number', 'number']);
    expect(item?.t).toBe('первый\nвторой');
  });

  test('a pasted web page comes in as plain text', async ({ page }) => {
    await openWithText(page);
    await tap(page, 0.3, 0.3);
    await page.keyboard.type('a');
    await page.evaluate(() => {
      const data = new DataTransfer();
      data.setData('text/html', '<img src=x onerror="document.title=1"><b style="color:red">жирный</b>');
      data.setData('text/plain', 'жирный\nвторая');
      document
        .getElementById('textEd')
        ?.dispatchEvent(
          new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
        );
    });
    await expect(editor(page).locator('img, b')).toHaveCount(0);
    await page.keyboard.press('Escape');
    const [item] = await waitStored(page, 1);
    expect(item?.t).toBe('aжирный\nвторая');
  });

  test('the bar stays inside what the keyboard leaves free, and collapses when narrow', async ({ page }) => {
    await page.setViewportSize({ width: 600, height: 800 });
    await openWithText(page);
    await tap(page, 0.5, 0.25);
    await page.keyboard.type('Узко');
    const barBox = await bar(page).boundingBox();
    if (!barBox) throw new Error('no bar');
    expect(barBox.x).toBeGreaterThanOrEqual(0);
    expect(barBox.x + barBox.width).toBeLessThanOrEqual(600);
    const more = bar(page).getByRole('button', { name: 'Другое оформление' });
    await expect(more).toBeVisible();
    await more.click();
    await expect(page.locator('.menu').getByText('Подчёркнутый')).toBeVisible();
    await page.locator('.menu').getByText('Подчёркнутый').click();
    await expect(editor(page)).toBeFocused();
    await page.keyboard.press('Escape');

    // As with a keyboard: a shorter screen. The box stays where it is; the bar follows the space.
    await tap(page, 0.5, 0.9);
    await page.keyboard.type('Низ страницы');
    await page.setViewportSize({ width: 600, height: 300 });
    await page.waitForTimeout(150);
    const low = await bar(page).boundingBox();
    if (!low) throw new Error('no bar');
    expect(low.y + low.height).toBeLessThanOrEqual(300);
  });

  for (const [i, sample] of [
    'Нормальный текст с обычными словами, который идёт в несколько строк подряд и не кончается никак',
    'слова-через-дефис и/или слэш — с тире – коротким, что?нибудь такое 2024-05-01 1/2 и ещё немного текста',
    'ДлинноеСловоБезПробеловКотороеНеПомещаетсяВОднуСтрокуИДолжноПереноситьсяПоБуквамВотТакВотТак конец',
    'Mixed English и русский text, with 123 numbers; and (brackets) "quotes", on and on and on',
  ].entries()) {
    test(`the editor shows the text just where the canvas draws it, line by line: ${i}`, async ({ page }) => {
      await openWithText(page);
      const at = await tap(page, 0.42, 0.3);
      await page.keyboard.insertText(sample);
      await page.keyboard.press('Control+A');
      if (i % 2) await page.keyboard.press('Control+B');
      await page.keyboard.press('Escape');
      await waitStored(page, 1);
      await page.mouse.click(at.x + 30, at.y);
      await frame(page).evaluate((node) => node.setAttribute('hidden', ''));
      await bar(page).evaluate((node) => node.setAttribute('hidden', ''));
      // Bold Latin and Cyrillic are separate files: a slow machine could still be fetching one.
      await page.evaluate(() => document.fonts.ready);
      const shown = await editor(page).boundingBox();
      if (!shown) throw new Error('no editor');
      const clip = { x: shown.x - 4, y: shown.y - 2, width: shown.width + 8, height: shown.height + 4 };
      const inEditor = await inkLines(page, await page.screenshot({ clip }));
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
      const onCanvas = await inkLines(page, await page.screenshot({ clip }));
      expect(inEditor.length, sample).toBeGreaterThan(1);
      expect(onCanvas.length, sample).toBe(inEditor.length);
      inEditor.forEach((line, n) => {
        const drawn = onCanvas[n];
        expect(Math.abs(line.top - (drawn?.top ?? -99)), sample).toBeLessThanOrEqual(1);
        expect(Math.abs(line.bottom - (drawn?.bottom ?? -99)), sample).toBeLessThanOrEqual(1);
        expect(Math.abs(line.left - (drawn?.left ?? -99)), sample).toBeLessThanOrEqual(2);
        expect(Math.abs(line.right - (drawn?.right ?? -99)), sample).toBeLessThanOrEqual(3);
      });
    });
  }

  test('a box keeps its own undo out of the page history while typing', async ({ page }) => {
    await openWithText(page);
    await tap(page, 0.3, 0.3);
    await page.keyboard.type('один');
    await expect(page.locator('#btnUndo')).toBeDisabled();
    await page.keyboard.press('Escape');
    await waitStored(page, 1);
    await expect(page.locator('#btnUndo')).toBeEnabled();
  });

  test('old items, from before this version, still show and can be edited', async ({ page }) => {
    await openWithText(page);
    const at = await tap(page, 0.3, 0.3);
    await page.keyboard.type('x');
    await page.keyboard.press('Escape');
    const [made] = await waitStored(page, 1);
    await page.evaluate(
      (id) =>
        new Promise<void>((resolve) => {
          const open = indexedDB.open('konspektnik');
          open.onsuccess = () => {
            const store = open.result.transaction('pages', 'readwrite').objectStore('pages');
            const all = store.getAll();
            all.onsuccess = () => {
              const pageRecord = (all.result as { texts: Record<string, unknown>[] }[]).find((p) =>
                p.texts.some((t) => t.id === id),
              ) as { texts: Record<string, unknown>[] };
              const text = pageRecord.texts.find((t) => t.id === id) as Record<string, unknown>;
              pageRecord.texts = [
                { id, x: text.x, y: text.y, w: 420, t: 'старый текст', fs: 18, c: '#000000' },
              ];
              store.put(pageRecord).onsuccess = () => {
                open.result.close();
                resolve();
              };
            };
          };
        }),
      made?.id as string,
    );
    await reopen(page);
    await page.waitForTimeout(200);
    const untouched = await storedTexts(page);
    expect(untouched[0]).not.toHaveProperty('paras');
    await page.keyboard.press('t');
    await page.mouse.click(at.x + 4, at.y);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    expect((await storedTexts(page))[0]).not.toHaveProperty('paras');
    await page.mouse.click(at.x + 4, at.y);
    await page.mouse.click(at.x + 4, at.y);
    await page.keyboard.press('Control+End');
    await page.keyboard.type('!');
    await page.keyboard.press('Escape');
    await expect.poll(async () => (await storedTexts(page))[0]?.t).toBe('старый текст!');
    const edited = (await storedTexts(page))[0];
    expect(edited?.paras).toBeTruthy();
    expect(edited?.w).toBe(420);
  });

  test('the whole story: type, resize, format, lasso with a stroke, another page, undo, reload', async ({
    page,
  }) => {
    await openWithText(page);
    await page.click('#fab');
    await expect.poll(async () => (await storedPageTexts(page)).length).toBe(2);
    const stage = await stageBox(page);
    // Show the bottom of page 1 and the top of page 2.
    await page.mouse.move(640, stage.y + 300);
    await page.mouse.wheel(0, -300);
    await page.waitForTimeout(200);

    const at = { x: 300, y: stage.y + 200 };
    await page.keyboard.press('t');
    await page.mouse.click(at.x, at.y);
    const empty = await editorSize(page);
    await page.keyboard.type('важное слово и много других слов');
    expect((await editorSize(page)).width).toBeGreaterThan(empty.width);
    await page.keyboard.press('Escape');
    await waitStored(page, 1);

    await page.mouse.click(at.x + 4, at.y);
    const single = await editorSize(page);
    const handle = await frame(page).locator('.text-frame__handle--right').boundingBox();
    if (!handle) throw new Error('no handle');
    await page.mouse.move(handle.x + 22, handle.y + 22);
    await page.mouse.down();
    await page.mouse.move(handle.x + 22 - single.width * 0.5, handle.y + 22, { steps: 5 });
    await page.mouse.up();
    const wrapped = await editorSize(page);
    expect(wrapped.height).toBeGreaterThan(single.height * 1.5);

    const inside = await editor(page).boundingBox();
    if (!inside) throw new Error('no editor');
    await page.mouse.click(inside.x + inside.width / 2, inside.y + 6);
    await expect(editor(page)).toBeFocused();
    await selectWord(page, 'важное');
    await page.keyboard.press('Control+B');
    await page.keyboard.press('Control+I');
    await bar(page).getByRole('button', { name: 'Цвет текста' }).click();
    await page.locator('.palette__grid button').nth(2).click();
    await page.keyboard.press('Escape');
    await expect(editor(page)).toBeHidden();
    await expect.poll(async () => JSON.stringify((await storedTexts(page))[0]?.paras)).toContain('"b":true');
    const [formatted] = await storedTexts(page);

    await page.keyboard.press('p');
    await page.mouse.move(at.x, at.y + 90);
    await page.mouse.down();
    await page.mouse.move(at.x + 100, at.y + 100, { steps: 5 });
    await page.mouse.up();

    await page.keyboard.press('l');
    const loop = [
      [at.x - 40, at.y - 50],
      [at.x + 380, at.y - 50],
      [at.x + 380, at.y + 125],
      [at.x - 40, at.y + 125],
      [at.x - 40, at.y - 50],
    ] as const;
    await page.mouse.move(loop[0][0], loop[0][1]);
    await page.mouse.down();
    for (const [x, y] of loop) await page.mouse.move(x, y, { steps: 3 });
    await page.mouse.up();
    await expect(page.locator('#selbar')).toBeVisible();

    // Carried over the gap to page 2.
    await page.mouse.move(at.x + 40, at.y + 95);
    await page.mouse.down();
    await page.mouse.move(at.x + 40, at.y + 395, { steps: 12 });
    await page.mouse.up();
    await expect.poll(async () => (await storedPageTexts(page)).map((p) => p.texts.length)).toEqual([0, 1]);
    const moved = (await storedPageTexts(page))[1];
    expect(moved?.strokes).toBe(1);
    expect(moved?.texts[0]?.paras).toEqual(formatted?.paras);

    // One undo step brings back the text and the stroke together.
    await page.keyboard.press('Control+Z');
    await expect.poll(async () => (await storedPageTexts(page)).map((p) => p.texts.length)).toEqual([1, 0]);
    expect((await storedPageTexts(page))[0]?.strokes).toBe(1);
    await page.keyboard.press('Control+Y');
    await expect.poll(async () => (await storedPageTexts(page)).map((p) => p.texts.length)).toEqual([0, 1]);

    await reopen(page);
    const after = await storedPageTexts(page);
    expect(after[1]?.texts[0]).toEqual(moved?.texts[0]);
    expect(after[1]?.strokes).toBe(1);
  });

  test('lasso copies and pastes text, deletes it, and undoes in one step each', async ({ page }) => {
    await openWithText(page);
    const at = await tap(page, 0.4, 0.3);
    await page.keyboard.type('копия');
    await page.keyboard.press('Escape');
    await waitStored(page, 1);
    await page.keyboard.press('l');
    const r = { x: at.x - 30, y: at.y - 40, w: 220, h: 80 };
    await page.mouse.move(r.x, r.y);
    await page.mouse.down();
    await page.mouse.move(r.x + r.w, r.y, { steps: 3 });
    await page.mouse.move(r.x + r.w, r.y + r.h, { steps: 3 });
    await page.mouse.move(r.x, r.y + r.h, { steps: 3 });
    await page.mouse.move(r.x, r.y, { steps: 3 });
    await page.mouse.up();
    await expect(page.locator('#selbar')).toBeVisible();
    await page.keyboard.press('Control+C');
    await page.keyboard.press('Delete');
    await waitStored(page, 0);
    await expect(page.locator('#selbar').getByRole('button', { name: 'Вставить' })).toBeVisible();
    await page.locator('#selbar').getByRole('button', { name: 'Вставить' }).click();
    const [pasted] = await waitStored(page, 1);
    expect(pasted?.t).toBe('копия');
    await page.keyboard.press('Control+V');
    const two = await waitStored(page, 2);
    expect(new Set(two.map((t) => t.id)).size).toBe(2);
    await page.keyboard.press('Control+Z');
    await waitStored(page, 1);
    await page.keyboard.press('Control+Z');
    await waitStored(page, 0);
    await page.keyboard.press('Control+Z');
    await waitStored(page, 1);
  });

  test('vector PDF has selectable, styled text; PNG shows it', async ({ page }) => {
    await servePdfJs(page);
    await openWithText(page);
    await tap(page, 0.3, 0.3);
    await page.keyboard.type('обычный жирный косой большой');
    for (const [word, key] of [
      ['жирный', 'Control+B'],
      ['косой', 'Control+I'],
    ] as const) {
      await selectWord(page, word);
      await page.keyboard.press(key);
    }
    await selectWord(page, 'большой');
    await bar(page).getByRole('button', { name: 'Размер шрифта' }).click();
    await page.locator('.menu').getByText('48', { exact: true }).click();
    await page.keyboard.press('Escape');
    await waitStored(page, 1);

    await page.click('#btnEdMore');
    await page.getByText('Экспорт…').click();
    const sheet = page.locator('.sheet');
    await sheet.locator('.choice-list__item', { hasText: 'PDF' }).first().click();
    const download = exportDownload(page);
    await sheet.getByRole('button', { name: 'Экспортировать' }).click();
    const data = await readFile(await (await download).path());
    const items = await pdfTextItems(page, data);
    const find = (word: string): PdfTextItem => {
      const hit = items.find((item) => item.str.includes(word));
      if (!hit) throw new Error('no such text in the PDF: ' + word + ' in ' + JSON.stringify(items));
      return hit;
    };
    const [plain, bold, slanted, big] = ['обычный', 'жирный', 'косой', 'большой'].map(find) as [
      PdfTextItem,
      PdfTextItem,
      PdfTextItem,
      PdfTextItem,
    ];
    expect(bold.fontName).not.toBe(plain.fontName);
    expect(slanted.fontName).toBe(plain.fontName);
    // A slanted run carries the slant in its text matrix, a plain one does not.
    expect(plain.transform[2]).toBe(0);
    expect(Math.abs(slanted.transform[2] ?? 0)).toBeGreaterThan(0);
    expect(big.transform[3] ?? 0).toBeGreaterThan((plain.transform[3] ?? 0) * 2);
    // One baseline for all the words of a line.
    expect(plain.transform[5]).toBeCloseTo(big.transform[5] ?? 0, 0);

    await expect(sheet).toBeHidden();
    await page.click('#btnEdMore');
    await page.getByText('Экспорт…').click();
    await sheet.locator('.choice-list__item', { hasText: 'PNG' }).first().click();
    const radio = sheet.getByRole('radio', { name: /^Текущая/ });
    await sheet.getByRole('button', { name: 'Текущая', exact: true }).or(radio).first().click();
    const pngDownload = exportDownload(page);
    await sheet.getByRole('button', { name: 'Экспортировать' }).click();
    const png = await readFile(await (await pngDownload).path());
    const ink = await inkLines(page, png);
    expect(ink.length).toBeGreaterThan(0);
  });
});
