import { describe, expect, it } from 'vitest';
import { BrushRegistry } from '../../src/canvas/brushes/BrushRegistry';
import type { BrushRenderer } from '../../src/canvas/brushes/BrushRenderer';
import { PencilGrain } from '../../src/canvas/brushes/PencilGrain';
import { CurveMath } from '../../src/canvas/draw/CurveMath';
import type { DrawSink, FillStyle, ImageRun, LineStyle, TextRun } from '../../src/canvas/draw/DrawSink';
import { PathRecorder } from '../../src/canvas/draw/PathRecorder';
import { PagePainter } from '../../src/canvas/PagePainter';
import { PatternPainter } from '../../src/canvas/PatternPainter';
import { StrokePainter } from '../../src/canvas/StrokePainter';
import { TextLayout } from '../../src/canvas/TextLayout';
import type { BitmapCache } from '../../src/canvas/BitmapCache';
import { BRUSH_KINDS, MM, TEXT_LINE_HEIGHT } from '../../src/core/constants';
import type { Stroke } from '../../src/core/types';
import { page } from './fixtures';

/** One recorded drawing command. */
type Recorded =
  | { kind: 'fill'; path: PathRecorder; style: FillStyle }
  | { kind: 'stroke'; path: PathRecorder; style: LineStyle }
  | { kind: 'rect'; x: number; y: number; w: number; h: number; color: string }
  | { kind: 'text'; run: TextRun }
  | { kind: 'image'; run: ImageRun };

/** A drawing backend that only records what it is given. */
class RecordingSink implements DrawSink<PathRecorder> {
  readonly commands: Recorded[] = [];
  newPath(): PathRecorder {
    return new PathRecorder();
  }
  fillPath(path: PathRecorder, style: FillStyle): void {
    this.commands.push({ kind: 'fill', path, style });
  }
  strokePath(path: PathRecorder, style: LineStyle): void {
    this.commands.push({ kind: 'stroke', path, style });
  }
  fillRect(x: number, y: number, w: number, h: number, color: string): void {
    this.commands.push({ kind: 'rect', x, y, w, h, color });
  }
  text(run: TextRun): void {
    this.commands.push({ kind: 'text', run });
  }
  image(run: ImageRun): void {
    this.commands.push({ kind: 'image', run });
  }
}

/** A text measurer without a canvas: every character is half the font size wide. */
const measurer = {
  font: '400 20px x',
  measureText(text: string): { width: number } {
    return { width: text.length * (parseFloat(this.font.split(' ')[1] ?? '20') / 2) };
  },
};

function painterParts(): { painter: PagePainter; strokes: StrokePainter; texts: TextLayout } {
  const strokes = new StrokePainter(new BrushRegistry(), new PencilGrain());
  const texts = new TextLayout(measurer);
  const bitmaps = { get: () => null } as unknown as BitmapCache;
  return { painter: new PagePainter(new PatternPainter(), strokes, texts, bitmaps), strokes, texts };
}

function points(n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++)
    out.push(10 + i * 3, 20 + Math.sin(i / 2) * 5, 0.1 + (0.8 * i) / Math.max(1, n - 1));
  return out;
}

const registry = new BrushRegistry();
const renderers: [string, BrushRenderer][] = [
  ...BRUSH_KINDS.map((b): [string, BrushRenderer] => [b, registry.pen(b)]),
  ['highlighter', registry.forStroke({ k: 'hl' })],
];

