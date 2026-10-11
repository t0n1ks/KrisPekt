import { describe, expect, it } from 'vitest';
import { BallpointBrush } from '../../src/canvas/brushes/BallpointBrush';
import { BrushRegistry } from '../../src/canvas/brushes/BrushRegistry';
import type { BrushRenderer } from '../../src/canvas/brushes/BrushRenderer';
import { FountainBrush } from '../../src/canvas/brushes/FountainBrush';
import { HighlighterBrush } from '../../src/canvas/brushes/HighlighterBrush';
import { PaintBrush } from '../../src/canvas/brushes/PaintBrush';
import type { PathSink } from '../../src/canvas/brushes/PathSink';
import { PencilBrush } from '../../src/canvas/brushes/PencilBrush';
import { PencilGrain } from '../../src/canvas/brushes/PencilGrain';
import { StrokeGeometry } from '../../src/canvas/StrokeGeometry';
import { BRUSH_KINDS } from '../../src/core/constants';
import type { BrushKind, Stroke } from '../../src/core/types';
import { parseStroke } from '../../src/storage/validation/records';

/** Records path commands so the geometry can be checked without a canvas. */
class Recorder implements PathSink {
  readonly commands: { op: string; args: number[] }[] = [];
  moveTo(x: number, y: number): void {
    this.commands.push({ op: 'moveTo', args: [x, y] });
  }
  lineTo(x: number, y: number): void {
    this.commands.push({ op: 'lineTo', args: [x, y] });
  }
  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void {
    this.commands.push({ op: 'quad', args: [cpx, cpy, x, y] });
  }
  arc(x: number, y: number, r: number, a0: number, a1: number): void {
    this.commands.push({ op: 'arc', args: [x, y, r, a0, a1] });
  }
  closePath(): void {
    this.commands.push({ op: 'close', args: [] });
  }
}

const registry = new BrushRegistry();
const renderers: [string, BrushRenderer][] = [
  ...BRUSH_KINDS.map((b): [string, BrushRenderer] => [b, registry.pen(b)]),
  ['highlighter', registry.forStroke({ k: 'hl' })],
];

function shapeOf(renderer: BrushRenderer, points: number[], size = 3): Recorder[] {
  return renderer
    .shape(points, size, () => new Recorder())
    .map((part) => {
      expect(part.alpha).toBeGreaterThan(0);
      expect(part.alpha).toBeLessThanOrEqual(1);
      return part.path;
    });
}

function expectValid(paths: Recorder[]): void {
  expect(paths.length).toBeGreaterThan(0);
  for (const path of paths) {
    expect(path.commands.length).toBeGreaterThan(0);
    for (const { op, args } of path.commands) {
      for (const v of args) expect(Number.isFinite(v), op).toBe(true);
      if (op === 'arc') expect(args[2]).toBeGreaterThanOrEqual(0);
    }
  }
}

/** A wavy stroke with changing pressure. */
function wave(n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(i * 3, Math.sin(i / 4) * 20, 0.2 + 0.6 * Math.abs(Math.sin(i / 7)));
  return out;
}

describe.each(renderers)('%s renderer', (_name, renderer) => {
  it('builds a path for a single point', () => expectValid(shapeOf(renderer, [10, 10, 0.5])));

  it('builds a path for two points', () => expectValid(shapeOf(renderer, [0, 0, 0.3, 40, 10, 0.8])));

  it('builds a path for many points', () => expectValid(shapeOf(renderer, wave(200))));

  it('handles zero-length segments without NaN', () => {
    expectValid(shapeOf(renderer, [5, 5, 0.5, 5, 5, 0.5, 5, 5, 0.6, 9, 5, 0.5, 9, 5, 0.5]));
    expectValid(shapeOf(renderer, [5, 5, 0, 5, 5, 0]));
  });

  it('handles extreme pressure and tiny sizes', () => {
    expectValid(shapeOf(renderer, [0, 0, 0, 10, 0, 1, 20, 0, 0], 0.01));
  });

  it('reports a positive ink reach', () => {
    expect(renderer.maxHalfWidth(2)).toBeGreaterThan(0);
    expect(renderer.eraseMargin(2, 0.5)).toBeGreaterThan(0);
  });
});

describe('BrushRegistry', () => {
  it('draws strokes without a brush id as ballpoint (older notebooks and backups)', () => {
    const old = parseStroke({ id: 'a1', k: 'pen', c: '#000000', s: 2, p: [0, 0, 0.5, 5, 5, 0.5] });
    expect(old.b).toBeUndefined();
    expect(registry.forStroke(old)).toBeInstanceOf(BallpointBrush);
  });

  it('picks the brush named by the stroke, and the highlighter for hl strokes', () => {
    expect(registry.forStroke({ k: 'pen', b: 'fountain' })).toBeInstanceOf(FountainBrush);
    expect(registry.forStroke({ k: 'pen', b: 'pencil' })).toBeInstanceOf(PencilBrush);
    expect(registry.forStroke({ k: 'pen', b: 'brush' })).toBeInstanceOf(PaintBrush);
    expect(registry.forStroke({ k: 'hl' })).toBeInstanceOf(HighlighterBrush);
  });

  it('keeps the ballpoint width formula unchanged', () => {
    expect(BallpointBrush.width(2, 0)).toBeCloseTo(0.84);
    expect(BallpointBrush.width(2, 1)).toBeCloseTo(2.4);
  });
});

