import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';

/** Test-only URL prefix under which pdf.js is served from node_modules (same origin as the app). */
const PDFJS_PREFIX = '/KrisPekt/__test-pdfjs/';

/** The parts of pdf.js the tests use (it is loaded in the browser, untyped). */
interface PdfJs {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument(options: object): { promise: Promise<PdfDoc> };
}
interface PdfDoc {
  numPages: number;
  getPage(n: number): Promise<PdfPage>;
}
interface PdfPage {
  view: number[];
  getTextContent(): Promise<{ items: { str?: string }[] }>;
  getViewport(options: { scale: number }): { width: number; height: number };
  render(options: object): { promise: Promise<void> };
}

/** A rectangle in PDF points (origin top-left). */
export interface PtRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** What the browser reports about one rendered PDF page. */
export interface PdfPageInfo {
  pages: number;
  /** Size of the first page in points. */
  width: number;
  height: number;
  text: string;
}

/**
 * Serves pdf.js to the page from the same origin, so a test can render exported PDFs inside
 * the app's own page (its CSP allows same-origin scripts and workers only).
 */
export async function servePdfJs(page: Page): Promise<void> {
  await page.route(`**${PDFJS_PREFIX}*`, (route) => {
    const name = new URL(route.request().url()).pathname.slice(PDFJS_PREFIX.length);
    if (!/^pdf(\.worker)?\.min\.mjs$/.test(name)) return route.abort();
    return route.fulfill({
      body: readFileSync(join('node_modules/pdfjs-dist/build', name)),
      contentType: 'text/javascript',
    });
  });
}

/** Page count, first page size and all text of a PDF, read with pdf.js in the browser. */
export function pdfInfo(page: Page, pdf: Buffer): Promise<PdfPageInfo> {
  return page.evaluate(
    async ([b64, prefix]) => {
      const pdfjs = (await import(prefix + 'pdf.min.mjs')) as PdfJs;
      pdfjs.GlobalWorkerOptions.workerSrc = prefix + 'pdf.worker.min.mjs';
      const data = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const doc = await pdfjs.getDocument({ data }).promise;
      let text = '';
      for (let i = 1; i <= doc.numPages; i++) {
        const content = await (await doc.getPage(i)).getTextContent();
        text += content.items.map((item) => item.str ?? '').join(' ') + '\n';
      }
      const first = await doc.getPage(1);
      return { pages: doc.numPages, width: first.view[2], height: first.view[3], text };
    },
    [pdf.toString('base64'), PDFJS_PREFIX] as const,
  );
}

/**
 * Edge sharpness of a crop of page 1 viewed at `zoom` (1 = 100 %, 96 px per inch): the mean
 * squared luminance gradient (Tenengrad). A blurred edge spreads the same contrast over more
 * pixels, so its squared gradient drops.
 *
 * `asOldExport` first rasterises the page the way the previous exporter did (192 dpi, JPEG
 * 0.9) and then shows that image at the same zoom, which is what a viewer did with it.
 */
export function cropSharpness(
  page: Page,
  pdf: Buffer,
  crop: PtRect,
  zoom: number,
  asOldExport: boolean,
): Promise<number> {
  return page.evaluate(
    async ([b64, prefix, rect, z, old]) => {
      const pdfjs = (await import(prefix + 'pdf.min.mjs')) as PdfJs;
      pdfjs.GlobalWorkerOptions.workerSrc = prefix + 'pdf.worker.min.mjs';
      const data = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const doc = await pdfjs.getDocument({ data }).promise;
      const pdfPage = await doc.getPage(1);
      const pxPerPt = 96 / 72;
      const render = async (scale: number): Promise<HTMLCanvasElement> => {
        const viewport = pdfPage.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        await pdfPage.render({ canvas, viewport }).promise;
        return canvas;
      };
      const out = document.createElement('canvas');
      out.width = Math.round(rect.w * pxPerPt * z);
      out.height = Math.round(rect.h * pxPerPt * z);
      const ctx = out.getContext('2d');
      if (!ctx) throw new Error('no 2d context');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, out.width, out.height);
      if (old) {
        const lowScale = 2 * pxPerPt;
        const jpeg = new Image();
        jpeg.src = (await render(lowScale)).toDataURL('image/jpeg', 0.9);
        await jpeg.decode();
        const k = z / 2;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(jpeg, -rect.x * lowScale * k, -rect.y * lowScale * k, jpeg.width * k, jpeg.height * k);
      } else {
        ctx.drawImage(await render(pxPerPt * z), -rect.x * pxPerPt * z, -rect.y * pxPerPt * z);
      }
      const { data: px, width, height } = ctx.getImageData(0, 0, out.width, out.height);
      const lum = (x: number, y: number): number => {
        const i = (y * width + x) * 4;
        return 0.299 * (px[i] ?? 0) + 0.587 * (px[i + 1] ?? 0) + 0.114 * (px[i + 2] ?? 0);
      };
      let sum = 0;
      for (let y = 0; y < height - 1; y++) {
        for (let x = 0; x < width - 1; x++) {
          const gx = lum(x + 1, y) - lum(x, y);
          const gy = lum(x, y + 1) - lum(x, y);
          sum += gx * gx + gy * gy;
        }
      }
      return sum / ((width - 1) * (height - 1));
    },
    [pdf.toString('base64'), PDFJS_PREFIX, crop, zoom, asOldExport] as const,
  );
}
