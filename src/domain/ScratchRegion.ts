import { SCRATCH_MARGIN_INK, SCRATCH_MARGIN_SIDE } from '../core/constants';
import type { Box } from '../core/types';

interface Edge {
  x: number;
  y: number;
  /** Unit normal pointing out of the hull. */
  nx: number;
  ny: number;
}

/** Samples per side of a glyph's box. */
const BOX_SAMPLES = 3;

/**
 * The area a scribble covers: the convex hull of its points, pushed out on every side by a margin
 * of a quarter of its shorter side (at least twice the ink width), and kept within the same
 * margin of its bounding box. The hull rather than the line itself, because the gaps between the
 * legs of a zigzag are crossed out too. Pure.
 */
export class ScratchRegion {
  private constructor(
    private readonly edges: readonly Edge[],
    private readonly margin: number,
    /** The bounding box with the margin. */
    readonly box: Box,
  ) {}

  /** The region of a scribble given as x, y, pressure triples, with its ink width. */
  static around(points: ArrayLike<number>, inkWidth: number): ScratchRegion {
    const hull = ScratchRegion.hull(points);
    const xs = hull.map((p) => p.x);
    const ys = hull.map((p) => p.y);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const shorter = Math.min(x1 - x0, y1 - y0);
    const margin = Math.max(inkWidth * SCRATCH_MARGIN_INK, shorter * SCRATCH_MARGIN_SIDE);
    return new ScratchRegion(ScratchRegion.edgesOf(hull), margin, {
      x0: x0 - margin,
      y0: y0 - margin,
      x1: x1 + margin,
      y1: y1 + margin,
    });
  }

  /** Whether a box can have anything in common with the region. */
  overlaps(box: Box): boolean {
    return box.x0 <= this.box.x1 && box.x1 >= this.box.x0 && box.y0 <= this.box.y1 && box.y1 >= this.box.y0;
  }

  /** Whether a point is in the region. */
  contains(x: number, y: number): boolean {
    const { box, margin } = this;
    if (x < box.x0 || x > box.x1 || y < box.y0 || y > box.y1) return false;
    for (const edge of this.edges) {
      if ((x - edge.x) * edge.nx + (y - edge.y) * edge.ny > margin) return false;
    }
    return true;
  }

  /**
   * The share of a stroke's length inside the region. A dot has no length to speak of, so its
   * points count instead. The region is convex: a box with all its corners inside needs no more.
   */
  strokeCoverage(points: ArrayLike<number>, bounds: Box): number {
    if (
      this.contains(bounds.x0, bounds.y0) &&
      this.contains(bounds.x1, bounds.y0) &&
      this.contains(bounds.x0, bounds.y1) &&
      this.contains(bounds.x1, bounds.y1)
    )
      return 1;
    let inside = 0;
    let total = 0;
    let insidePoints = 0;
    const count = Math.floor(points.length / 3);
    for (let i = 0; i < count; i++) {
      const x = points[i * 3] ?? 0;
      const y = points[i * 3 + 1] ?? 0;
      if (this.contains(x, y)) insidePoints++;
      if (!i) continue;
      const px = points[i * 3 - 3] ?? 0;
      const py = points[i * 3 - 2] ?? 0;
      const length = Math.hypot(x - px, y - py);
      total += length;
      if (this.contains((x + px) / 2, (y + py) / 2)) inside += length;
    }
    if (total > 0) return inside / total;
    return count ? insidePoints / count : 0;
  }

  /** The share of a box inside the region, from a grid of samples. */
  boxCoverage(box: Box): number {
    let inside = 0;
    for (let i = 0; i < BOX_SAMPLES; i++) {
      for (let j = 0; j < BOX_SAMPLES; j++) {
        const x = box.x0 + ((box.x1 - box.x0) * (i + 0.5)) / BOX_SAMPLES;
        const y = box.y0 + ((box.y1 - box.y0) * (j + 0.5)) / BOX_SAMPLES;
        if (this.contains(x, y)) inside++;
      }
    }
    return inside / (BOX_SAMPLES * BOX_SAMPLES);
  }

  /** Andrew's monotone chain; clockwise on screen, where y grows downwards. */
  private static hull(points: ArrayLike<number>): { x: number; y: number }[] {
    const all: { x: number; y: number }[] = [];
    for (let i = 0; i + 2 < points.length; i += 3) all.push({ x: points[i] ?? 0, y: points[i + 1] ?? 0 });
    all.sort((a, b) => a.x - b.x || a.y - b.y);
    const half = (list: readonly { x: number; y: number }[]): { x: number; y: number }[] => {
      const chain: { x: number; y: number }[] = [];
      for (const p of list) {
        while (chain.length >= 2) {
          const a = chain[chain.length - 2];
          const b = chain[chain.length - 1];
          if (!a || !b || (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) > 0) break;
          chain.pop();
        }
        chain.push(p);
      }
      chain.pop();
      return chain;
    };
    return [...half(all), ...half([...all].reverse())];
  }

  private static edgesOf(hull: readonly { x: number; y: number }[]): Edge[] {
    const edges: Edge[] = [];
    hull.forEach((a, i) => {
      const b = hull[(i + 1) % hull.length];
      if (!b) return;
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      // The chain turns one way only, so outside is always on the same side of an edge.
      if (length) edges.push({ x: a.x, y: a.y, nx: (b.y - a.y) / length, ny: (a.x - b.x) / length });
    });
    return edges;
  }
}
