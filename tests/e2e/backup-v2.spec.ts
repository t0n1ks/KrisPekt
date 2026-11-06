import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strToU8, zipSync, type Zippable } from 'fflate';
import { expect, test, type Page } from '@playwright/test';

const MB = 1024 * 1024;

interface StoredStroke {
  id: string;
  p: number[];
}
interface StoredPage {
  id: string;
  strokes: StoredStroke[];
  [field: string]: unknown;
}
interface Dump {
  subjects: Record<string, unknown>[];
  notebooks: Record<string, unknown>[];
  pages: StoredPage[];
  blobs: { id: string; type: string; size: number; sha: string }[];
}

const cspViolations: string[] = [];

test.beforeEach(({ page }) => {
  cspViolations.length = 0;
  page.on('console', (message) => {
    if (/Content Security Policy/i.test(message.text())) cspViolations.push(message.text());
  });
});

test.afterEach(() => {
  expect(cspViolations).toEqual([]);
});

/** A realistic shelf straight in storage: much handwriting, photos, a PDF page and an attached PDF. */
async function seedSample(page: Page, pages = 30, strokesPerPage = 220, view: unknown = null): Promise<void> {
  await page.evaluate(
    async ({ pages: pageCount, strokesPerPage: perPage, view: savedView }) => {
      let seed = 2026;
      const random = (): number => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 2 ** 32;
      };
      const jitter = (): number => (random() + random() + random() + random() - 2) / 1.4;
      const strokePoints = (cx: number, cy: number): Float32Array => {
        const count = 12 + Math.floor(random() * 70);
        const [ax, ay, fx, fy, phase] = [
          4 + random() * 10,
          3 + random() * 9,
          2 + random() * 6,
          2 + random() * 6,
          random() * 6,
        ];
        const points: number[] = [];
        let pressure = 0.3;
        let [lastX, lastY] = [-1e9, -1e9];
        for (let i = 0; i < count; i++) {
          const t = i / count;
          const px = cx + ax * Math.sin(fx * t + phase) + 14 * t + jitter() * 0.06;
          const py = cy + ay * Math.cos(fy * t) + jitter() * 0.06;
          pressure = Math.min(1, Math.max(0.05, pressure + (0.5 - pressure) * 0.05 + jitter() * 0.012));
          // The pen drops points closer than this, at 1:1.
          if ((px - lastX) ** 2 + (py - lastY) ** 2 < 0.35 ** 2) continue;
          lastX = px;
          lastY = py;
          points.push(px, py, pressure);
        }
        return Float32Array.from(points);
      };
      const photo = async (type: string, width: number, height: number): Promise<Blob> => {
        const canvas = new OffscreenCanvas(width, height);
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('no canvas');
        for (let i = 0; i < 400; i++) {
          ctx.fillStyle = `hsl(${random() * 360} 70% ${20 + random() * 60}%)`;
          ctx.fillRect(random() * width, random() * height, 40 + random() * 300, 40 + random() * 300);
        }
        const image = ctx.getImageData(0, 0, width, height);
        for (let i = 0; i < image.data.length; i += 4) {
          const noise = (random() - 0.5) * 40;
          image.data[i] = (image.data[i] ?? 0) + noise;
          image.data[i + 1] = (image.data[i + 1] ?? 0) + noise;
          image.data[i + 2] = (image.data[i + 2] ?? 0) + noise;
        }
        ctx.putImageData(image, 0, 0);
        return canvas.convertToBlob({ type, quality: 0.88 });
      };
      const [photoA, photoB, pdfPage] = [
        await photo('image/jpeg', 1600, 1200),
        await photo('image/jpeg', 1200, 1600),
        await photo('image/jpeg', 1000, 1400),
      ];
      const pdf = new Blob(['%PDF-1.4\n' + 'lecture notes handout text\n'.repeat(4000)], {
        type: 'application/pdf',
      });
      const records: Record<string, unknown>[] = [];
      for (let i = 0; i < pageCount; i++) {
        const strokes = [];
        let [x, y] = [70, 70];
        for (let s = 0; s < perPage; s++) {
          x += 4 + random() * 8;
          if (x > 720) {
            x = 70;
            y += 28;
          }
          strokes.push({
            id: `s${i}x${s}`,
            k: 'pen',
            c: '#1E40AF',
            s: 2,
            b: 'ballpoint',
            p: strokePoints(x, y),
          });
        }
        records.push({
          id: `pg${i}`,
          nbId: 'nbmain',
          w: 210,
          h: 297,
          locked: true,
          bg: 'grid',
          bgBlob: i === 2 ? 'pdfpage' : null,
          strokes,
          texts: [{ id: `t${i}`, x: 75, y: 30, w: 600, t: 'Лекция ' + i, fs: 20, c: '#1E40AF' }],
          images:
            i === 1
              ? [
                  { id: 'im1', x: 60, y: 200, w: 300, h: 225, blob: 'photoa' },
                  { id: 'im2', x: 400, y: 200, w: 225, h: 300, blob: 'photob' },
                ]
              : [],
          cards:
            i === 3
              ? [
                  {
                    id: 'cd1',
                    kind: 'pdf',
                    x: 60,
                    y: 500,
                    w: 400,
                    h: 104,
                    blob: 'pdffile',
                    thumb: null,
                    name: 'lecture.pdf',
                    pages: 2,
                    bytes: pdf.size,
                  },
                ]
              : [],
          anchors:
            i === 0 ? [{ id: 'an1', name: 'Интеграл', items: [], rect: { x: 0, y: 0, w: 0, h: 0 } }] : [],
          inkLinks: [],
          updatedAt: 1700000000000,
        });
      }
      await new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('konspektnik');
        open.onerror = () => reject(new Error('no database'));
        open.onsuccess = () => {
          const tx = open.result.transaction(['subjects', 'notebooks', 'pages', 'blobs'], 'readwrite');
          for (const store of ['subjects', 'notebooks', 'pages', 'blobs']) tx.objectStore(store).clear();
          tx.objectStore('subjects').put({
            id: 'subj',
            name: 'Математика',
            color: '#2F5DA8',
            order: 0,
            createdAt: 1700000000000,
          });
          tx.objectStore('notebooks').put({
            id: 'nbmain',
            subjectId: 'subj',
            title: 'Лекции',
            color: '#2F5DA8',
            base: { w: 210, h: 297 },
            bg: 'grid',
            pageIds: records.map((record) => record.id),
            createdAt: 1700000000000,
            updatedAt: 1700000000000,
            view: savedView,
            marks: [{ id: 'an1', pageId: 'pg0', name: 'Интеграл' }],
          });
          for (const record of records) tx.objectStore('pages').put(record);
          tx.objectStore('blobs').put({ id: 'photoa', blob: photoA });
          tx.objectStore('blobs').put({ id: 'photob', blob: photoB });
          tx.objectStore('blobs').put({ id: 'pdfpage', blob: pdfPage });
          tx.objectStore('blobs').put({ id: 'pdffile', blob: pdf });
          tx.oncomplete = () => {
            open.result.close();
            resolve();
          };
          tx.onerror = () => reject(new Error('seed failed'));
        };
      });
    },
    { pages, strokesPerPage, view },
  );
}

