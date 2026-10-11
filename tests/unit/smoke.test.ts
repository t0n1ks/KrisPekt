import { describe, expect, it } from 'vitest';

describe('test setup', () => {
  it('provides IndexedDB in the test environment', () => {
    expect(typeof indexedDB.open).toBe('function');
  });
});
