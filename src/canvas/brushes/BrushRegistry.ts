import type { BrushKind, StrokeKind } from '../../core/types';
import { BallpointBrush } from './BallpointBrush';
import type { BrushRenderer } from './BrushRenderer';
import { FinelinerBrush } from './FinelinerBrush';
import { FountainBrush } from './FountainBrush';
import { HighlighterBrush } from './HighlighterBrush';
import { PaintBrush } from './PaintBrush';
import { PencilBrush } from './PencilBrush';

/**
 * Picks the renderer for a stroke: the highlighter for `hl` strokes, otherwise the pen brush
 * named by `b`. A missing or unknown brush id means `ballpoint`, so strokes saved before
 * brushes existed keep their look.
 */
export class BrushRegistry {
  private readonly pens: Record<BrushKind, BrushRenderer>;
  private readonly highlighter = new HighlighterBrush();

  constructor() {
    this.pens = {
      ballpoint: new BallpointBrush(),
      fountain: new FountainBrush(),
      fineliner: new FinelinerBrush(),
      pencil: new PencilBrush(),
      brush: new PaintBrush(),
    };
  }

  /** The pen brush with this id. */
  pen(kind: BrushKind): BrushRenderer {
    return this.pens[kind];
  }

  /** The renderer that draws a stroke. */
  forStroke(stroke: { k: StrokeKind; b?: BrushKind }): BrushRenderer {
    if (stroke.k === 'hl') return this.highlighter;
    return (stroke.b && this.pens[stroke.b]) || this.pens.ballpoint;
  }
}