/** Everything in storage, with files as sizes and hashes. */
function dump(page: Page): Promise<Dump> {
  return page.evaluate(
    () =>
      new Promise<Dump>((resolve, reject) => {
        const open = indexedDB.open('konspektnik');
        open.onerror = () => reject(new Error('no database'));
        open.onsuccess = () => {
          const tx = open.result.transaction(['subjects', 'notebooks', 'pages', 'blobs']);
          const [subjects, notebooks, pages, blobs] = ['subjects', 'notebooks', 'pages', 'blobs'].map(
            (name) => tx.objectStore(name).getAll(),
          );
          tx.oncomplete = async () => {
            open.result.close();
            const files = [];
            for (const { id, blob } of blobs?.result as { id: string; blob: Blob }[]) {
              const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
              const sha = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
              files.push({ id, type: blob.type, size: blob.size, sha });
            }
            resolve({
              subjects: subjects?.result,
              notebooks: notebooks?.result,
              pages: (pages?.result as { strokes: { p: Float32Array }[] }[]).map((row) => ({
                ...row,
                strokes: row.strokes.map((stroke) => ({ ...stroke, p: Array.from(stroke.p) })),
              })),
              blobs: files.sort((a, b) => a.id.localeCompare(b.id)),
            } as Dump);
          };
        };
      }),
  );
}

/** What the old format would have taken for the same data, measured as it was written. */
function oldJsonSize(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const open = indexedDB.open('konspektnik');
        open.onerror = () => reject(new Error('no database'));
        open.onsuccess = () => {
          const tx = open.result.transaction(['subjects', 'notebooks', 'pages', 'blobs']);
          const [subjects, notebooks, pages, blobs] = ['subjects', 'notebooks', 'pages', 'blobs'].map(
            (name) => tx.objectStore(name).getAll(),
          );
          tx.oncomplete = () => {
            open.result.close();
            const rows = (pages?.result as { strokes: { p: Float32Array }[] }[]).map((row) => ({
              ...row,
              strokes: row.strokes.map((s) => ({
                ...s,
                p: Array.from(s.p, (v) => Math.round(v * 100) / 100),
              })),
            }));
            const files = (blobs?.result as { blob: Blob }[]).reduce(
              (sum, { blob }) => sum + Math.ceil(blob.size / 3) * 4,
              0,
            );
            resolve(
              new Blob([
                JSON.stringify({ subjects: subjects?.result, notebooks: notebooks?.result, pages: rows }),
              ]).size + files,
            );
          };
        };
      }),
  );
}

/** Empties storage, keeping the app's settings, so no sample notebook appears. */
async function wipe(page: Page): Promise<void> {
  // First let the app finish starting: on a first visit it is still writing its sample notebook.
  await page.locator('.library__subtitle:not(:empty)').waitFor();
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('konspektnik');
        open.onerror = () => reject(new Error('no database'));
        open.onsuccess = () => {
          const tx = open.result.transaction(['subjects', 'notebooks', 'pages', 'blobs'], 'readwrite');
          for (const store of ['subjects', 'notebooks', 'pages', 'blobs']) tx.objectStore(store).clear();
          tx.oncomplete = () => {
            open.result.close();
            resolve();
          };
        };
      }),
  );
  await page.reload();
}

