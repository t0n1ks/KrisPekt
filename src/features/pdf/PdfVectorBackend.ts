import type { ShapePart } from '../../canvas/brushes/PathSink';
import { CurveMath } from '../../canvas/draw/CurveMath';
import type { DrawSink, FillStyle, ImageRun, LineStyle, TextRun } from '../../canvas/draw/DrawSink';
import { PathRecorder, type PathCommand } from '../../canvas/draw/PathRecorder';
import type { Point, Stroke } from '../../core/types';

type JsPdfModule = typeof import('jspdf');
type JsPdfDocument = InstanceType<JsPdfModule['jsPDF']>;

/** An image ready for jsPDF: the stored bytes and their format. */
export interface PdfImage {
  data: Uint8Array;
  format: 'JPEG' | 'PNG';
}

export interface PdfVectorOptions {
  /** PDF points per world px. */
  k: number;
  /** The embedded text font's family name in jsPDF. */
  font: string;
  /** Distance from the top of the em box to the alphabetic baseline, per unit of font size. */
  baseline: number;
  /** Opacity share used for the pencil's grain (see `PencilGrain.meanCoverage`). */
  pencilTone: number;
  /** Images of the page by blob id; null when one could not be read. */
  images: ReadonlyMap<string, PdfImage | null>;
}

/**
 * Writes drawing commands into a jsPDF document as vector paths, real text and embedded
 * images. Coordinates arrive in page-local world px and are scaled to points. Quadratic
 * curves become exact cubics and arcs become cubic pieces. Colour, opacity and line settings
 * are only written when they change.
 */
export class PdfVectorBackend implements DrawSink<PathRecorder> {
  readonly shapeCache?: WeakMap<Stroke, ShapePart<PathRecorder>[]> = undefined;
  private fill = '';
  private draw = '';
  private alpha = 1;
  private width = -1;

  constructor(
    private readonly jspdf: JsPdfModule,
    private readonly doc: JsPdfDocument,
    private readonly options: PdfVectorOptions,
  ) {}

  /**
   * Starts a page: saves the graphics state and clips to the page rectangle, so content beyond
   * the page edge stays hidden as on screen. Pair with {@link endPage}.
   */
  beginPage(widthPx: number, heightPx: number): void {
    const k = this.options.k;
    this.doc.saveGraphicsState();
    this.doc.rect(0, 0, widthPx * k, heightPx * k, null);
    this.doc.clip();
    this.doc.discardPath();
    this.fill = '';
    this.draw = '';
    this.alpha = 1;
    this.width = -1;
  }

  /** Ends a page; restoring the state also resets jsPDF's opacity tracking for the next page. */
  endPage(): void {
    this.doc.restoreGraphicsState();
  }

  newPath(): PathRecorder {
    return new PathRecorder();
  }

  fillPath(path: PathRecorder, style: FillStyle): void {
    if (!this.trace(path.commands)) return;
    this.setAlpha(style.alpha * (style.texture === 'pencil' ? this.options.pencilTone : 1));
    this.setFill(style.color);
    this.doc.fill();
  }

  strokePath(path: PathRecorder, style: LineStyle): void {
    if (!this.trace(path.commands)) return;
    this.setAlpha(style.alpha);
    if (this.draw !== style.color) {
      this.draw = style.color;
      this.doc.setDrawColor(style.color);
    }
    const width = style.width * this.options.k;
    if (this.width !== width) {
      this.width = width;
      this.doc.setLineWidth(width);
    }
    this.doc.setLineCap(style.cap);
    this.doc.setLineJoin(style.join);
    this.doc.stroke();
  }

  fillRect(x: number, y: number, w: number, h: number, color: string): void {
    const k = this.options.k;
    this.setAlpha(1);
    this.setFill(color);
    this.doc.rect(x * k, y * k, w * k, h * k, 'F');
  }

  /** Real PDF text in the embedded font, so it can be selected and searched. */
  text(run: TextRun): void {
    if (!run.text.trim()) return;
    const k = this.options.k;
    this.setAlpha(1);
    this.doc.setFont(this.options.font, 'normal');
    this.doc.setFontSize(run.size * k);
    this.doc.setTextColor(run.color);
    this.doc.text(run.text, run.x * k, (run.top + run.size * this.options.baseline) * k);
  }

  /** Embeds the stored image as it is (no re-encoding); the blob id lets jsPDF reuse it. */
  image(run: ImageRun): void {
    const image = this.options.images.get(run.blob);
    if (!image) {
      this.fillRect(run.x, run.y, run.w, run.h, run.placeholder);
      return;
    }
    const k = this.options.k;
    this.setAlpha(1);
    this.doc.addImage(image.data, image.format, run.x * k, run.y * k, run.w * k, run.h * k, run.blob, 'NONE');
  }

  private setFill(color: string): void {
    if (this.fill === color) return;
    this.fill = color;
    this.doc.setFillColor(color);
  }

  private setAlpha(alpha: number): void {
    const value = Math.round(Math.min(1, Math.max(0, alpha)) * 1000) / 1000;
    if (this.alpha === value) return;
    this.alpha = value;
    this.doc.setGState(new this.jspdf.GState({ opacity: value, 'stroke-opacity': value }));
  }

  /** Writes a recorded path as PDF path operators; false if it has nothing to paint. */
  private trace(commands: readonly PathCommand[]): boolean {
    if (!commands.length) return false;
    const k = this.options.k;
    const doc = this.doc;
    let current: Point | null = null;
    let subpathStart: Point = { x: 0, y: 0 };
    const move = (x: number, y: number): void => {
      doc.moveTo(x * k, y * k);
      current = { x, y };
      subpathStart = current;
    };
    const line = (x: number, y: number): void => {
      if (!current) return move(x, y);
      doc.lineTo(x * k, y * k);
      current = { x, y };
    };
    for (const c of commands) {
      if (c.op === 'M') move(c.x, c.y);
      else if (c.op === 'L') line(c.x, c.y);
      else if (c.op === 'Q') {
        const from: Point = current ?? { x: c.cpx, y: c.cpy };
        if (!current) move(from.x, from.y);
        this.curve(CurveMath.quadToCubic(from, c.cpx, c.cpy, c.x, c.y));
        current = { x: c.x, y: c.y };
      } else if (c.op === 'A') {
        const arc = CurveMath.arcToCubics(c.x, c.y, c.r, c.start, c.end, c.ccw);
        line(arc.start.x, arc.start.y);
        for (const segment of arc.segments) this.curve(segment);
        const last = arc.segments[arc.segments.length - 1];
        if (last) current = { x: last[4], y: last[5] };
      } else {
        doc.close();
        current = subpathStart;
      }
    }
    return true;
  }

  private curve(c: readonly number[]): void {
    const k = this.options.k;
    const at = (i: number): number => (c[i] ?? 0) * k;
    this.doc.curveTo(at(0), at(1), at(2), at(3), at(4), at(5));
  }
}
