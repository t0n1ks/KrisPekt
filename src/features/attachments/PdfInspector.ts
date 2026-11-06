import { CARD_THUMB_HEIGHT, CARD_THUMB_QUALITY, CARD_THUMB_WIDTH, PAPER } from '../../core/constants';
import type { PdfCard } from '../../core/types';
import { context2d } from '../../core/utils/dom';
import { canvasToBlob } from '../../core/utils/files';
import type { PdfLoader } from '../pdf/PdfLoader';

type PdfDocument = import('pdfjs-dist').PDFDocumentProxy;

/** What can be learned from a PDF by opening it. */
export interface PdfFacts {
  pages: number;
  thumb: Blob | null;
  problem?: NonNullable<PdfCard['problem']>;
}

/** Opens an attached PDF as far as it will open: its page count, and a picture of its first page. */
export class PdfInspector {
  constructor(private readonly loader: PdfLoader) {}

  /**
   * Never rejects because of the file: a protected or damaged one is reported in the facts, and can
   * still be attached and saved. Rejects only if pdf.js itself cannot be loaded (offline).
   */
  async inspect(bytes: Uint8Array): Promise<PdfFacts> {
    await this.loader.load();
    let pdf: PdfDocument;
    try {
      // A copy: pdf.js takes the buffer over to its worker.
      pdf = await this.loader.open(bytes.slice());
    } catch (error) {
      const locked = error instanceof Error && error.name === 'PasswordException';
      return { pages: 0, thumb: null, problem: locked ? 'locked' : 'broken' };
    }
    try {
      return { pages: pdf.numPages, thumb: await PdfInspector.thumbnail(pdf).catch(() => null) };
    } finally {
      void pdf.loadingTask.destroy().catch(() => undefined);
    }
  }

  /** The first page fitted inside a fixed 3:4 sheet, so a card knows its shape without reading it. */
  private static async thumbnail(pdf: PdfDocument): Promise<Blob> {
    const page = await pdf.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(CARD_THUMB_WIDTH / base.width, CARD_THUMB_HEIGHT / base.height);
    const viewport = page.getViewport({
      scale,
      offsetX: (CARD_THUMB_WIDTH - base.width * scale) / 2,
      offsetY: (CARD_THUMB_HEIGHT - base.height * scale) / 2,
    });
    const canvas = document.createElement('canvas');
    canvas.width = CARD_THUMB_WIDTH;
    canvas.height = CARD_THUMB_HEIGHT;
    const ctx = context2d(canvas);
    ctx.fillStyle = PAPER.white;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    const blob = await canvasToBlob(canvas, 'image/jpeg', CARD_THUMB_QUALITY);
    canvas.width = 0;
    canvas.height = 0;
    page.cleanup();
    return blob;
  }
}