async function menu(page: Page, label: string): Promise<void> {
  await page.click('#btnLibMore');
  await page.locator('.menu__item', { hasText: label }).click();
}

/** Saves a backup from the shelf menu; returns where the file went and its suggested name. */
async function saveBackup(page: Page): Promise<{ path: string; name: string }> {
  const download = page.waitForEvent('download');
  await menu(page, 'Сохранить резервную копию');
  const saved = await download;
  return { path: await saved.path(), name: saved.suggestedFilename() };
}

async function pickBackup(
  page: Page,
  file: string | { name: string; mimeType: string; buffer: Buffer },
): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await menu(page, 'Восстановить из копии');
  await (await chooser).setFiles(file);
}

async function restoreBackup(
  page: Page,
  file: string | { name: string; mimeType: string; buffer: Buffer },
): Promise<void> {
  await pickBackup(page, file);
  await expect(page.locator('.sheet__foot .btn--primary')).toBeVisible({ timeout: 300_000 });
  await page.click('.sheet__foot .btn--primary');
  await expect(page.locator('.toast')).toHaveText('Копия восстановлена', { timeout: 300_000 });
  // It would cover part of what a later screenshot compares.
  await expect(page.locator('.toast')).toBeHidden({ timeout: 15_000 });
}

/** Pixels of the two images that differ noticeably, as a share of all, and the worst difference. */
async function compareImages(page: Page, a: Buffer, b: Buffer): Promise<{ share: number; worst: number }> {
  return page.evaluate(
    async ([first, second]) => {
      const decode = async (data: string): Promise<ImageData> => {
        const image = new Image();
        image.src = 'data:image/png;base64,' + data;
        await image.decode();
        const canvas = new OffscreenCanvas(image.width, image.height);
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('no canvas');
        ctx.drawImage(image, 0, 0);
        return ctx.getImageData(0, 0, image.width, image.height);
      };
      const [x, y] = [await decode(first as string), await decode(second as string)];
      let different = 0;
      let worst = 0;
      for (let i = 0; i < x.data.length; i++) {
        const delta = Math.abs((x.data[i] ?? 0) - (y.data[i] ?? 0));
        worst = Math.max(worst, delta);
        if (delta > 32) different++;
      }
      return { share: different / x.data.length, worst };
    },
    [a.toString('base64'), b.toString('base64')] as const,
  );
}

async function settledView(page: Page, title: string): Promise<Buffer> {
  await page.locator('.notebook-card__title', { hasText: title }).click();
  await expect(page.locator('#editor')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1200);
  const shot = await page.locator('#cv').screenshot();
  await page.click('#btnBack');
  await expect(page.locator('#editor')).toBeHidden();
  return shot;
}

test('a ZIP backup is much smaller than the old JSON, and restores to the same content', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('./');
  await seedSample(page);
  await page.reload();
  await expect(page.locator('.notebook-card')).toHaveCount(1);
  const before = await dump(page);
  const oldSize = await oldJsonSize(page);

  const { path, name } = await saveBackup(page);
  expect(name).toMatch(/^krispekt-backup-\d{4}-\d{2}-\d{2}\.zip$/);
  const size = readFileSync(path).length;

  console.log(
    `[size] e2e sample: old JSON ${(oldSize / MB).toFixed(2)} MB, new ZIP ${(size / MB).toFixed(2)} MB`,
  );
  expect(size).toBeLessThan(oldSize * 0.7);
  await expect(page.locator('#libBackup')).toContainText('Последняя копия: сегодня');

  await wipe(page);
  await expect(page.locator('.notebook-card')).toHaveCount(0);
  await restoreBackup(page, path);
  await expect(page.locator('.notebook-card')).toHaveCount(1);

  const after = await dump(page);
  expect(after.blobs).toEqual(before.blobs);
  expect(after.subjects).toEqual(before.subjects);
  expect(after.notebooks).toEqual(before.notebooks);
  expect(after.pages).toHaveLength(before.pages.length);
  for (const original of before.pages) {
    const restored = after.pages.find((row) => row.id === original.id);
    const { strokes: inkA, ...restA } = original;
    const { strokes: inkB, ...restB } = restored as StoredPage;
    expect(restB).toEqual(restA);
    expect(inkB).toHaveLength(inkA.length);
    inkA.forEach((stroke, s) => {
      stroke.p.forEach((value, i) => {
        const limit = i % 3 === 2 ? 0.0051 : 0.0101;
        const got = inkB[s]?.p[i] ?? NaN;
        if (Math.abs(got - value) > limit)
          throw new Error(`stroke ${stroke.id} moved at ${i}: ${value} → ${got}`);
      });
    });
  }
});