describe('drawing commands from every brush', () => {
  for (const [name, renderer] of renderers) {
    for (const n of [1, 2, 60]) {
      it(`${name} with ${n} point(s) emits finite, non-empty commands`, () => {
        const sink = new RecordingSink();
        const stroke = {
          k: name === 'highlighter' ? ('hl' as const) : ('pen' as const),
          c: '#1E40AF',
          s: 2.4,
          p: points(n),
        };
        renderer.paint(
          sink,
          stroke,
          renderer.shape(stroke.p, stroke.s, () => sink.newPath()),
        );
        expect(sink.commands.length).toBeGreaterThan(0);
        for (const c of sink.commands) {
          if (c.kind !== 'fill' && c.kind !== 'stroke') throw new Error('unexpected ' + c.kind);
          expect(c.path.commands.length).toBeGreaterThan(0);
          expect(c.path.isFinite()).toBe(true);
          expect(c.style.alpha).toBeGreaterThan(0);
          expect(c.style.alpha).toBeLessThanOrEqual(1);
          expect(c.style.color).toBe('#1E40AF');
        }
      });
    }
  }

  it('fills pens, strokes the highlighter with multiply, and marks pencil grain', () => {
    const kinds = (stroke: { k: 'pen' | 'hl'; b?: 'pencil' | 'ballpoint' }): Recorded['kind'][] => {
      const sink = new RecordingSink();
      new StrokePainter(registry, new PencilGrain()).emit(sink, {
        ...stroke,
        c: '#000000',
        s: 2,
        p: points(5),
      });
      return sink.commands.map((c) => c.kind);
    };
    expect(kinds({ k: 'pen', b: 'ballpoint' })).toEqual(['fill']);
    expect(kinds({ k: 'hl' })).toEqual(['stroke']);
    const sink = new RecordingSink();
    new StrokePainter(registry, new PencilGrain()).emit(sink, {
      k: 'pen',
      b: 'pencil',
      c: '#4B5563',
      s: 2,
      p: points(5),
    });
    const first = sink.commands[0];
    expect(first?.kind === 'fill' && first.style.texture).toBe('pencil');
    const hl = new RecordingSink();
    new StrokePainter(registry, new PencilGrain()).emit(hl, { k: 'hl', c: '#FDE047', s: 18, p: points(5) });
    expect(hl.commands[0]).toMatchObject({
      style: { blend: 'multiply', width: 18, cap: 'round', alpha: 0.55 },
    });
  });
});

describe('a page as drawing commands', () => {
  it('emits paper, pattern, images, strokes and text in screen order', () => {
    const { painter } = painterParts();
    const p = page({ bg: 'grid', images: [{ id: 'im1', x: 5, y: 6, w: 70, h: 40, blob: 'b1' }] });
    const sink = new RecordingSink();
    painter.emit(sink, p, { scale: 2 });
    const kinds = sink.commands.map((c) => c.kind);
    expect(sink.commands[0]).toMatchObject({
      kind: 'rect',
      x: 0,
      y: 0,
      w: 210 * MM,
      h: 297 * MM,
      color: '#FFFFFF',
    });
    expect(kinds.indexOf('image')).toBeGreaterThan(kinds.lastIndexOf('rect'));
    expect(kinds.indexOf('fill')).toBeGreaterThan(kinds.indexOf('image'));
    expect(kinds.indexOf('text')).toBeGreaterThan(kinds.lastIndexOf('fill'));
    // Grid lines: 0.5 px wide at scale 2.
    expect(sink.commands[1]).toMatchObject({ kind: 'rect', w: 0.5 });
  });

  it('leaves out paper and pattern for a transparent export, but keeps a PDF page background', () => {
    const { painter } = painterParts();
    const sink = new RecordingSink();
    painter.emit(sink, page({ bg: 'grid', strokes: [], texts: [] }), { scale: 4, paper: false });
    expect(sink.commands).toEqual([]);
    painter.emit(sink, page({ bgBlob: 'pdfpage', strokes: [], texts: [] }), { scale: 4, paper: false });
    expect(sink.commands).toEqual([
      { kind: 'image', run: expect.objectContaining({ blob: 'pdfpage', x: 0, y: 0 }) },
    ]);
  });

  it('can draw highlighters before all other ink, keeping their order', () => {
    const s = (id: string, k: 'pen' | 'hl'): Stroke => ({
      id,
      k,
      c: '#000000',
      s: 2,
      p: new Float32Array(points(3)),
    });
    const order = PagePainter.strokeOrder([s('a', 'pen'), s('h1', 'hl'), s('b', 'pen'), s('h2', 'hl')], true);
    expect(order.map((x) => x.id)).toEqual(['h1', 'h2', 'a', 'b']);
    const kept = [s('a', 'pen'), s('h1', 'hl')];
    expect(PagePainter.strokeOrder(kept, false)).toBe(kept);
  });

  it('positions text lines exactly as the screen layout wraps them', () => {
    const { texts } = painterParts();
    const item = { id: 't', x: 30, y: 40, w: 100, t: 'aaaa bbbb cccc\nd', fs: 20, c: '#16181D' };
    const runs = texts.runs(item);
    expect(runs.map((r) => r.text)).toEqual(texts.lines(item));
    const lh = 20 * TEXT_LINE_HEIGHT;
    runs.forEach((r, i) =>
      expect(r).toMatchObject({ x: 30, top: 40 + i * lh + (lh - 20) / 2, size: 20, color: '#16181D' }),
    );
  });
});

