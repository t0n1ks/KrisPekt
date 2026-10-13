// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { OPS, getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { BitmapCache } from '../../src/canvas/BitmapCache';
import { BrushRegistry } from '../../src/canvas/brushes/BrushRegistry';
import { PencilGrain } from '../../src/canvas/brushes/PencilGrain';
import { PagePainter } from '../../src/canvas/PagePainter';
import { PatternPainter } from '../../src/canvas/PatternPainter';
import { StrokePainter } from '../../src/canvas/StrokePainter';
import { TextLayout } from '../../src/canvas/TextLayout';
import { BRUSH_KINDS } from '../../src/core/constants';
import type { Page, Stroke } from '../../src/core/types';
import type { PageRasterizer } from '../../src/features/export/PageRasterizer';
import { PdfExporter } from '../../src/features/pdf/PdfExporter';
import { PdfFont } from '../../src/features/pdf/PdfFont';
import { PdfImages } from '../../src/features/pdf/PdfImages';
import { I18n } from '../../src/i18n/I18n';
import type { BlobRepository } from '../../src/storage/BlobRepository';
import fontDataUrl from '../../public/fonts/Onest-Regular.ttf?inline';
import { page } from './fixtures';

/** An 8 × 6 px JPEG (blue with a yellow block). */
const PHOTO_JPEG =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAGAAgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDn/tul/wBhfZf7I/4mX/P99pb+9n/V9Pu/L+tFFFfX06UaV+W+rvq29+127LyVkuiPAlJytfof/9k=';

const TEXTS = {
  ru: 'Конспект: производная функции',
  uk: 'Їжак ґрунтує щільні єноти',
  de: 'Größenänderung über Straße',
  en: 'Quick brown fox jumps',
};