test.describe('on a 2× screen', () => {
  test.use({ deviceScaleFactor: 2, viewport: { width: 1000, height: 800 } });

  for (const zoom of [1, 8]) {
    test(`a restored page looks the same at ${zoom}×`, async ({ page }) => {
      test.setTimeout(180_000);
      await page.goto('./');
      await seedSample(page, 2, 220, { pageId: 'pg0', z: zoom });
      await page.reload();
      await expect(page.locator('.notebook-card')).toHaveCount(1);
      const original = await settledView(page, 'Лекции');
      const { share: noise } = await compareImages(page, original, await settledView(page, 'Лекции'));
      expect(noise).toBe(0);
      const { path } = await saveBackup(page);
      await wipe(page);
      await restoreBackup(page, path);
      const restored = await settledView(page, 'Лекции');
      const { share, worst } = await compareImages(page, original, restored);

      console.log(
        `[render] at ${zoom}× on a 2× screen: ${(share * 100).toFixed(4)} % of values off by more than 32, worst ${worst}`,
      );
      // A few edge pixels of hairline strokes, at most.
      expect(share).toBeLessThan(0.0005);
    });
  }
});

test('old JSON backups restore, under both app names', async ({ page }) => {
  for (const app of ['krispekt', 'konspektnik']) {
    await page.goto('./');
    await wipe(page);
    const backup = {
      app,
      version: 1,
      exportedAt: '2026-10-11T10:00:00.000Z',
      subjects: [{ id: 'subold', name: 'Старый предмет', color: '#2F5DA8', order: 0, createdAt: 1 }],
      notebooks: [
        {
          id: 'nbold',
          subjectId: 'subold',
          title: 'Старая тетрадь ' + app,
          color: '#2F5DA8',
          base: { w: 210, h: 297 },
          bg: 'grid',
          pageIds: ['pgold'],
          createdAt: 1,
          updatedAt: 1,
          view: null,
        },
      ],
      pages: [
        {
          id: 'pgold',
          nbId: 'nbold',
          w: 210,
          h: 297,
          locked: true,
          bg: 'grid',
          bgBlob: null,
          strokes: [{ id: 'st1', k: 'pen', c: '#000000', s: 2, p: [10.12, 20.46, 0.5, 30, 40, 0.6] }],
          texts: [],
          images: [],
          updatedAt: 1,
        },
      ],
    };
    await restoreBackup(page, {
      name: `krispekt-${app}.json`,
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(backup)),
    });
    await expect(page.locator('.notebook-card__title')).toHaveText('Старая тетрадь ' + app);
    const { pages } = await dump(page);
    expect(pages.find((row) => row.id === 'pgold')?.strokes[0]?.p[0]).toBeCloseTo(10.12, 3);
  }
});

test('a damaged backup says so and changes nothing', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('./');
  await seedSample(page, 2, 20);
  await page.reload();
  await expect(page.locator('.notebook-card')).toHaveCount(1);
  const before = await dump(page);
  const { path } = await saveBackup(page);
  const bytes = readFileSync(path);
  const stored = bytes.indexOf(Buffer.from([0xff, 0xd8, 0xff]));
  expect(stored).toBeGreaterThan(0);
  bytes[stored + 5000] = (bytes[stored + 5000] ?? 0) ^ 0xff;
  await wipe(page);
  const count = await page.locator('.notebook-card').count();
  await restoreBackupFailing(page, bytes);
  await expect(page.locator('.toast')).toContainText('повреждён');
  await expect(page.locator('.notebook-card')).toHaveCount(count);
  const after = await dump(page);
  expect(after.pages).toEqual([]);
  expect(after.blobs).toEqual([]);
  expect(before.blobs.length).toBeGreaterThan(0);

  await pickBackup(page, {
    name: 'not-a-backup.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from('PK\u0003\u0004 nope'),
  });
  await expect(page.locator('.toast')).toContainText('повреждён');
  await pickBackup(page, { name: 'photo.json', mimeType: 'application/json', buffer: Buffer.from('nope') });
  await expect(page.locator('.toast')).toContainText('не файл резервной копии');
});

async function restoreBackupFailing(page: Page, bytes: Buffer): Promise<void> {
  await pickBackup(page, { name: 'broken.zip', mimeType: 'application/zip', buffer: bytes });
  await expect(page.locator('.sheet__foot .btn--primary')).toBeVisible({ timeout: 60_000 });
  await page.click('.sheet__foot .btn--primary');
}

async function cardMenu(page: Page, title: string, item: string): Promise<void> {
  const card = page.locator('.notebook-card', { hasText: title });
  await card.locator('button[aria-haspopup], .notebook-card__menu, .icon-btn').first().click();
  await page.locator('.menu__item', { hasText: item }).click();
}

async function newSubject(page: Page, name: string): Promise<void> {
  await page.click('#btnAddSubject');
  await page.locator('.sheet input[type=text]').first().fill(name);
  await page.click('.sheet__foot .btn--primary');
  await expect(page.locator('.subject', { hasText: name })).toBeVisible();
}

async function newNotebook(page: Page, subject: string, title: string): Promise<void> {
  await page.locator('.subject', { hasText: subject }).locator('.shelf__add').click();
  await page.fill('#nb-title', title);
  await page.click('.sheet__foot .btn--primary');
  await expect(page.locator('#editor')).toBeVisible();
  await page.click('#btnBack');
  await expect(page.locator('#editor')).toBeHidden();
}

