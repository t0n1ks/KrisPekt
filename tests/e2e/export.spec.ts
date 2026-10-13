import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { unzipSync } from 'fflate';
import { FIXTURE_TEXTS, openNotebook, seedFixtureNotebook, TINY_CELL_MM } from './fixture-page';
import { cropSharpness, pdfInfo, servePdfJs } from './pdf-view';

const SAMPLE = 'Лекции';
const PT_PER_MM = 72 / 25.4;

interface ExportChoice {
  /** Format label as shown in the export sheet. */
  format: string;
  /** Extra labels to click (dpi, PNG size, pages). */
  then?: string[];
}

/** Fills in the open export sheet, presses Export and returns the downloaded file. */
async function runExport(page: Page, choice: ExportChoice): Promise<{ name: string; data: Buffer }> {
  const sheet = page.locator('.sheet');
  await expect(sheet).toBeVisible();
  await sheet.locator('.choice-list__item', { hasText: choice.format }).first().click();
  for (const label of choice.then ?? []) {
    // Segmented buttons are named by their label; choice-list radios start with it.
    const radio = sheet.getByRole('radio', { name: new RegExp('^' + label) });
    await sheet.getByRole('button', { name: label, exact: true }).or(radio).first().click();
  }
  const download = page.waitForEvent('download');
  await sheet.getByRole('button', { name: 'Экспортировать' }).click();
  const file = await download;
  const path = await file.path();
  return { name: file.suggestedFilename(), data: readFileSync(path) };
}

/** Opens the export sheet from a notebook card on the shelf. */
async function exportFromShelf(
  page: Page,
  title: string,
  choice: ExportChoice,
): Promise<{ name: string; data: Buffer }> {
  const card = page.locator('.notebook-card', {
    has: page.locator('.notebook-card__title', { hasText: title }),
  });
  await card.locator('.notebook-card__more').click();
  await page.getByRole('menuitem', { name: 'Экспорт…' }).or(page.getByText('Экспорт…')).first().click();
  return runExport(page, choice);
}

/** Width and height of a PNG, from its IHDR chunk. */
function pngSize(data: Uint8Array): { w: number; h: number } {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return { w: view.getUint32(16), h: view.getUint32(20) };
}

test('vector PDF: real text in four languages, exact page size, sharp when zoomed', async ({ page }) => {
  await servePdfJs(page);
  await page.goto('./');
  const sample = await exportFromShelf(page, SAMPLE, { format: 'PDF (вектор' });
  expect(sample.name).toBe(`${SAMPLE}.pdf`);
  const sampleInfo = await pdfInfo(page, sample.data);
  expect(sampleInfo.pages).toBe(2);
  expect(sampleInfo.width).toBeCloseTo(210 * PT_PER_MM, 1);
  expect(sampleInfo.height).toBeCloseTo(297 * PT_PER_MM, 1);
  expect(sampleInfo.text).toContain('Лекция 1. Предел функции');

  await seedFixtureNotebook(page, 'Parity');
  const fixture = await exportFromShelf(page, 'Parity', { format: 'PDF (вектор' });
  const info = await pdfInfo(page, fixture.data);
  for (const text of Object.values(FIXTURE_TEXTS)) expect(info.text).toContain(text);

  // One 5 mm grid cell with tiny handwriting, viewed at 400 %.
  const cell = {
    x: TINY_CELL_MM.x * PT_PER_MM,
    y: TINY_CELL_MM.y * PT_PER_MM,
    w: TINY_CELL_MM.size * PT_PER_MM,
    h: TINY_CELL_MM.size * PT_PER_MM,
  };
  const vector = await cropSharpness(page, fixture.data, cell, 4, false);
  const old = await cropSharpness(page, fixture.data, cell, 4, true);
  test
    .info()
    .annotations.push(
      { type: 'sample-vector-bytes', description: String(sample.data.length) },
      { type: 'fixture-vector-bytes', description: String(fixture.data.length) },
      { type: 'sharpness', description: `vector ${vector.toFixed(1)} vs old raster ${old.toFixed(1)}` },
    );
  console.log(
    `sample PDF ${sample.data.length} B, fixture PDF ${fixture.data.length} B; sharpness ${vector.toFixed(1)} vs ${old.toFixed(1)}`,
  );
  expect(vector).toBeGreaterThan(old * 2);
});

test('raster PDF at 300 dpi embeds lossless page images', async ({ page }) => {
  await servePdfJs(page);
  await page.goto('./');
  const raster = await exportFromShelf(page, SAMPLE, { format: 'Растровый PDF', then: ['300 dpi'] });
  const info = await pdfInfo(page, raster.data);
  expect(info.pages).toBe(2);
  expect(info.text.trim()).toBe('');
  expect(raster.data.includes(Buffer.from('/FlateDecode'))).toBe(true);
  expect(raster.data.includes(Buffer.from('/DCTDecode'))).toBe(false);
});

test('PNG: the current page at 4×, and every page as a ZIP', async ({ page }) => {
  await page.goto('./');
  await seedFixtureNotebook(page, 'Parity');
  await openNotebook(page, 'Parity');
  await page.click('#btnEdMore');
  await page.getByText('Экспорт…').click();
  const single = await runExport(page, { format: 'PNG', then: ['Текущая'] });
  expect(single.name).toBe('Parity-p1.png');
  // A4 at 4 × 96 dpi.
  expect(pngSize(single.data)).toEqual({ w: 3175, h: 4490 });

  await page.click('#btnBack');
  const zip = await exportFromShelf(page, SAMPLE, { format: 'PNG', then: ['2×', 'Все'] });
  expect(zip.name).toBe(`${SAMPLE}-png.zip`);
  const files = unzipSync(new Uint8Array(zip.data));
  expect(Object.keys(files).sort()).toEqual([`${SAMPLE}-p1.png`, `${SAMPLE}-p2.png`]);
  for (const png of Object.values(files)) expect(pngSize(png)).toEqual({ w: 1587, h: 2245 });
});