describe('CurveMath', () => {
  it('converts a quadratic curve to the same cubic', () => {
    expect(CurveMath.quadToCubic({ x: 0, y: 0 }, 3, 3, 6, 0)).toEqual([2, 2, 4, 2, 6, 0]);
  });

  it('follows the canvas rules for arc sweeps', () => {
    expect(CurveMath.sweep(0, Math.PI * 2, false)).toBeCloseTo(Math.PI * 2);
    expect(CurveMath.sweep(1, 1 - Math.PI, true)).toBeCloseTo(-Math.PI);
    expect(CurveMath.sweep(0, -Math.PI / 2, false)).toBeCloseTo((3 * Math.PI) / 2);
    expect(CurveMath.sweep(1, 1, false)).toBe(0);
  });

  it('traces a circle with four cubics that stay on the circle', () => {
    const arc = CurveMath.arcToCubics(10, 20, 5, 0, Math.PI * 2, false);
    expect(arc.start).toEqual({ x: 15, y: 20 });
    expect(arc.segments).toHaveLength(4);
    for (const [, , , , x, y] of arc.segments) expect(Math.hypot(x - 10, y - 20)).toBeCloseTo(5, 9);
    // Midpoint of the first quarter (t = 0.5) lies on the circle within 0.03 %.
    const [c1x, c1y, c2x, c2y, x, y] = arc.segments[0] ?? [];
    const mx = 0.125 * 15 + 0.375 * (c1x ?? 0) + 0.375 * (c2x ?? 0) + 0.125 * (x ?? 0);
    const my = 0.125 * 20 + 0.375 * (c1y ?? 0) + 0.375 * (c2y ?? 0) + 0.125 * (y ?? 0);
    expect(Math.abs(Math.hypot(mx - 10, my - 20) - 5)).toBeLessThan(5 * 3e-4);
  });

  it('draws round caps counterclockwise from the given angle', () => {
    const arc = CurveMath.arcToCubics(0, 0, 2, Math.PI / 2, -Math.PI / 2, true);
    expect(arc.segments).toHaveLength(2);
    const last = arc.segments[1] ?? [];
    expect(last[4]).toBeCloseTo(0, 9);
    expect(last[5]).toBeCloseTo(-2, 9);
    // Counterclockwise means decreasing angles: from +90° through 0° (x = 2) to -90°.
    expect(arc.segments[0]?.[4]).toBeCloseTo(2, 9);
  });
});

describe('PencilGrain.meanCoverage', () => {
  it('is the average of the grain tile, between its limits', () => {
    const mean = PencilGrain.meanCoverage();
    expect(mean).toBeGreaterThan(0.1);
    expect(mean).toBeLessThan(1);
    expect(PencilGrain.meanCoverage()).toBe(mean);
  });
});