test('deleting goes to the Trash; restoring brings it back with its links working', async ({ page }) => {
  await page.goto('./');
  await wipe(page);
  await newSubject(page, 'Физика');
  await newNotebook(page, 'Физика', 'Цель');
  await newNotebook(page, 'Физика', 'Источник');

  // A text link in "Источник" leads to "Цель".
  const target = await page.evaluate(
    () =>
      new Promise<string>((resolve) => {
        const open = indexedDB.open('konspektnik');
        open.onsuccess = () => {
          const tx = open.result.transaction(['notebooks', 'pages'], 'readwrite');
          const all = tx.objectStore('notebooks').getAll();
          all.onsuccess = () => {
            const rows = all.result as { id: string; title: string; pageIds: string[] }[];
            const source = rows.find((row) => row.title === 'Источник');
            const goal = rows.find((row) => row.title === 'Цель');
            const pages = tx.objectStore('pages');
            const read = pages.get(source?.pageIds[0] ?? '');
            read.onsuccess = () => {
              const record = read.result as Record<string, unknown>;
              const link = { kind: 'notebook', nb: goal?.id };
              record.texts = [
                {
                  id: 'txlink',
                  x: 100,
                  y: 100,
                  w: 400,
                  t: 'Перейти',
                  fs: 40,
                  c: '#16181D',
                  paras: [{ runs: [{ t: 'Перейти', link }] }],
                },
              ];
              pages.put(record);
              resolve(goal?.id ?? '');
            };
          };
        };
      }),
  );
  expect(target).not.toBe('');
  await page.reload();
  await expect(page.locator('.notebook-card')).toHaveCount(2);

  // Found while it works: a broken link is drawn in another colour.
  await page.locator('.notebook-card__title', { hasText: 'Источник' }).click();
  await expect(page.locator('#editor')).toBeVisible();
  const link = await linkOnScreen(page);
  await page.click('#btnBack');
  await expect(page.locator('#editor')).toBeHidden();

  await cardMenu(page, 'Цель', 'Удалить');
  await expect(page.locator('.sheet')).toContainText('корзину');
  await page.click('.sheet__foot .btn--danger');
  await expect(page.locator('.toast')).toHaveText('Тетрадь в корзине');
  await expect(page.locator('.notebook-card')).toHaveCount(1);
  await expect(page.locator('#libSub')).toContainText('1 тетрадь');

  // The link is broken while the target is in the Trash.
  await page.locator('.notebook-card__title', { hasText: 'Источник' }).click();
  await expect(page.locator('#editor')).toBeVisible();
  await page.waitForTimeout(600);
  await page.mouse.click(link.x, link.y);
  await expect(page.locator('.sheet')).toContainText('Цель удалена');
  await page.locator('.sheet__foot .btn', { hasText: 'Отмена' }).click();
  await page.click('#btnBack');
  await expect(page.locator('#editor')).toBeHidden();

  // The Trash lists it, and it comes back.
  await menu(page, 'Корзина');
  await expect(page.locator('.trash__row')).toHaveCount(1);
  await expect(page.locator('.trash__title')).toHaveText('Цель');
  await expect(page.locator('.trash__facts')).toContainText('осталось: 30 дней');
  await page.locator('.trash__row .btn', { hasText: 'Восстановить' }).click();
  await expect(page.locator('.toast')).toContainText('восстановлено');
  await expect(page.locator('.trash')).toContainText('Корзина пуста');
  await page.locator('.sheet__head .icon-btn').click();
  await expect(page.locator('.notebook-card')).toHaveCount(2);

  // And the link works again.
  await page.locator('.notebook-card__title', { hasText: 'Источник' }).click();
  await expect(page.locator('#editor')).toBeVisible();
  await page.waitForTimeout(600);
  await page.mouse.click(link.x, link.y);
  await expect(page.locator('#edTitle')).toHaveText('Цель');
  await expect(page.locator('.sheet')).toHaveCount(0);
});

/** Where the seeded link is on screen: the first pixel in link blue, whatever the zoom. */
async function linkOnScreen(page: Page): Promise<{ x: number; y: number }> {
  await page.waitForTimeout(600);
  const shot = await page.locator('#stage').screenshot();
  const stage = await page.locator('#stage').boundingBox();
  if (!stage) throw new Error('no stage');
  const found = await page.evaluate(async (data) => {
    const image = new Image();
    image.src = 'data:image/png;base64,' + data;
    await image.decode();
    const canvas = new OffscreenCanvas(image.width, image.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(image, 0, 0);
    const { data: px, width, height } = ctx.getImageData(0, 0, image.width, image.height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const at = (y * width + x) * 4;
        const [r, g, b] = [px[at] ?? 0, px[at + 1] ?? 0, px[at + 2] ?? 0];
        if (r < 70 && g < 110 && b > 190) return { x, y };
      }
    }
    return null;
  }, shot.toString('base64'));
  if (!found) throw new Error('no link on screen');
  return { x: stage.x + found.x + 8, y: stage.y + found.y + 2 };
}

