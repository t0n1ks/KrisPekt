/**
 * Coordinates are kept to 1/50 world px and pressure to 1/100. At the highest zoom (8×) on a
 * 2× screen one world px is 16 device pixels, so the rounding moves a point by at most 0.16 of a
 * device pixel, and far less at any usual zoom. tests/e2e/backup-v2.spec.ts compares real renders.
 */
export const STROKE_COORD_SCALE = 50;
export const STROKE_PRESSURE_SCALE = 100;

/**
 * The compact form of a stroke's points in `data.json`: whole numbers, each the difference from
 * the point before, with all x first, then all y, then all pressures. Neighbouring points differ by
 * little and stay within the same range, so Deflate shrinks this far better than plain coordinates:
 * about 58 % on handwriting (5.88 MB to 2.44 MB, measured on a generated sample of 80 pages).
 */
export class StrokeCodec {
  /** `[x, y, pressure, …]` to `[dx…, dy…, dp…]`. */
  static encode(points: ArrayLike<number>): number[] {
    const count = Math.floor(points.length / 3);
    const out = new Array<number>(count * 3);
    for (let channel = 0; channel < 3; channel++) {
      const scale = channel === 2 ? STROKE_PRESSURE_SCALE : STROKE_COORD_SCALE;
      let last = 0;
      for (let i = 0; i < count; i++) {
        const value = Math.round((points[i * 3 + channel] ?? 0) * scale);
        out[channel * count + i] = value - last;
        last = value;
      }
    }
    return out;
  }

  /**
   * The points back. Null if this is not a whole number of points in whole numbers; the ranges are
   * checked afterwards, as for any other stroke.
   */
  static decode(deltas: readonly unknown[]): number[] | null {
    if (deltas.length % 3 !== 0) return null;
    const count = deltas.length / 3;
    const out = new Array<number>(deltas.length);
    for (let channel = 0; channel < 3; channel++) {
      const scale = channel === 2 ? STROKE_PRESSURE_SCALE : STROKE_COORD_SCALE;
      let value = 0;
      for (let i = 0; i < count; i++) {
        const delta = deltas[channel * count + i];
        if (typeof delta !== 'number' || !Number.isSafeInteger(delta)) return null;
        value += delta;
        out[i * 3 + channel] = value / scale;
      }
    }
    return out;
  }
}