describe('brush behaviour', () => {
  it('fountain pen: hairline along the 40° nib, broad across it', () => {
    const along = FountainBrush.directionalHalfWidth(2, 0.5, (-40 * Math.PI) / 180);
    const across = FountainBrush.directionalHalfWidth(2, 0.5, (50 * Math.PI) / 180);
    expect(across).toBeGreaterThan(along * 5);
    expect(along).toBeGreaterThan(0);
  });

  it('brush: very thin at light pressure, very thick at full pressure', () => {
    const brush = new PaintBrush();
    expect(brush.halfWidth(4, 1) / brush.halfWidth(4, 0.1)).toBeGreaterThan(8);
  });

  it('fineliner ignores pressure', () => {
    const liner = registry.pen('fineliner');
    expect(liner.halfWidth(2, 0)).toBe(liner.halfWidth(2, 1));
  });

  it('pencil: pressure changes opacity more than width', () => {
    const pencil = registry.pen('pencil');
    const alphaGain = PencilBrush.alpha(1) / PencilBrush.alpha(0);
    const widthGain = pencil.halfWidth(2, 1) / pencil.halfWidth(2, 0);
    expect(alphaGain).toBeGreaterThan(widthGain);
  });

  it('pencil bands cover every segment exactly once', () => {
    const points = wave(60);
    const bands = PencilBrush.bands(points, 60);
    expect(bands[0]?.from).toBe(0);
    expect(bands[bands.length - 1]?.to).toBe(59);
    for (let i = 1; i < bands.length; i++) expect(bands[i]?.from).toBe(bands[i - 1]?.to);
  });

  it('pencil grain is deterministic and within range', () => {
    const a = PencilGrain.coverage(16);
    const b = PencilGrain.coverage(16);
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(Array.from(a).every((v) => v >= 0.1 && v <= 1)).toBe(true);
    expect(new Set(a).size).toBeGreaterThan(10);
  });

  it('a stroke builds the same shape every time (reload, thumbnails, PDF)', () => {
    for (const kind of BRUSH_KINDS) {
      const first = shapeOf(registry.pen(kind), wave(40)).map((p) => p.commands);
      const second = shapeOf(registry.pen(kind), wave(40)).map((p) => p.commands);
      expect(second).toEqual(first);
    }
  });
});

describe('erasing brush strokes', () => {
  let n = 0;
  const makeId = (): string => 'e' + ++n;

  function line(b: BrushKind, pressure: number, size: number): Stroke {
    const p: number[] = [];
    for (let x = 0; x <= 100; x += 2) p.push(x, 0, pressure);
    return { id: 'st', k: 'pen', b, c: '#123456', s: size, p: new Float32Array(p) };
  }

  const margin =
    (st: Stroke) =>
    (pressure: number): number =>
      registry.forStroke(st).eraseMargin(st.s, pressure);

  it.each<BrushKind>(['fountain', 'brush'])('pixel eraser splits a %s stroke and keeps its brush', (b) => {
    const st = line(b, 0.6, 4);
    const parts = StrokeGeometry.split(st, 50, 0, 6, makeId, margin(st));
    expect(parts).toHaveLength(2);
    for (const part of parts ?? []) {
      expect(part.b).toBe(b);
      expect(part.c).toBe('#123456');
      expect(part.s).toBe(4);
      expect(Array.from(part.p).every(Number.isFinite)).toBe(true);
    }
  });

  it('uses the per-point width: a pressed brush is erased from further away than a light one', () => {
    const heavy = line('brush', 1, 10);
    const light = line('brush', 0.1, 10);
    expect(StrokeGeometry.split(heavy, 50, 7, 4, makeId, margin(heavy))).not.toBeNull();
    expect(StrokeGeometry.split(light, 50, 7, 4, makeId, margin(light))).toBeNull();
  });

  it('stroke eraser reaches the full ink width of wide brushes', () => {
    const st = line('brush', 1, 10);
    const reach = registry.forStroke(st).maxHalfWidth(st.s);
    expect(StrokeGeometry.hit(st, 50, 7.5, 2, reach)).toBe(true);
    expect(StrokeGeometry.hit(st, 50, 7.5, 2)).toBe(false);
  });

  it('bounding boxes include the brush width', () => {
    const geometry = new StrokeGeometry((st) => registry.forStroke(st).maxHalfWidth(st.s));
    const box = geometry.bbox(line('brush', 1, 10));
    expect(box.y1).toBeGreaterThanOrEqual(registry.pen('brush').maxHalfWidth(10));
  });
});
