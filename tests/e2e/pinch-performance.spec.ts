import { expect, test, type Page } from '@playwright/test';

interface FrameStats {
  mean: number;
  p95: number;
  max: number;
}

/** Replaces the first page of a notebook with `count` wavy strokes, straight in IndexedDB. */
function seedStrokes(page: Page, title: string, count: number): Promise<void> {
  return page.evaluate(
    ([nbTitle, n]) =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('konspektnik', 1);
        req.onsuccess = () => {
          const tx = req.result.transaction(['notebooks', 'pages'], 'readwrite');
          const nbs = tx.objectStore('notebooks').getAll();
          nbs.onsuccess = () => {
            const nb = (nbs.result as { title: string; pageIds: string[] }[]).find(
              (x) => x.title === nbTitle,
            );
            const store = tx.objectStore('pages');
            const get = store.get(nb?.pageIds[0] ?? '');
            get.onsuccess = () => {
              const record = get.result as { strokes: unknown[] };
              record.strokes = Array.from({ length: n }, (_, i) => {
                const p = new Float32Array(40 * 3);
                for (let j = 0; j < 40; j++) {
                  p[j * 3] = 40 + (i % 10) * 70 + j * 1.5;
                  p[j * 3 + 1] = 60 + Math.floor(i / 10) * 33 + Math.sin(j / 4 + i) * 8;
                  p[j * 3 + 2] = 0.5;
                }
                return { id: 'perf' + i, k: 'pen', c: '#172554', s: 1.6, p };
              });
              store.put(record);
            };
          };
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(new Error('seed failed'));
        };
      }),
    [title, count] as const,
  );
}

/**
 * Pinches with one Ctrl + wheel step per animation frame around (x, y) and returns the frame
 * times (time between consecutive frames) in ms.
 */
function pinchFrames(page: Page, x: number, y: number, frames: number): Promise<FrameStats> {
  return page.evaluate(
    async ([cx, cy, n]) => {
      const canvas = document.getElementById('cv');
      const times: number[] = [];
      let last = await new Promise<number>((r) => requestAnimationFrame(r));
      for (let i = 0; i < n; i++) {
        const deltaY = i % 20 < 10 ? -12 : 12;
        canvas?.dispatchEvent(
          new WheelEvent('wheel', {
            clientX: cx,
            clientY: cy,
            deltaY,
            ctrlKey: true,
            bubbles: true,
            cancelable: true,
          }),
        );
        const t = await new Promise<number>((r) => requestAnimationFrame(r));
        times.push(t - last);
        last = t;
      }
      const sorted = [...times].sort((a, b) => a - b);
      return {
        mean: times.reduce((a, b) => a + b, 0) / times.length,
        p95: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
        max: sorted[sorted.length - 1] ?? 0,
      };
    },
    [x, y, frames] as const,
  );
}

const round = (s: FrameStats): string =>
  `mean ${s.mean.toFixed(1)} ms, p95 ${s.p95.toFixed(1)} ms, max ${s.max.toFixed(1)} ms`;

test('pinch frame time with 300 strokes, CPU throttled 4×', async ({ page }, testInfo) => {
  await page.goto('./');
  await page.locator('.subject').first().locator('.shelf__add').click();
  await page.fill('#nb-title', 'Perf');
  await page.click('.sheet__foot .btn--primary');
  await expect(page.locator('#editor')).toBeVisible();
  await page.click('#btnBack');
  await seedStrokes(page, 'Perf', 300);
  await page.locator('.notebook-card__title', { hasText: 'Perf' }).click();
  await expect(page.locator('#editor')).toBeVisible();
  await page.waitForTimeout(500);

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const results: Record<string, FrameStats> = {};

  // 1. Normal zoom, page bitmap up to date: stretched every frame.
  results.fresh = await pinchFrames(page, 640, 400, 60);
  await page.waitForTimeout(400);

  // 2. Just after an edit (a new stroke): the outdated bitmap is repainted once, then stretched.
  await page.mouse.move(300, 600);
  await page.mouse.down();
  await page.mouse.move(380, 620, { steps: 6 });
  await page.mouse.up();
  results.afterEdit = await pinchFrames(page, 640, 400, 60);
  await page.waitForTimeout(400);

  // 3. Deep zoom (page too big to cache): an edit there, then a pinch.
  for (let i = 0; i < 4; i++) {
    await page.evaluate(() =>
      document.getElementById('cv')?.dispatchEvent(
        new WheelEvent('wheel', {
          clientX: 640,
          clientY: 400,
          deltaY: -100,
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
  }
  await page.waitForTimeout(600);
  await page.mouse.move(600, 500);
  await page.mouse.down();
  await page.mouse.move(700, 520, { steps: 6 });
  await page.mouse.up();
  results.deepZoomAfterEdit = await pinchFrames(page, 640, 400, 60);

  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  const report = Object.entries(results)
    .map(([name, s]) => `${name}: ${round(s)}`)
    .join('\n');
  console.log(report);
  await testInfo.attach('pinch-frame-times', { body: report, contentType: 'text/plain' });
  // Loose bound: a throttled desktop CPU must still keep the pinch interactive.
  for (const s of Object.values(results)) expect(s.mean).toBeLessThan(100);
});
