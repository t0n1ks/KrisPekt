import { context2d } from '../../core/utils/dom';

/** Grain tile edge in pixels. */
const TILE = 64;
/** Fixed seed: the grain is identical on every device, after reload and in exported PDFs. */
const SEED = 0x4b72_5074;
/** The tile is drawn at half size, so one grain cell is half a world px (finer than the line). */
const TILE_SCALE = 0.5;
/** Colours whose tiles are kept. */
const MAX_TILES = 24;

/**
 * Paper grain for the pencil: a tileable coverage map generated from a fixed seed, turned into
 * one repeating pattern per ink colour. Because the pattern lives in page coordinates, a pencil
 * stroke has the same texture wherever the page is drawn.
 */
export class PencilGrain {
  private readonly tiles = new Map<string, HTMLCanvasElement>();
  private readonly patterns = new WeakMap<CanvasRenderingContext2D, Map<string, CanvasPattern | null>>();
  private coverageMap: Float32Array | null = null;

  /** Small, fast, deterministic PRNG (mulberry32). */
  static random(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /**
   * Ink coverage per tile pixel in [0.1, 1]: white noise blurred with its wrapped neighbours
   * (so the tile repeats without seams) plus a little fine noise for sparkle.
   */
  static coverage(size = TILE, seed = SEED): Float32Array {
    const rand = PencilGrain.random(seed);
    const raw = Float32Array.from({ length: size * size }, () => rand());
    const out = new Float32Array(size * size);
    const at = (x: number, y: number): number => raw[((y + size) % size) * size + ((x + size) % size)] ?? 0;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let sum = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) sum += at(x + dx, y + dy);
        const blurred = sum / 9;
        const value = 0.72 + (blurred - 0.5) * 3 + (at(x, y) - 0.5) * 0.45;
        out[y * size + x] = Math.min(1, Math.max(0.1, value));
      }
    }
    return out;
  }

  /**
   * Average ink coverage of the grain tile. Vector output has no texture, so it fills pencil
   * strokes with this share of their opacity to keep the same overall tone.
   */
  static meanCoverage(): number {
    const coverage = PencilGrain.coverage();
    return coverage.reduce((sum, v) => sum + v, 0) / coverage.length;
  }

  /** A repeating grain pattern in `color` for this context, or null if patterns are unavailable. */
  patternFor(ctx: CanvasRenderingContext2D, color: string): CanvasPattern | null {
    let perContext = this.patterns.get(ctx);
    if (!perContext) {
      perContext = new Map();
      this.patterns.set(ctx, perContext);
    }
    if (perContext.has(color)) return perContext.get(color) ?? null;
    const pattern = ctx.createPattern(this.tileFor(color), 'repeat');
    pattern?.setTransform(new DOMMatrix().scale(TILE_SCALE));
    perContext.set(color, pattern);
    return pattern;
  }

  private tileFor(color: string): HTMLCanvasElement {
    const cached = this.tiles.get(color);
    if (cached) return cached;
    const canvas = document.createElement('canvas');
    canvas.width = TILE;
    canvas.height = TILE;
    const ctx = context2d(canvas);
    const image = ctx.createImageData(TILE, TILE);
    const coverage = (this.coverageMap ??= PencilGrain.coverage());
    const rgb = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16) || 0);
    for (let i = 0; i < TILE * TILE; i++) {
      image.data[i * 4] = rgb[0] ?? 0;
      image.data[i * 4 + 1] = rgb[1] ?? 0;
      image.data[i * 4 + 2] = rgb[2] ?? 0;
      image.data[i * 4 + 3] = Math.round((coverage[i] ?? 0) * 255);
    }
    ctx.putImageData(image, 0, 0);
    if (this.tiles.size >= MAX_TILES) this.tiles.clear();
    this.tiles.set(color, canvas);
    return canvas;
  }
}
