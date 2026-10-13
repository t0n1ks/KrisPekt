import { EXPORT_MAX_PX, MM, PNG_SCALES, RASTER_DPIS } from '../core/constants';
import type { PageSize, PngScale, RasterDpi } from '../core/types';

/** A raster size in pixels. */
export interface PixelSize {
  w: number;
  h: number;
}

/** The scale a page is rasterised at, and whether it had to be lowered to fit the limit. */
export interface RasterPlan {
  /** Canvas scale over world px (1 = 96 dpi). */
  scale: number;
  size: PixelSize;
  lowered: boolean;
}

/** World px are CSS px at 96 dpi. */
const WORLD_DPI = 96;

/**
 * Pixel sizes for raster export (PNG and raster PDF). Pure, so the sizes shown in the export
 * dialog and the sizes produced are computed the same way.
 */
export class ExportSizing {
  /** A requested dpi limited to the offered values (300 for anything unknown). */
  static clampDpi(dpi: unknown): RasterDpi {
    return RASTER_DPIS.find((v) => v === dpi) ?? 300;
  }

  /** A requested PNG scale limited to the offered values (4 for anything unknown). */
  static clampScale(scale: unknown): PngScale {
    return PNG_SCALES.find((v) => v === scale) ?? 4;
  }

  /** Canvas scale for a resolution in dpi. */
  static scaleForDpi(dpi: number): number {
    return dpi / WORLD_DPI;
  }

  /** Pixel size of a page (mm) at a canvas scale. */
  static pixelSize(page: PageSize, scale: number): PixelSize {
    return {
      w: Math.max(1, Math.round(page.w * MM * scale)),
      h: Math.max(1, Math.round(page.h * MM * scale)),
    };
  }

  /**
   * The scale to rasterise a page at: the requested one, or a lower one when the page would
   * exceed `maxPx` pixels (very large pages at high resolution would run out of memory).
   */
  static plan(page: PageSize, scale: number, maxPx = EXPORT_MAX_PX): RasterPlan {
    const size = ExportSizing.pixelSize(page, scale);
    if (size.w * size.h <= maxPx) return { scale, size, lowered: false };
    let fitted = scale * Math.sqrt(maxPx / (size.w * size.h));
    // Rounding can push the size a pixel over; step down until it fits.
    while (ExportSizing.area(ExportSizing.pixelSize(page, fitted)) > maxPx) fitted *= 0.999;
    return { scale: fitted, size: ExportSizing.pixelSize(page, fitted), lowered: true };
  }

  /** The dpi a lowered raster plan actually has (rounded down). */
  static dpiOf(plan: RasterPlan): number {
    return Math.floor(plan.scale * WORLD_DPI);
  }

  private static area(size: PixelSize): number {
    return size.w * size.h;
  }
}
