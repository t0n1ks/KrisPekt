import { expect, type Page } from '@playwright/test';

/** World px per millimetre (as in the app). */
const MM = 96 / 25.4;

/** The fixture page's text boxes, one per interface language. */
export const FIXTURE_TEXTS = {
  ru: 'Конспект: производная функции',
  uk: 'Їжак ґрунтує щільні єноти',
  de: 'Größenänderung über Straße',
  en: 'Quick brown fox jumps',
} as const;

/** The grid cell (in mm, page-local) that holds the tiny handwriting. */
export const TINY_CELL_MM = { x: 100, y: 150, size: 5 } as const;

interface StrokeSeed {
  id: string;
  k: 'pen' | 'hl';
  b?: string;
  c: string;
  s: number;
  points: number[];
}

/** A wave from (x0, y) in mm, `width` mm wide, with pressure rising and falling. */
function wave(x0: number, y: number, width: number, amp: number): number[] {
  const out: number[] = [];
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    out.push(
      (x0 + t * width) * MM,
      (y + Math.sin(t * Math.PI * 3) * amp) * MM,
      0.2 + 0.7 * Math.sin(t * Math.PI),
    );
  }
  return out;
}

/** Small handwriting-like loops that fit inside one 5 mm grid cell. */
function tinyLoops(): number[] {
  const { x, y } = TINY_CELL_MM;
  const out: number[] = [];
  for (let i = 0; i <= 60; i++) {
    const t = i / 60;
    const a = t * Math.PI * 6;
    out.push((x + 0.6 + t * 3.6 + Math.cos(a) * 0.5) * MM, (y + 2.5 + Math.sin(a) * 1.2) * MM, 0.55);
  }
  return out;
}

function strokes(): StrokeSeed[] {
  return [
    { id: 'fxhl1', k: 'hl', c: '#FDE047', s: 18, points: wave(20, 40, 120, 0) },
    { id: 'fxball', k: 'pen', b: 'ballpoint', c: '#1E40AF', s: 2, points: wave(20, 40, 150, 3) },
    { id: 'fxfount', k: 'pen', b: 'fountain', c: '#172554', s: 2.4, points: wave(20, 60, 150, 4) },
    { id: 'fxfine', k: 'pen', b: 'fineliner', c: '#16181D', s: 1.2, points: wave(20, 80, 150, 3) },
    { id: 'fxpencil', k: 'pen', b: 'pencil', c: '#4B5563', s: 1.6, points: wave(20, 100, 150, 3) },
    { id: 'fxbrush', k: 'pen', b: 'brush', c: '#C81E2C', s: 4, points: wave(20, 120, 150, 4) },
    { id: 'fxhl2', k: 'hl', c: '#86EFAC', s: 14, points: wave(40, 100, 80, 0) },
    { id: 'fxdot', k: 'pen', c: '#000000', s: 3, points: [180 * MM, 150 * MM, 0.5] },
    { id: 'fxtiny', k: 'pen', b: 'fineliner', c: '#16181D', s: 0.5, points: tinyLoops() },
  ];
}

/**
 * Creates a notebook through the UI, then replaces its first page in IndexedDB with a fixture
 * page: a grid background, every brush, two highlighters (one under ink, one over it), a dot,
 * tiny handwriting inside one grid cell, a text box per language and a photo. Returns to the
 * shelf; the caller opens the notebook.
 */
export async function seedFixtureNotebook(page: Page, title: string): Promise<void> {
  await page.locator('.subject').first().locator('.shelf__add').click();
  await page.fill('#nb-title', title);
  await page.click('.sheet__foot .btn--primary');
  await expect(page.locator('#editor')).toBeVisible();
  await page.click('#btnBack');
  const texts = Object.values(FIXTURE_TEXTS).map((t, i) => ({
    id: 'fxtext' + i,
    x: 20 * MM,
    y: (170 + i * 14) * MM,
    w: 120 * MM,
    t,
    fs: 20,
    c: i % 2 ? '#B23A48' : '#16181D',
  }));
  await page.evaluate(
    async ([nbTitle, seeds, textItems, mm]) => {
      const canvas = new OffscreenCanvas(240, 150);
      const g = canvas.getContext('2d');
      if (!g) throw new Error('no 2d context');
      g.fillStyle = '#2F5DA8';
      g.fillRect(0, 0, 240, 150);
      g.fillStyle = '#FDE047';
      g.fillRect(30, 30, 90, 60);
      g.fillStyle = '#FFFFFF';
      g.fillRect(140, 70, 70, 50);
      const photo = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('konspektnik', 1);
        req.onsuccess = () => {
          const tx = req.result.transaction(['notebooks', 'pages', 'blobs'], 'readwrite');
          tx.objectStore('blobs').put({ id: 'fxphoto', blob: photo });
          const nbs = tx.objectStore('notebooks').getAll();
          nbs.onsuccess = () => {
            const nb = (nbs.result as { title: string; pageIds: string[] }[]).find(
              (x) => x.title === nbTitle,
            );
            const store = tx.objectStore('pages');
            const get = store.get(nb?.pageIds[0] ?? '');
            get.onsuccess = () => {
              const record = get.result as Record<string, unknown>;
              record.bg = 'grid';
              record.strokes = seeds.map(({ points, ...rest }) => ({ ...rest, p: new Float32Array(points) }));
              record.texts = textItems;
              record.images = [
                { id: 'fximg', x: 150 * mm, y: 220 * mm, w: 48 * mm, h: 30 * mm, blob: 'fxphoto' },
              ];
              store.put(record);
            };
          };
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(new Error('seed failed'));
        };
      });
    },
    [title, strokes(), texts, MM] as const,
  );
}

/** Opens a notebook from the shelf and waits until its first render settled. */
export async function openNotebook(page: Page, title: string): Promise<void> {
  await page.locator('.notebook-card__title', { hasText: title }).click();
  await expect(page.locator('#editor')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(800);
}
