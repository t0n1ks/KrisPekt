import { BACKGROUNDS } from '../../core/constants';
import type { Background } from '../../core/types';
import { ID_PATTERN } from '../../core/utils/id';

/** Thrown when untrusted data does not match the expected shape. */
export class ValidationError extends Error {
  constructor(path: string, problem: string) {
    super(`${path}: ${problem}`);
    this.name = 'ValidationError';
  }
}

export type UnknownRecord = Record<string, unknown>;

export const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

/** Sane ranges for numbers coming from storage or backups. */
export const LIMITS = {
  pageMm: [40, 1200],
  fontSize: [6, 200],
  coord: [-100000, 100000],
  extent: [0, 100000],
  strokeWidth: [0.01, 1000],
  pressure: [0, 1],
  zoom: [0.01, 100],
  timestamp: [0, 8.64e15],
  order: [-1e9, 1e9],
} as const satisfies Record<string, readonly [number, number]>;

export const MAX_LEN = {
  name: 200,
  text: 20000,
  isoDate: 40,
} as const;

/** Max points (x, y, pressure triples) in one stroke. */
export const MAX_STROKE_POINTS = 100000;
/** Max items of each kind on one page, and pages per notebook. */
export const MAX_ITEMS = 100000;

export function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function asRecord(value: unknown, path: string): UnknownRecord {
  if (!isRecord(value)) throw new ValidationError(path, 'expected an object');
  return value;
}

export function asArray(value: unknown, path: string, maxLength = MAX_ITEMS): unknown[] {
  if (!Array.isArray(value)) throw new ValidationError(path, 'expected an array');
  if (value.length > maxLength) throw new ValidationError(path, 'too many items');
  return value;
}

/** An array field that may be missing (treated as empty), but must be an array if present. */
export function optionalArray(value: unknown, path: string): unknown[] {
  return value === undefined ? [] : asArray(value, path);
}

export function asString(value: unknown, path: string, maxLength: number): string {
  if (typeof value !== 'string') throw new ValidationError(path, 'expected a string');
  if (value.length > maxLength) throw new ValidationError(path, 'string too long');
  return value;
}

export function asId(value: unknown, path: string): string {
  const id = asString(value, path, 40);
  if (!ID_PATTERN.test(id)) throw new ValidationError(path, 'invalid id');
  return id;
}

export function asColor(value: unknown, path: string): string {
  const color = asString(value, path, 7);
  if (!COLOR_PATTERN.test(color)) throw new ValidationError(path, 'invalid colour');
  return color;
}

export function asNumber(value: unknown, path: string, range: readonly [number, number]): number {
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new ValidationError(path, 'expected a number');
  if (value < range[0] || value > range[1]) throw new ValidationError(path, 'number out of range');
  return value;
}

export function asBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw new ValidationError(path, 'expected a boolean');
  return value;
}

export function asBackground(value: unknown, path: string): Background {
  if (typeof value !== 'string' || !(BACKGROUNDS as readonly string[]).includes(value)) {
    throw new ValidationError(path, 'unknown background');
  }
  return value as Background;
}

export function asOneOf<T extends string>(value: unknown, options: readonly T[], path: string): T {
  if (typeof value !== 'string' || !(options as readonly string[]).includes(value)) {
    throw new ValidationError(path, 'unexpected value');
  }
  return value as T;
}
