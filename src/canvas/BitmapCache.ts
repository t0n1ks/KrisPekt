import { BITMAP_LRU_SIZE } from '../core/constants';
import type { Page } from '../core/types';
import type { BlobRepository } from '../storage/BlobRepository';

/** `false` marks a blob that is missing or could not be decoded, so it is not retried every frame. */
type Entry = ImageBitmap | false;

/**
 * Decoded images and PDF page backgrounds, in an LRU of 8 entries. Rendering asks with
 * {@link get}, which never waits: on a miss it starts loading and calls `onLoaded` when the
 * bitmap is ready, so the pages using it can be redrawn.
 */
export class BitmapCache {
  private readonly entries = new Map<string, Entry>();
  private readonly loading = new Map<string, Promise<Entry>>();
  private onLoaded: (id: string) => void = () => undefined;

  constructor(
    private readonly blobs: BlobRepository,
    private readonly decode: (blob: Blob) => Promise<ImageBitmap> = (b) => createImageBitmap(b),
    private readonly limit = BITMAP_LRU_SIZE,
  ) {}

  /** Sets the callback for bitmaps that finished loading after a {@link get} miss. */
  setLoadedHandler(handler: (id: string) => void): void {
    this.onLoaded = handler;
  }

  /** A decoded bitmap if available now; otherwise starts loading and returns null. */
  get(id: string): ImageBitmap | null {
    const entry = this.entries.get(id);
    if (entry !== undefined) {
      this.remember(id, entry);
      return entry || null;
    }
    if (!this.loading.has(id)) void this.load(id).then(() => this.onLoaded(id));
    return null;
  }

  /** Loads (or returns the cached) bitmap; resolves to false when it cannot be decoded. */
  load(id: string): Promise<Entry> {
    const entry = this.entries.get(id);
    if (entry !== undefined) {
      this.remember(id, entry);
      return Promise.resolve(entry);
    }
    const pending = this.loading.get(id);
    if (pending) return pending;
    const promise = this.blobs
      .get(id)
      .then((blob): Promise<Entry> | Entry => (blob ? this.decode(blob) : false))
      .catch((): Entry => false)
      .then((bitmap: Entry) => {
        this.loading.delete(id);
        this.remember(id, bitmap);
        return bitmap;
      });
    this.loading.set(id, promise);
    return promise;
  }

  /** Stores a bitmap the caller already decoded (e.g. a just-inserted photo). */
  put(id: string, bitmap: ImageBitmap): void {
    this.remember(id, bitmap);
  }

  /** Loads every bitmap a page needs and returns them by id (used for PDF export). */
  async loadForPage(page: Page): Promise<Map<string, ImageBitmap | null>> {
    const ids = [...(page.bgBlob ? [page.bgBlob] : []), ...page.images.map((im) => im.blob)];
    const out = new Map<string, ImageBitmap | null>();
    for (const id of ids) out.set(id, (await this.load(id)) || null);
    return out;
  }

  private remember(id: string, entry: Entry): void {
    this.entries.delete(id);
    this.entries.set(id, entry);
    while (this.entries.size > this.limit) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }
}