test('deleting a subject takes its notebooks along, and restoring brings them all back', async ({ page }) => {
  await page.goto('./');
  await wipe(page);
  await newSubject(page, 'История');
  await newNotebook(page, 'История', 'Первая');
  await newNotebook(page, 'История', 'Вторая');
  await page.locator('.subject', { hasText: 'История' }).locator('.icon-btn').first().click();
  const remove = page.locator('.menu__item', { hasText: 'Удалить' });
  if (!(await remove.count()))
    await page.locator('.subject', { hasText: 'История' }).locator('.icon-btn').nth(1).click();
  await remove.click();
  await page.click('.sheet__foot .btn--danger');
  await expect(page.locator('.subject')).toHaveCount(0);

  await menu(page, 'Корзина');
  await expect(page.locator('.trash__row')).toHaveCount(1);
  await expect(page.locator('.trash__facts')).toContainText('2 тетради');
  await page.locator('.trash__row .btn', { hasText: 'Восстановить' }).click();
  await page.locator('.sheet__head .icon-btn').click();
  await expect(page.locator('.notebook-card')).toHaveCount(2);
});

test('emptying the Trash asks with the size and frees the files; the report shows numbers', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto('./');
  await seedSample(page, 4, 40);
  await page.reload();
  await expect(page.locator('.notebook-card')).toHaveCount(1);

  await menu(page, 'Хранилище');
  const report = page.locator('.storage');
  await expect(report.locator('.storage__figures')).toBeVisible();
  await expect(report).toContainText('Рукопись и текст');
  await expect(report.locator('.storage__value').nth(2)).toContainText(/\d/);
  await expect(report).toContainText('Математика');
  await expect(report).toContainText('Лекции');
  await expect(report).toContainText('lecture.pdf');
  await expect(report).toContainText('Самые большие файлы');
  // The photos stay as they are; only a figure says what could be saved.
  await expect(report).toContainText('меньше');
  await report.locator('.storage__open').first().click();
  await expect(page.locator('#editor')).toBeVisible();
  await page.click('#btnBack');
  await expect(page.locator('#editor')).toBeHidden();

  const before = await dump(page);
  expect(before.blobs).toHaveLength(4);
  await cardMenu(page, 'Лекции', 'Удалить');
  await page.click('.sheet__foot .btn--danger');
  await expect(page.locator('.notebook-card')).toHaveCount(0);
  // Deleting frees nothing yet.
  expect((await dump(page)).blobs).toHaveLength(4);

  await menu(page, 'Хранилище');
  await expect(page.locator('.storage__value').nth(4)).not.toHaveText(/^0/);
  await page.locator('.sheet__head .icon-btn').click();

  await menu(page, 'Корзина');
  await page.locator('.trash__empty').click();
  const question = page.locator('.sheet', { hasText: 'Очистить корзину?' });
  await expect(question).toContainText(/около .*[МK]/i);
  await question.locator('.btn--danger').click();
  await expect(page.locator('.trash')).toContainText('Корзина пуста');
  await expect.poll(async () => (await dump(page)).notebooks).toEqual([]);
  // The photos may wait for the cleanup if they were saved in this session; these were not.
  expect((await dump(page)).blobs).toEqual([]);
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 320, height: 568 } });

  test('the Storage and Trash screens fit a 320 px screen', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('./');
    await seedSample(page, 3, 20);
    await page.reload();
    await expect(page.locator('.notebook-card')).toHaveCount(1);
    await menu(page, 'Хранилище');
    await expect(page.locator('.storage__figures')).toBeVisible();
    const overflowing = (): Promise<boolean> =>
      page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(await overflowing()).toBe(false);
    const sheet = await page.locator('.sheet').boundingBox();
    expect((sheet?.width ?? 999) <= 320).toBe(true);
    await page.locator('.sheet__head .icon-btn').click();
    await cardMenu(page, 'Лекции', 'Удалить');
    await page.click('.sheet__foot .btn--danger');
    await menu(page, 'Корзина');
    await expect(page.locator('.trash__row')).toHaveCount(1);
    expect(await overflowing()).toBe(false);
    // The list is drawn again once its sizes are known, which can replace the row being measured.
    await expect
      .poll(async () => (await page.locator('.trash__row').boundingBox())?.width ?? 999)
      .toBeLessThanOrEqual(320);
  });
});

/** A photo-like image with an EXIF block carrying a location, made by inserting the block by hand. */
async function photoWithExif(page: Page, width: number, height: number): Promise<Buffer> {
  const full = await page.evaluate(
    async ([w, h]) => {
      const canvas = new OffscreenCanvas(w as number, h as number);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no canvas');
      ctx.fillStyle = '#336699';
      ctx.fillRect(0, 0, w as number, h as number);
      const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
      const reader = new FileReader();
      return new Promise<string>((resolve) => {
        reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
        reader.readAsDataURL(blob);
      });
    },
    [width, height] as const,
  );
  const jpeg = Buffer.from(full, 'base64');
  const note = Buffer.from('Exif\0\0GPSLatitude 48.1351 secret place');
  const size = Buffer.alloc(2);
  size.writeUInt16BE(note.length + 2);
  // Right after the start marker: where a camera puts it.
  return Buffer.concat([jpeg.subarray(0, 2), Buffer.from([0xff, 0xe1]), size, note, jpeg.subarray(2)]);
}

