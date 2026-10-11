import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

type PdfJs = typeof import('pdfjs-dist');

/**
 * Loads pdf.js on first use (it is not in the main bundle). The legacy build is used for
 * older tablet browsers. The worker is a real module worker served from our own origin.
 */
export class PdfLoader {
  private module: Promise<PdfJs> | null = null;

  load(): Promise<PdfJs> {
    if (!this.module) {
      this.module = import('pdfjs-dist/legacy/build/pdf.min.mjs').then((pdfjs: PdfJs) => {
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
        return pdfjs;
      });
      // Allow a retry after a failed (offline) load.
      this.module.catch(() => {
        this.module = null;
      });
    }
    return this.module;
  }

  /** Same-origin folder with pdf.js' pure-JS image decoders (JPEG 2000, JBIG2). */
  static get wasmUrl(): string {
    return import.meta.env.BASE_URL + 'pdfjs/wasm/';
  }

  /** Same-origin folder with the 14 standard PDF fonts. */
  static get standardFontDataUrl(): string {
    return import.meta.env.BASE_URL + 'pdfjs/standard_fonts/';
  }
}
