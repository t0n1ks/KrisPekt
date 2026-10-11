import type { PDFDocumentProxy } from 'pdfjs-dist';
import {
  MAX_PDF_BYTES,
  MAX_PDF_PAGES,
  PAPER,
  PDF_IMPORT_JPEG_QUALITY,
  PDF_IMPORT_MAX_SCALE,
  PDF_IMPORT_WIDTH,
} from '../../core/constants';
import type { Page } from '../../core/types';
import { context2d } from '../../core/utils/dom';
import { canvasToBlob, pickFile, sniffFile } from '../../core/utils/files';
import { clamp } from '../../core/utils/math';
import type { I18n } from '../../i18n/I18n';
import type { BlobRepository } from '../../storage/BlobRepository';
import { LIMITS } from '../../storage/validation/guards';
import { PdfLoader } from './PdfLoader';

/** PDF points per millimetre. */
const PT_PER_MM = 72 / 25.4;

export interface PdfImporterDeps {
  loader: PdfLoader;
  blobs: BlobRepository;
  i18n: I18n;
  makeId: () => string;
  notify: (message: string, ms?: number) => void;
}

/**
 * Turns PDF pages into notebook pages with the rendered page as a background image.
 *
 * The file is treated as hostile: it must start with `%PDF-`, be at most 200 MB and have at
 * most 500 pages. pdf.js runs with scripting, XFA and eval disabled and only rasterises pages
 * to JPEG (1800 px wide, at most 3×, quality 0.86); no annotation or form layer is rendered.
 */
export class PdfImporter {
  constructor(private readonly deps: PdfImporterDeps) {}

  /** Lets the user pick a PDF and imports it. Null if cancelled; [] if it failed (a toast says why). */
  async pickAndImport(): Promise<{ pages: Page[]; name: string } | null> {
    const file = await pickFile('application/pdf,.pdf');
    if (!file) return null;
    return { pages: await this.import(file), name: file.name.replace(/\.pdf$/i, '') };
  }

  /** Imports every page of a PDF file. Imported pages are unlocked and sized from the PDF. */
  async import(file: Blob): Promise<Page[]> {
    const { i18n, notify } = this.deps;
    if (file.size > MAX_PDF_BYTES) {
      notify(i18n.t('fileTooBig'), 3500);
      return [];
    }
    if ((await sniffFile(file)) !== 'application/pdf') {
      notify(i18n.t('wrongFileType'), 3500);
      return [];
    }
    notify(i18n.t('pdfOpening'), 0);
    const pdf = await this.open(file);
    if (!pdf) return [];
    try {
      if (pdf.numPages > MAX_PDF_PAGES) {
        notify(i18n.t('pdfTooLong', { n: MAX_PDF_PAGES }), 4000);
        return [];
      }
      const pages = await this.renderAll(pdf);
      if (pages.length) notify(i18n.t('pdfDone', { n: i18n.plural(pages.length, 'pg') }), 2600);
      return pages;
    } finally {
      void pdf.loadingTask.destroy().catch(() => undefined);
    }
  }

  private async open(file: Blob): Promise<PDFDocumentProxy | null> {
    const { i18n, notify, loader } = this.deps;
    let pdfjs;
    try {
      pdfjs = await loader.load();
    } catch {
      notify(i18n.t('pdfModuleFail'), 4000);
      return null;
    }
    const params = {
      data: new Uint8Array(await file.arrayBuffer()),
      // pdf.js ≥ 5 no longer has an eval code path (CVE-2024-4367); kept as defence in depth.
      isEvalSupported: false,
      enableXfa: false,
      // Image decoders come as plain JS from our origin, so the CSP needs no 'wasm-unsafe-eval'.
      useWasm: false,
      wasmUrl: PdfLoader.wasmUrl,
      standardFontDataUrl: PdfLoader.standardFontDataUrl,
      stopAtErrors: false,
    };
    try {
      return await pdfjs.getDocument(params).promise;
    } catch {
      notify(i18n.t('pdfOpenFail'), 3500);
      return null;
    }
  }

  private async renderAll(pdf: PDFDocumentProxy): Promise<Page[]> {
    const { i18n, notify } = this.deps;
    const out: Page[] = [];
    try {
      for (let i = 1; i <= pdf.numPages; i++) {
        notify(i18n.t('pdfProgress', { i, n: pdf.numPages }), 0);
        out.push(await this.renderPage(pdf, i));
      }
    } catch {
      notify(i18n.t('pdfPartial', { n: out.length }), 4000);
    }
    return out;
  }

  private async renderPage(pdf: PDFDocumentProxy, index: number): Promise<Page> {
    const page = await pdf.getPage(index);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({
      scale: Math.min(PDF_IMPORT_WIDTH / base.width, PDF_IMPORT_MAX_SCALE),
    });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = context2d(canvas);
    ctx.fillStyle = PAPER.white;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    const blob = await canvasToBlob(canvas, 'image/jpeg', PDF_IMPORT_JPEG_QUALITY);
    canvas.width = 0;
    canvas.height = 0;
    page.cleanup();
    const blobId = this.deps.makeId();
    await this.deps.blobs.save(blobId, blob);
    const [min, max] = LIMITS.pageMm;
    return {
      id: this.deps.makeId(),
      nbId: 'pending',
      // Clamped so every stored page passes validation, even for unusual PDF page sizes.
      w: clamp(base.width / PT_PER_MM, min, max),
      h: clamp(base.height / PT_PER_MM, min, max),
      locked: false,
      bg: 'plain',
      bgBlob: blobId,
      strokes: [],
      texts: [],
      images: [],
      updatedAt: Date.now(),
    };
  }
}