/** How many images the notebook's pages hold, once saved. */
function storedImageCount(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const open = indexedDB.open('konspektnik');
        open.onerror = () => reject(new Error('no database'));
        open.onsuccess = () => {
          const all = open.result.transaction('pages').objectStore('pages').getAll();
          all.onsuccess = () => {
            open.result.close();
            resolve((all.result as { images: unknown[] }[]).reduce((sum, row) => sum + row.images.length, 0));
          };
        };
      }),
  );
}

function blobCount(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const open = indexedDB.open('konspektnik');
        open.onerror = () => reject(new Error('no database'));
        open.onsuccess = () => {
          const count = open.result.transaction('blobs').objectStore('blobs').count();
          count.onsuccess = () => {
            open.result.close();
            resolve(count.result);
          };
        };
      }),
  );
}

/** Inserts an image from the editor's photo button and returns what was stored. */
async function insertImage(page: Page, file: { name: string; mimeType: string; buffer: Buffer }) {
  const chooser = page.waitForEvent('filechooser');
  await page.locator('#tray [data-tool="image"], [data-item="image"], [data-action="image"]').first().click();
  await (await chooser).setFiles(file);
  // Encoding takes a moment, and saving waits for the next pause in the work.
  await expect.poll(() => blobCount(page), { timeout: 20_000 }).toBeGreaterThan(0);
  return page.evaluate(
    () =>
      new Promise<{
        type: string;
        size: number;
        head: string;
        text: string;
        width: number;
        height: number;
        alpha: boolean;
      }>((resolve) => {
        const open = indexedDB.open('konspektnik');
        open.onsuccess = () => {
          const all = open.result.transaction('blobs').objectStore('blobs').getAll();
          all.onsuccess = async () => {
            open.result.close();
            const rows = all.result as { blob: Blob }[];
            const { blob } = rows[rows.length - 1] as { blob: Blob };
            const bytes = new Uint8Array(await blob.arrayBuffer());
            const bitmap = await createImageBitmap(blob);
            const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
            const ctx = canvas.getContext('2d');
            ctx?.drawImage(bitmap, 0, 0);
            const corner = ctx?.getImageData(0, 0, 1, 1).data[3] ?? 255;
            resolve({
              type: blob.type,
              size: blob.size,
              head: String.fromCharCode(...bytes.subarray(0, 12)),
              text: String.fromCharCode(...bytes),
              width: bitmap.width,
              height: bitmap.height,
              alpha: corner < 255,
            });
          };
        };
      }),
  );
}

async function emptyEditor(page: Page): Promise<void> {
  await page.goto('./');
  await wipe(page);
  await newSubject(page, 'Фото');
  await page.locator('.subject', { hasText: 'Фото' }).locator('.shelf__add').click();
  await page.fill('#nb-title', 'Снимки');
  await page.click('.sheet__foot .btn--primary');
  await expect(page.locator('#editor')).toBeVisible();
}

test('a large new photo is made smaller, as WebP, without its location', async ({ page }) => {
  await emptyEditor(page);
  const photo = await photoWithExif(page, 4000, 3000);
  expect(photo.includes('GPSLatitude')).toBe(true);
  const stored = await insertImage(page, { name: 'camera.jpg', mimeType: 'image/jpeg', buffer: photo });
  expect(stored.type).toBe('image/webp');
  expect(stored.head.startsWith('RIFF')).toBe(true);
  expect(Math.max(stored.width, stored.height)).toBe(2560);
  expect(stored.height).toBe(1920);
  expect(stored.text).not.toContain('Exif');
  expect(stored.text).not.toContain('GPSLatitude');

  // A PDF cannot hold WebP: a vector export turns the photo into JPEG, not a huge PNG.
  await expect.poll(() => storedImageCount(page)).toBe(1);
  await page.click('#btnEdMore');
  await page.locator('.menu__item', { hasText: 'Экспорт' }).click();
  const exported = page.waitForEvent('download', {
    predicate: (download) => !/^krispekt-backup-/.test(download.suggestedFilename()),
  });
  await page.locator('.sheet .choice-list__item', { hasText: 'PDF (вектор' }).first().click();
  await page.locator('.sheet').getByRole('button', { name: 'Экспортировать' }).click();
  const pdf = readFileSync(await (await exported).path());
  expect(pdf.toString('latin1')).toContain('/DCTDecode');
  expect(pdf.length).toBeLessThan(2 * MB);
  expect(pdf.includes('GPSLatitude')).toBe(false);
});

test('with Keep original photo quality, a large photo keeps its size', async ({ page }) => {
  await emptyEditor(page);
  await page.click('#btnEdMore');
  await page.locator('.menu__item', { hasText: 'исходное качество' }).click();
  await page.keyboard.press('Escape');
  const photo = await photoWithExif(page, 3000, 2000);
  const stored = await insertImage(page, { name: 'camera.jpg', mimeType: 'image/jpeg', buffer: photo });
  expect([stored.width, stored.height]).toEqual([3000, 2000]);
  expect(stored.text).not.toContain('GPSLatitude');
});

