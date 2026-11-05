interface Entry<T> {
  bitmap: T;
  revision: number;
}

/**
 * Painted thumbnails by page id, least recently used first. An entry remembers the page revision
 * it shows, so a thumbnail of older content is never taken for up to date. Thumbnails on screen
 * are never evicted; the rest go once there are more than `limit`, which keeps memory bounded
 * however long the notebook is.
 */
export class ThumbnailCache<T> {
  private readonly entries = new Map<string, Entry<T>>();

  constructor(private readonly limit: number) {}

  /** The bitmap for a page whatever it shows, or null. */
  bitmap(id: string): T | null {
    return this.entries.get(id)?.bitmap ?? null;
  }

  /** Whether the page has a thumbnail showing exactly this revision. */
  isFresh(id: string, revision: number): boolean {
    return this.entries.get(id)?.revision === revision;
  }

  /** Stores a thumbnail, then evicts the oldest ones that are not on screen. */
  put(id: string, bitmap: T, revision: number, onScreen: ReadonlySet<string>): void {
    this.entries.delete(id);
    this.entries.set(id, { bitmap, revision });
    for (const key of [...this.entries.keys()]) {
      if (this.entries.size <= this.limit) return;
      if (!onScreen.has(key)) this.entries.delete(key);
    }
  }

  get size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }
}
