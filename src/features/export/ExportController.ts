import type { ExportPrefs, Page } from '../../core/types';
import { safeFileName } from '../../core/utils/format';
import type { I18n } from '../../i18n/I18n';
import type { FileSaver } from '../files/FileSaver';
import type { PdfExporter } from '../pdf/PdfExporter';
import type { NumberedPage, PngExporter } from './PngExporter';
import type { ZipArchive } from './ZipArchive';

export interface ExportControllerDeps {
  pdf: PdfExporter;
  png: PngExporter;
  zip: ZipArchive;
  files: FileSaver;
  i18n: I18n;
  notify: (message: string, ms?: number) => void;
}

/** What to export: a notebook's pages (in order), which of them, and the chosen format. */
export interface ExportRequest {
  title: string;
  pages: readonly Page[];
  /** 0-based indices into `pages`, ascending. */
  indices: readonly number[];
  settings: ExportPrefs;
}

/**
 * Runs an export and saves the result: one PDF, one PNG, or several PNGs in a ZIP. Every
 * failure ends in a translated toast; nothing fails silently.
 */
export class ExportController {
  constructor(private readonly deps: ExportControllerDeps) {}

  async run(request: ExportRequest): Promise<void> {
    const { i18n, notify } = this.deps;
    const selected: NumberedPage[] = request.indices
      .map((i) => ({ page: request.pages[i], number: i + 1 }))
      .filter((x): x is NumberedPage => !!x.page);
    if (!selected.length) {
      notify(i18n.t('noPages'));
      return;
    }
    const base = safeFileName(request.title, i18n.t('defName'));
    try {
      const lowered =
        request.settings.format === 'png'
          ? await this.png(selected, request.settings, base)
          : await this.pdf(selected, request, base);
      if (lowered?.length) notify(i18n.t('exportLowered', { p: lowered.join(', ') }), 6000);
    } catch {
      notify(i18n.t('exportFail'), 4000);
    }
  }

  /** Saves a PDF; returns page numbers rendered at a lower resolution, or null if it was not made. */
  private async pdf(
    selected: NumberedPage[],
    request: ExportRequest,
    base: string,
  ): Promise<number[] | null> {
    const { settings } = request;
    const mode =
      settings.format === 'pdfRaster'
        ? { kind: 'raster' as const, dpi: settings.dpi }
        : { kind: 'vector' as const };
    const result = await this.deps.pdf.export(
      selected.map((x) => x.page),
      mode,
    );
    if (!result) return null;
    const name = base + ExportController.suffix(selected, request.pages.length) + '.pdf';
    await this.deps.files.save(name, result.blob);
    return result.lowered.map((l) => selected[l.index - 1]?.number ?? l.index);
  }

  /** Saves one PNG, or a ZIP of several. */
  private async png(selected: NumberedPage[], settings: ExportPrefs, base: string): Promise<number[]> {
    const result = await this.deps.png.export(selected, settings.scale, settings.transparent, base);
    const [single] = result.files;
    if (single && result.files.length === 1) {
      await this.deps.files.save(single.name, single.blob);
    } else {
      this.deps.notify(this.deps.i18n.t('zipPreparing'), 0);
      await this.deps.files.save(`${base}-png.zip`, await this.deps.zip.build(result.files));
    }
    return result.lowered;
  }

  /** File name suffix for part of a notebook: `-p3` or `-p3-5`; none for all pages. */
  static suffix(selected: readonly NumberedPage[], total: number): string {
    const first = selected[0]?.number ?? 1;
    const last = selected[selected.length - 1]?.number ?? first;
    if (selected.length === total) return '';
    return first === last ? `-p${first}` : `-p${first}-${last}`;
  }
}