test('a transparent PNG stays transparent', async ({ page }) => {
  await emptyEditor(page);
  const png = await page.evaluate(async () => {
    const canvas = new OffscreenCanvas(300, 200);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no canvas');
    ctx.fillStyle = '#c81e2c';
    ctx.fillRect(100, 50, 100, 100);
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    const reader = new FileReader();
    return new Promise<string>((resolve) => {
      reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
      reader.readAsDataURL(blob);
    });
  });
  const stored = await insertImage(page, {
    name: 'logo.png',
    mimeType: 'image/png',
    buffer: Buffer.from(png, 'base64'),
  });
  expect(stored.alpha).toBe(true);
  expect(stored.width).toBe(300);
});

/** Optional: writes more than 300 MB of files to disk and restores them. Set KRISPEKT_LARGE_BACKUP=1. */
test('a backup with more than 300 MB of files restores without running out of memory', async ({ page }) => {
  test.skip(!process.env.KRISPEKT_LARGE_BACKUP, 'slow; set KRISPEKT_LARGE_BACKUP=1');
  test.setTimeout(600_000);
  const folder = join(tmpdir(), 'krispekt-large-backup');
  mkdirSync(folder, { recursive: true });
  const path = join(folder, 'large.zip');
  const FILE_BYTES = 8 * MB;
  const COUNT = 45;
  const files: Zippable = {};
  const table: { id: string; file: string }[] = [];
  const entries: { name: string; size: number; sha256: string }[] = [];
  let state = 11;
  for (let n = 0; n < COUNT; n++) {
    const bytes = new Uint8Array(FILE_BYTES);
    for (let i = 0; i < FILE_BYTES; i += 997) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      bytes[i] = state & 0xff;
    }
    bytes.set([0xff, 0xd8, 0xff, 0xe0]);
    const sha = createHash('sha256').update(bytes).digest('hex');
    const name = `${sha}.jpg`;
    files[`files/${name}`] = [bytes, { level: 0 }];
    table.push({ id: `large${n}`, file: name });
    entries.push({ name: `files/${name}`, size: FILE_BYTES, sha256: sha });
  }
  const head = JSON.stringify({
    subjects: [{ id: 'sublarge', name: 'Большой', color: '#2F5DA8', order: 0, createdAt: 1 }],
    notebooks: [
      {
        id: 'nblarge',
        subjectId: 'sublarge',
        title: 'Большая тетрадь',
        color: '#2F5DA8',
        base: { w: 210, h: 297 },
        bg: 'grid',
        pageIds: ['pglarge'],
        createdAt: 1,
        updatedAt: 1,
        view: null,
      },
    ],
    blobs: table,
  });
  const line = JSON.stringify({
    id: 'pglarge',
    nbId: 'nblarge',
    w: 210,
    h: 297,
    locked: true,
    bg: 'grid',
    bgBlob: null,
    strokes: [],
    texts: [],
    images: table.map((row, i) => ({ id: `im${i}`, x: 0, y: 0, w: 10, h: 10, blob: row.id })),
    cards: [],
    anchors: [],
    inkLinks: [],
    updatedAt: 1,
  });
  const data = strToU8(`${head.slice(0, -1)},"pages":[\n${line}\n]}`);
  entries.push({
    name: 'data.json',
    size: data.length,
    sha256: createHash('sha256').update(data).digest('hex'),
  });
  const manifest = strToU8(
    JSON.stringify({
      app: 'krispekt',
      format: 2,
      createdAt: new Date().toISOString(),
      appVersion: 'test',
      entries,
    }),
  );
  writeFileSync(path, zipSync({ ...files, 'data.json': data, 'manifest.json': manifest }));
  const size = statSync(path).size;

  console.log(`[large] backup file ${(size / MB).toFixed(0)} MB, ${COUNT} files`);
  expect(size).toBeGreaterThan(300 * MB);

  await page.goto('./');
  await wipe(page);
  await restoreBackup(page, path);
  await expect(page.locator('.notebook-card__title')).toHaveText('Большая тетрадь');
  const stored = await page.evaluate(
    () =>
      new Promise<{ count: number; bytes: number; used: number }>((resolve) => {
        const open = indexedDB.open('konspektnik');
        open.onsuccess = () => {
          const all = open.result.transaction('blobs').objectStore('blobs').getAll();
          all.onsuccess = () => {
            open.result.close();
            const rows = all.result as { blob: Blob }[];
            const memory = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
            resolve({
              count: rows.length,
              bytes: rows.reduce((sum, row) => sum + row.blob.size, 0),
              used: memory?.usedJSHeapSize ?? 0,
            });
          };
        };
      }),
  );

  console.log(
    `[large] restored ${stored.count} files, ${(stored.bytes / MB).toFixed(0)} MB, JS heap ${(stored.used / MB).toFixed(0)} MB`,
  );
  expect(stored.count).toBe(COUNT);
  expect(stored.bytes).toBe(COUNT * FILE_BYTES);

  // And a backup of all that can be made again, in pieces.
  const again = await saveBackup(page);
  expect(statSync(again.path).size).toBeGreaterThan(300 * MB);
});
