import type { StoreName } from './Database';

/** Called once per stored record that failed validation and was skipped. */
export type CorruptRecordHandler = (store: StoreName, error: unknown) => void;

/**
 * Validates records read from storage. A record that fails is skipped and reported,
 * so one damaged entry never breaks the whole shelf.
 */
export class RecordReader {
  constructor(private readonly onCorrupt: CorruptRecordHandler) {}

  /** Parses every value, dropping (and reporting) the ones that do not validate. */
  readAll<T>(store: StoreName, values: readonly unknown[], parse: (raw: unknown) => T): T[] {
    const out: T[] = [];
    for (const value of values) {
      const parsed = this.readOne(store, value, parse);
      if (parsed) out.push(parsed);
    }
    return out;
  }

  /** Parses one value; returns null (and reports) if it is invalid, or null if it is absent. */
  readOne<T>(store: StoreName, value: unknown, parse: (raw: unknown) => T): T | null {
    if (value === undefined) return null;
    try {
      return parse(value);
    } catch (error) {
      this.onCorrupt(store, error);
      return null;
    }
  }
}
