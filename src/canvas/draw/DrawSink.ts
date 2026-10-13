import type { Stroke } from '../../core/types';
import type { PathSink, ShapePart } from '../brushes/PathSink';

/** How a filled shape is painted. */
export interface FillStyle {
  /** Colour, `#rrggbb`. */
  color: string;
  /** Opacity in [0, 1]. */
  alpha: number;
  /** `pencil`: paper grain (a pattern on canvas; a matching flat tone in vector output). */
  texture?: 'pencil';
}

/** How a stroked (centre-line) path is painted. */
export interface LineStyle {
  color: string;
  alpha: number;
  width: number;
  cap: 'round' | 'butt';
  join: 'round' | 'miter';
  /** `multiply` keeps the ink underneath visible (the highlighter). */
  blend: 'normal' | 'multiply';
}

/** One line of text, positioned by the top of its em box. */
export interface TextRun {
  text: string;
  x: number;
  top: number;
  /** Font size in world px. */
  size: number;
  color: string;
}

/** A stored image (photo or PDF page background) stretched over a rectangle. */
export interface ImageRun {
  /** Id of the record in the `blobs` store. */
  blob: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Drawn instead while the image is not available. */
  placeholder: string;
}

/**
 * Receives backend-independent drawing commands in page-local world px. Brushes, text layout
 * and background patterns emit into a sink; `Canvas2DBackend` paints them on a canvas
 * (screen, thumbnails, PNG and raster PDF export) and `PdfVectorBackend` writes them as PDF
 * paths and text, so both come from the same geometry.
 */
export interface DrawSink<P extends PathSink> {
  /** A new, empty path for this backend. */
  newPath(): P;
  fillPath(path: P, style: FillStyle): void;
  strokePath(path: P, style: LineStyle): void;
  fillRect(x: number, y: number, w: number, h: number, color: string): void;
  text(run: TextRun): void;
  image(run: ImageRun): void;
  /**
   * Shapes of stored strokes, kept between draws. Strokes are immutable, so a cached shape
   * never goes stale. Absent when the backend's paths are not reusable.
   */
  readonly shapeCache?: WeakMap<Stroke, ShapePart<P>[]>;
}
