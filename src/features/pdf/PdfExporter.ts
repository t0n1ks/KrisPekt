import { PencilGrain } from '../../canvas/brushes/PencilGrain';
import type { PagePainter } from '../../canvas/PagePainter';
import { MM, PDF_FONT_NAME, PDF_PATTERN_SCALE, PT_PER_PX } from '../../core/constants';
import type { Page, RasterDpi } from '../../core/types';
import { ExportSizing } from '../../domain/ExportSizing';
import type { I18n } from '../../i18n/I18n';
import type { PageRasterizer } from '../export/PageRasterizer';
import { PdfFont } from './PdfFont';
import type { PdfImages } from './PdfImages';
import { PdfVectorBackend } from './PdfVectorBackend';

type JsPdfModule = typeof import('jspdf');
type JsPdfDocument = InstanceType<JsPdfModule['jsPDF']>;

/** Vector paths and text (default), or every page as a lossless image. */
export type PdfMode = { kind: 'vector' } | { kind: 'raster'; dpi: RasterDpi };

/** A page rendered at a lower resolution than asked for, to stay within memory. */
export interface LoweredPage {
  /** 1-based position in the exported set. */
  index: number;
  dpi: number;
}

export interface PdfResult {
  blob: Blob;
  lowered: LoweredPage[];
}

export interface PdfExporterDeps {
  painter: PagePainter;
  rasterizer: PageRasterizer;
  images: PdfImages;
  font: PdfFont;
  i18n: I18n;
  notify: (message: string, ms?: number) => void;
}

/**
 * Exports pages to PDF, each on a PDF page of its exact size and orientation.
 *
 * Vector (default): strokes become filled outlines or stroked paths, patterns become thin
 * rectangles, text is real text in the embedded Onest font, and images are embedded at their
 * stored resolution. Everything comes from the same drawing commands as the screen, so the
 * PDF stays sharp at any zoom. Raster: every page as a PNG at 300 or 600 dpi.
 *
 * jsPDF is loaded on first use and is only ever given content the app produced itself.
 */
export class PdfExporter {
  private module: Promise<JsPdfModule> | null = null;
  /** Measured once: where text sits relative to the top of its em box. */
  private baseline: number | undefined;
  /** Computed once: the pencil grain's average coverage. */
  private pencilTone: number | undefined;

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

  /** Builds the PDF; null if a module or the font failed to load, or there are no pages (a toast says why). */
  async export(pages: readonly Page[], mode: PdfMode): Promise<PdfResult | null> {
    const { i18n, notify } = this.deps;
    if (!pages.length) {
      notify(i18n.t('noPages'));
      return null;
    }
    notify(i18n.t('pdfPreparing'), 0);
    let jspdf: JsPdfModule;
    try {
      jspdf = await this.load();
    } catch {
      notify(i18n.t('pdfModuleFail'), 4000);
      return null;
    }
    try {
      return await this.build(jspdf, pages, mode);
    } finally {
      this.deps.images.clear();
    }
  }

  private async build(jspdf: JsPdfModule, pages: readonly Page[], mode: PdfMode): Promise<PdfResult | null> {
    const { i18n, notify } = this.deps;
    const lowered: LoweredPage[] = [];
    let doc: JsPdfDocument | null = null;
    let page: Page | undefined;
    for (let i = 0; (page = pages[i]); i++) {
      notify(i18n.t('pdfExportProgress', { i: i + 1, n: pages.length }), 0);
      const fresh = !doc;
      doc = PdfExporter.addPage(jspdf, doc, page);
      if (mode.kind === 'vector') {
        if (fresh && !(await this.registerFont(doc))) return null;
        await this.addVectorPage(jspdf, doc, page);
      } else {
        const dpi = await this.addRasterPage(doc, page, mode.dpi);
        if (dpi < mode.dpi) lowered.push({ index: i + 1, dpi });
      }
      // Yield so the progress toast can paint and the UI stays responsive.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    return doc ? { blob: doc.output('blob'), lowered } : null;
  }

  private async registerFont(doc: JsPdfDocument): Promise<boolean> {
    try {
      await this.deps.font.register(doc);
      return true;
    } catch {
      this.deps.notify(this.deps.i18n.t('pdfFontFail'), 4000);
      return false;
    }
  }

  /** Starts a document with this page, or appends the page to it. */
  private static addPage(jspdf: JsPdfModule, doc: JsPdfDocument | null, page: Page): JsPdfDocument {
    const w = page.w * MM * PT_PER_PX;
    const h = page.h * MM * PT_PER_PX;
    const orientation = w > h ? 'l' : 'p';
    if (doc) return doc.addPage([w, h], orientation);
    return new jspdf.jsPDF({
      unit: 'pt',
      format: [w, h],
      orientation,
      compress: true,
      // 0.001 pt is far below anything visible, and keeps the file small.
      floatPrecision: 3,
      putOnlyUsedFonts: true,
    });
  }

  private async addVectorPage(jspdf: JsPdfModule, doc: JsPdfDocument, page: Page): Promise<void> {
    const backend = new PdfVectorBackend(jspdf, doc, {
      k: PT_PER_PX,
      font: PDF_FONT_NAME,
      baseline: (this.baseline ??= PdfFont.baseline()),
      pencilTone: (this.pencilTone ??= PencilGrain.meanCoverage()),
      images: await this.deps.images.forPage(page),
    });
    backend.beginPage(page.w * MM, page.h * MM);
    this.deps.painter.emit(backend, page, { scale: PDF_PATTERN_SCALE, highlightersFirst: true });
    backend.endPage();
  }

  /** Embeds the page as a PNG; returns the dpi it was rendered at. */
  private async addRasterPage(doc: JsPdfDocument, page: Page, dpi: RasterDpi): Promise<number> {
    const plan = ExportSizing.plan(page, ExportSizing.scaleForDpi(dpi));
    const png = await this.deps.rasterizer.png(page, { scale: plan.scale, size: plan.size, paper: true });
    const bytes = new Uint8Array(await png.arrayBuffer());
    const w = page.w * MM * PT_PER_PX;
    const h = page.h * MM * PT_PER_PX;
    doc.addImage(bytes, 'PNG', 0, 0, w, h, undefined, 'FAST');
    return plan.lowered ? ExportSizing.dpiOf(plan) : dpi;
  }
}
