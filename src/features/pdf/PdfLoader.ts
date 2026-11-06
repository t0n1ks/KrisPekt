import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

type PdfJs = typeof import('pdfjs-dist');
type PdfDocument = import('pdfjs-dist').PDFDocumentProxy;

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

  /** How every PDF is opened: as a hostile file that may only be painted. */
  static documentOptions(data: Uint8Array) {
    return {
      data,
      // pdf.js ≥ 5 no longer has an eval code path (CVE-2024-4367); kept as defence in depth.
      isEvalSupported: false,
      enableXfa: false,
      // Image decoders come as plain JS from our origin, so the CSP needs no 'wasm-unsafe-eval'.
      useWasm: false,
      wasmUrl: PdfLoader.wasmUrl,
      standardFontDataUrl: PdfLoader.standardFontDataUrl,
      stopAtErrors: false,
    };
  }

  /**
   * Opens a PDF from memory. Rejects if the module cannot be loaded or the file cannot be read; a
   * password-protected file rejects with an error named `PasswordException`.
   */
  async open(data: Uint8Array): Promise<PdfDocument> {
    const pdfjs = await this.load();
    return pdfjs.getDocument(PdfLoader.documentOptions(data)).promise;
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