function base64Bytes(b64: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

/** Text measurement without a canvas: every character is half the font size wide. */
const measurer = {
  font: '400 20px x',
  measureText(text: string): { width: number } {
    return { width: text.length * (parseFloat(this.font.split(' ')[1] ?? '20') / 2) };
  },
};

function wave(y: number): Float32Array {
  const out: number[] = [];
  for (let i = 0; i <= 30; i++)
    out.push(60 + i * 12, y + Math.sin(i / 3) * 10, 0.2 + 0.6 * Math.sin((i / 30) * Math.PI));
  return new Float32Array(out);
}

/** A grid page with every brush, a highlighter, text in four languages and a photo. */
function fixturePage(overrides: Partial<Page> = {}): Page {
  const strokes: Stroke[] = [
    { id: 'hl1', k: 'hl', c: '#FDE047', s: 18, p: wave(100) },
    ...BRUSH_KINDS.map((b, i): Stroke => ({
      id: 'st' + i,
      k: 'pen',
      b,
      c: '#1E40AF',
      s: 2.4,
      p: wave(100 + i * 60),
    })),
    { id: 'dot', k: 'pen', c: '#000000', s: 3, p: new Float32Array([500, 500, 0.5]) },
  ];
  const texts = Object.values(TEXTS).map((t, i) => ({
    id: 'tx' + i,
    x: 70,
    y: 500 + i * 40,
    w: 600,
    t,
    fs: 20,
    c: '#16181D',
  }));
  return page({
    bg: 'grid',
    strokes,
    texts,
    images: [{ id: 'im1', x: 400, y: 800, w: 160, h: 120, blob: 'photo' }],
    ...overrides,
  });
}

function exporter(): PdfExporter {
  const strokes = new StrokePainter(new BrushRegistry(), new PencilGrain());
  const bitmaps = { get: () => null } as unknown as BitmapCache;
  const painter = new PagePainter(new PatternPainter(), strokes, new TextLayout(measurer), bitmaps);
  const photo = new Blob([base64Bytes(PHOTO_JPEG)], { type: 'image/jpeg' });
  const blobs = {
    get: (id: string) => Promise.resolve(id === 'photo' ? photo : null),
  } as unknown as BlobRepository;
  return new PdfExporter({
    painter,
    rasterizer: {} as PageRasterizer,
    images: new PdfImages(blobs),
    font: new PdfFont(() => Promise.resolve(base64Bytes(fontDataUrl.slice(fontDataUrl.indexOf(',') + 1)))),
    i18n: new I18n('ru'),
    notify: () => undefined,
  });
}

async function openPdf(blob: Blob) {
  return getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
}

describe('vector PDF export', () => {
  it('writes every page at its exact size as vector paths, real text and the stored image', async () => {
    const landscape = fixturePage({ id: 'pg2', w: 297, h: 210, strokes: [], texts: [], images: [] });
    const result = await exporter().export([fixturePage(), landscape], { kind: 'vector' });
    if (!result) throw new Error('no PDF');
    expect(result.lowered).toEqual([]);
    const doc = await openPdf(result.blob);
    expect(doc.numPages).toBe(2);

    const first = await doc.getPage(1);
    expect(first.view[2]).toBeCloseTo((210 * 72) / 25.4, 2);
    expect(first.view[3]).toBeCloseTo((297 * 72) / 25.4, 2);
    const second = await doc.getPage(2);
    expect(second.view[2]).toBeCloseTo((297 * 72) / 25.4, 2);
    expect(second.view[3]).toBeCloseTo((210 * 72) / 25.4, 2);

    const ops = (await first.getOperatorList()).fnArray;
    const count = (op: number): number => ops.filter((f) => f === op).length;
    // Strokes, grid lines and dots are paths; the only image is the photo, not a page picture.
    expect(count(OPS.constructPath)).toBeGreaterThan(50);
    expect(count(OPS.paintImageXObject)).toBe(1);
    expect(count(OPS.showText)).toBe(4);

    const text = (await first.getTextContent()).items
      .map((item) => ('str' in item ? item.str : ''))
      .join('\n');
    for (const t of Object.values(TEXTS)) expect(text).toContain(t);
  });

  it('places text on the baseline the screen uses and inside the page clip', async () => {
    const result = await exporter().export([fixturePage()], { kind: 'vector' });
    if (!result) throw new Error('no PDF');
    const first = await (await openPdf(result.blob)).getPage(1);
    const items = (await first.getTextContent()).items.filter((item) => 'str' in item && item.str.trim());
    const ru = items.find((item) => 'str' in item && item.str === TEXTS.ru);
    if (!ru || !('transform' in ru)) throw new Error('text missing');
    const pt = 72 / 96;
    const lh = 20 * 1.35;
    const expectedBaseline = (500 + (lh - 20) / 2 + 20 * (970 / 1275)) * pt;
    expect(ru.transform[4]).toBeCloseTo(70 * pt, 2);
    // PDF y grows upwards from the bottom of the page.
    expect(first.view[3] - (ru.transform[5] ?? 0)).toBeCloseTo(expectedBaseline, 1);
    expect(ru.transform[0]).toBeCloseTo(20 * pt, 2);
  });

  it('keeps an empty page valid and stops with a toast when the font is missing', async () => {
    const blank = await exporter().export([page({ strokes: [], texts: [], bg: 'plain' })], {
      kind: 'vector',
    });
    expect(blank && (await openPdf(blank.blob)).numPages).toBe(1);

    const messages: string[] = [];
    const strokes = new StrokePainter(new BrushRegistry(), new PencilGrain());
    const failing = new PdfExporter({
      painter: new PagePainter(new PatternPainter(), strokes, new TextLayout(measurer), {} as BitmapCache),
      rasterizer: {} as PageRasterizer,
      images: new PdfImages({ get: () => Promise.resolve(null) } as unknown as BlobRepository),
      font: new PdfFont(() => Promise.reject(new Error('offline'))),
      i18n: new I18n('ru'),
      notify: (m) => messages.push(m),
    });
    expect(await failing.export([fixturePage()], { kind: 'vector' })).toBeNull();
    expect(messages.at(-1)).toBe(new I18n('ru').t('pdfFontFail'));
  });
});

describe('older notebooks', () => {
  it('export a PDF-imported page background and brush-less strokes', async () => {
    const legacy = page({
      bgBlob: 'photo',
      texts: [],
      strokes: [{ id: 'old', k: 'pen', c: '#1E40AF', s: 2, p: new Float32Array([10, 10, 0.5, 80, 40, 0.5]) }],
    });
    const result = await exporter().export([legacy], { kind: 'vector' });
    if (!result) throw new Error('no PDF');
    const pdfPage = await (await openPdf(result.blob)).getPage(1);
    const fns = (await pdfPage.getOperatorList()).fnArray;
    expect(fns.filter((f) => f === OPS.paintImageXObject)).toHaveLength(1);
    expect(fns.filter((f) => f === OPS.constructPath).length).toBeGreaterThan(0);
  });
});

describe('PdfImages.sniff', () => {
  it('recognises JPEG and PNG by their signature only', () => {
    expect(PdfImages.sniff(new Uint8Array(base64Bytes(PHOTO_JPEG)))).toBe('JPEG');
    expect(PdfImages.sniff(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe('PNG');
    expect(PdfImages.sniff(new TextEncoder().encode('RIFF....WEBP'))).toBeNull();
    expect(PdfImages.sniff(new TextEncoder().encode('<svg'))).toBeNull();
  });
});
