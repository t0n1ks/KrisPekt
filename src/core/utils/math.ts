/** Clamps `value` into `[min, max]`. */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** High-resolution timestamp in ms. */
export function now(): number {
  return performance.now();
}

/** Parses a number and clamps it; returns `fallback` for anything non-finite. */
export function toClampedNumber(raw: unknown, min: number, max: number, fallback: number): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(n) ? clamp(n, min, max) : fallback;
}
