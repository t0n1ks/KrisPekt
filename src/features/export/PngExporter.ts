import type { Page, PngScale } from '../../core/types';
import { ExportSizing } from '../../domain/ExportSizing';
import type { I18n } from '../../i18n/I18n';
import type { PageRasterizer } from './PageRasterizer';
import type { ExportFile } from './ZipArchive';

/** A page to export and its number in the notebook (used in the file name). */
export interface NumberedPage {
  page: Page;
  number: number;
}

export interface PngResult {
  files: ExportFile[];
  /** Notebook page numbers rendered smaller than asked for, to stay within memory. */
  lowered: number[];
}

/**
 * Renders pages as PNG at 2×, 4× or 6× of their size at 96 dpi, with paper and pattern or
 * transparent. Files are named `<notebook>-p<N>.png`.
 */
export class PngExporter {
  constructor(
    private readonly rasterizer: PageRasterizer,
    private readonly i18n: I18n,
    private readonly notify: (message: string, ms?: number) => void,
  ) {}

  async export(
    pages: readonly NumberedPage[],
    scale: PngScale,
    transparent: boolean,
    baseName: string,
  ): Promise<PngResult> {
    const files: ExportFile[] = [];
    const lowered: number[] = [];
    for (const [i, { page, number }] of pages.entries()) {
      this.notify(this.i18n.t('pngExportProgress', { i: i + 1, n: pages.length }), 0);
      const plan = ExportSizing.plan(page, ExportSizing.clampScale(scale));
      if (plan.lowered) lowered.push(number);
      const blob = await this.rasterizer.png(page, {
        scale: plan.scale,
        size: plan.size,
        paper: !transparent,
      });
      files.push({ name: PngExporter.fileName(baseName, number), blob });
      // Yield so the progress toast can paint and the UI stays responsive.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    return { files, lowered };
  }

  /** `<notebook>-p<N>.png` */
  static fileName(baseName: string, number: number): string {
    return `${baseName}-p${number}.png`;
  }
}
