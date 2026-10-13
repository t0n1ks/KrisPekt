import type { BitmapCache } from '../../canvas/BitmapCache';
import type { PagePainter } from '../../canvas/PagePainter';
import type { Page } from '../../core/types';
import type { PixelSize } from '../../domain/ExportSizing';

export interface RasterOptions {
  /** Canvas scale over world px. */
  scale: number;
  size: PixelSize;
  /** Paper and pattern; without them the canvas stays transparent. */
  paper: boolean;
}

/**
 * Renders a page onto an off-screen canvas with the screen's canvas backend, for PNG export
 * and raster PDF. Images are loaded first, so nothing is drawn as a placeholder.
 */
export class PageRasterizer {
  constructor(
    private readonly painter: PagePainter,
    private readonly bitmaps: BitmapCache,
  ) {}

  /** The page as PNG. The canvas is released right after encoding. */
  async png(page: Page, options: RasterOptions): Promise<Blob> {
    const canvas = await this.render(page, options);
    try {
      return await PageRasterizer.encode(canvas);
    } finally {
      canvas.width = 0;
      canvas.height = 0;
    }
  }

  private async render(page: Page, options: RasterOptions): Promise<HTMLCanvasElement> {
    const source = await this.bitmaps.loadForPage(page);
    const canvas = document.createElement('canvas');
    canvas.width = options.size.w;
    canvas.height = options.size.h;
    // An opaque canvas encodes as RGB, which is smaller and needs no alpha mask in a PDF.
    const ctx = canvas.getContext('2d', { alpha: !options.paper });
    if (!ctx) throw new Error('2d context unavailable');
    ctx.setTransform(options.scale, 0, 0, options.scale, 0, 0);
    this.painter.paint(ctx, page, options.scale, null, { source, paper: options.paper });
    return canvas;
  }

  private static encode(canvas: HTMLCanvasElement): Promise<Blob> {
    return new Promise((resolve, reject) =>
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('PNG encoding failed'))), 'image/png'),
    );
  }
}
