import { PDF_FONT_FILE, PDF_FONT_NAME, TEXT_LINE_HEIGHT } from '../../core/constants';
import { TextLayout } from '../../canvas/TextLayout';

type JsPdfDocument = InstanceType<(typeof import('jspdf'))['jsPDF']>;

/** File name of the font inside jsPDF's virtual file system. */
const VFS_NAME = 'Onest-Regular.ttf';
/** Onest's em-box ascent share (hhea 970 / (970 + 305)); used when the canvas cannot measure it. */
const FALLBACK_BASELINE = 970 / 1275;
/** Font size the baseline is measured at (large, for precision). */
const PROBE_SIZE = 100;

/**
 * The text font for vector PDF: Onest Regular as a Latin + Cyrillic TTF from our own origin
 * (`public/fonts`, SIL OFL). It is fetched only when a vector PDF is made, then kept for the
 * session. jsPDF embeds only the glyphs the document uses.
 */
export class PdfFont {
  private data: Promise<string> | null = null;

  /** @param fetchFont reads the TTF bytes (the same-origin file by default; tests read it from disk) */
  constructor(private readonly fetchFont: () => Promise<Uint8Array> = PdfFont.fetchSameOrigin) {}

  /** Registers the font in a document; rejects when it cannot be loaded. */
  async register(doc: JsPdfDocument): Promise<string> {
    doc.addFileToVFS(VFS_NAME, await this.load());
    doc.addFont(VFS_NAME, PDF_FONT_NAME, 'normal', 400, 'Identity-H');
    return PDF_FONT_NAME;
  }

  /**
   * How far below the top of the em box the alphabetic baseline lies, per unit of font size.
   * The screen draws text from the top of the em box; PDF places it on the baseline. Measured
   * from the canvas, so the PDF matches what this browser shows.
   */
  static baseline(): number {
    try {
      const ctx = document.createElement('canvas').getContext('2d');
      if (!ctx) return FALLBACK_BASELINE;
      ctx.font = TextLayout.font(PROBE_SIZE);
      ctx.textBaseline = 'top';
      const ratio = Math.abs(ctx.measureText('H').alphabeticBaseline) / PROBE_SIZE;
      return ratio > 0.5 && ratio < TEXT_LINE_HEIGHT ? ratio : FALLBACK_BASELINE;
    } catch {
      return FALLBACK_BASELINE;
    }
  }

  private load(): Promise<string> {
    if (!this.data) {
      this.data = this.fetchBase64();
      this.data.catch(() => {
        this.data = null;
      });
    }
    return this.data;
  }

  private async fetchBase64(): Promise<string> {
    return PdfFont.toBase64(await this.fetchFont());
  }

  private static async fetchSameOrigin(): Promise<Uint8Array> {
    const response = await fetch(import.meta.env.BASE_URL + PDF_FONT_FILE);
    if (!response.ok) throw new Error(`font: HTTP ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  }

  /** Base64 of binary data, built in chunks (a single `fromCharCode` call overflows the stack). */
  static toBase64(bytes: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary);
  }
}
