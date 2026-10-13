import type { BitmapCache } from '../../canvas/BitmapCache';
import type { PagePainter } from '../../canvas/PagePainter';
import { MM, PDF_EXPORT_JPEG_QUALITY, PDF_EXPORT_SCALE } from '../../core/constants';
import type { Page } from '../../core/types';
import { context2d } from '../../core/utils/dom';
import type { I18n } from '../../i18n/I18n';

type JsPdfModule = typeof import('jspdf');
type JsPdfDocument = InstanceType<JsPdfModule['jsPDF']>;

/** PDF points per millimetre. */
const PT_PER_MM = 72 / 25.4;

export interface PdfExporterDeps {
  painter: PagePainter;
  bitmaps: BitmapCache;
  i18n: I18n;
  notify: (message: string, ms?: number) => void;
}

/**
 * Exports a notebook to PDF: every page is rendered at 2× as a JPEG (quality 0.9) onto a PDF
 * page of the same size and orientation. jsPDF is loaded on first use and is only ever given
 * images the app rendered itself.
 */
export class PdfExporter {
  private module: Promise<JsPdfModule> | null = null;

  constructor(private readonly deps: PdfExporterDeps) {}

  private load(): Promise<JsPdfModule> {
    if (!this.module) {
      this.module = import('jspdf');
      this.module.catch(() => {
        this.module = null;
      });
    }
    return this.module;
  }

  /** Builds the PDF; null if jsPDF failed to load or there are no pages (a toast says why). */
  async export(pages: readonly Page[]): Promise<Blob | null> {
    const { i18n, notify } = this.deps;
    notify(i18n.t('pdfPreparing'), 0);
    let jspdf: JsPdfModule;
    try {
      jspdf = await this.load();
    } catch {
      notify(i18n.t('pdfModuleFail'), 4000);
      return null;
    }
    let doc: JsPdfDocument | null = null;
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      if (!page) continue;
      notify(i18n.t('pdfExportProgress', { i: i + 1, n: pages.length }), 0);
      doc = await this.addPage(jspdf, doc, page);
      // Yield so the progress toast can paint.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    if (!doc) {
      notify(i18n.t('noPages'));
      return null;
    }
    return doc.output('blob');
  }

  private async addPage(jspdf: JsPdfModule, doc: JsPdfDocument | null, page: Page): Promise<JsPdfDocument> {
    const bitmaps = await this.deps.bitmaps.loadForPage(page);
    const sc = PDF_EXPORT_SCALE;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(page.w * MM * sc);
    canvas.height = Math.round(page.h * MM * sc);
    const ctx = context2d(canvas);
    ctx.setTransform(sc, 0, 0, sc, 0, 0);
    this.deps.painter.paint(ctx, page, sc, null, { source: bitmaps });
    const data = canvas.toDataURL('image/jpeg', PDF_EXPORT_JPEG_QUALITY);
    canvas.width = 0;
    canvas.height = 0;
    const w = page.w * PT_PER_MM;
    const h = page.h * PT_PER_MM;
    const orientation = w > h ? 'l' : 'p';
    const target = doc ?? new jspdf.jsPDF({ unit: 'pt', format: [w, h], orientation, compress: true });
    if (doc) target.addPage([w, h], orientation);
    target.addImage(data, 'JPEG', 0, 0, w, h, undefined, 'FAST');
    return target;
  }
}
