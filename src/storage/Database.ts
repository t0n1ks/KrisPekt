import { DB_NAME, DB_OPEN_TIMEOUT_MS, DB_VERSION } from '../core/constants';

export type StoreName = 'subjects' | 'notebooks' | 'pages' | 'blobs';

/** Every stored record is keyed by `id`. */
export interface Keyed {
  id: string;
}

/** A group of records written to one store inside a multi-store transaction. */
export interface StoreWrite {
  store: StoreName;
  values: readonly Keyed[];
}

const STORES: readonly StoreName[] = ['subjects', 'notebooks', 'pages', 'blobs'];

/**
 * Thin promise wrapper around IndexedDB (database `konspektnik`, version 1).
 * When IndexedDB is unavailable (private mode, blocked storage) it falls back to in-memory maps,
 * and {@link persistent} is false so the UI can warn that changes will be lost.
 * Values are returned as `unknown`: repositories validate them before use.
 */
export class Database {
  private constructor(
    private readonly idb: IDBDatabase | null,
    private readonly memory: Map<StoreName, Map<string, unknown>>,
  ) {}

  /** Opens the database, or an in-memory fallback if that fails or takes longer than 5 s. */
  static async open(factory: IDBFactory | null = globalThis.indexedDB ?? null): Promise<Database> {
    try {
      if (!factory) throw new Error('IndexedDB unavailable');
      const idb = await Database.openIdb(factory);
      Database.requestPersistence();
      return new Database(idb, new Map());
    } catch {
      return Database.inMemory();
    }
  }

  /** A database that lives only in memory. */
  static inMemory(): Database {
    return new Database(null, new Map(STORES.map((s) => [s, new Map<string, unknown>()])));
  }

  private static openIdb(factory: IDBFactory): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = factory.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => Database.createStores(request.result);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('open failed'));
      request.onblocked = () => reject(new Error('blocked'));
      setTimeout(() => reject(new Error('timeout')), DB_OPEN_TIMEOUT_MS);
    });
  }

  private static createStores(db: IDBDatabase): void {
    if (!db.objectStoreNames.contains('subjects')) db.createObjectStore('subjects', { keyPath: 'id' });
    if (!db.objectStoreNames.contains('notebooks')) db.createObjectStore('notebooks', { keyPath: 'id' });
    if (!db.objectStoreNames.contains('pages')) {
      db.createObjectStore('pages', { keyPath: 'id' }).createIndex('nb', 'nbId');
    }
    if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs', { keyPath: 'id' });
  }

  /** Asks the browser not to evict our data under storage pressure. Best effort. */
  private static requestPersistence(): void {
    try {
      void navigator.storage?.persist?.().catch(() => undefined);
    } catch {
      /* not supported */
    }
  }

  /** True when data survives a reload (real IndexedDB). */
  get persistent(): boolean {
    return this.idb !== null;
  }

  /** All records of a store. */
  getAll(store: StoreName): Promise<unknown[]> {
    if (!this.idb) return Promise.resolve([...this.mem(store).values()]);
    return this.request(store, 'readonly', (s) => s.getAll()) as Promise<unknown[]>;
  }

  /** One record, or undefined. */
  get(store: StoreName, id: string): Promise<unknown> {
    if (!this.idb) return Promise.resolve(this.mem(store).get(id));
    return this.request(store, 'readonly', (s) => s.get(id));
  }

  /** Pages of one notebook, through the `nb` index. */
  pagesOf(notebookId: string): Promise<unknown[]> {
    if (!this.idb) {
      return Promise.resolve(
        [...this.mem('pages').values()].filter((p) => (p as { nbId?: unknown }).nbId === notebookId),
      );
    }
    return this.request('pages', 'readonly', (s) => s.index('nb').getAll(notebookId)) as Promise<unknown[]>;
  }

  /** Inserts or replaces a record. */
  put(store: StoreName, value: Keyed): Promise<void> {
    return this.putMany(store, [value]);
  }

  /** Inserts or replaces several records in one transaction. */
  putMany(store: StoreName, values: readonly Keyed[]): Promise<void> {
    return this.writeAcross([{ store, values }]);
  }

  /** Writes to several stores atomically: either every record is stored or none is. */
  async writeAcross(writes: readonly StoreWrite[]): Promise<void> {
    const active = writes.filter((w) => w.values.length);
    if (!active.length) return;
    if (!this.idb) {
      for (const w of active) for (const v of w.values) this.mem(w.store).set(v.id, v);
      return;
    }
    await this.transaction(
      active.map((w) => w.store),
      (tx) => {
        for (const w of active) {
          const objectStore = tx.objectStore(w.store);
          for (const v of w.values) objectStore.put(v);
        }
      },
    );
  }

  /** Deletes a record. */
  delete(store: StoreName, id: string): Promise<void> {
    return this.deleteMany(store, [id]);
  }

  /** Deletes several records in one transaction. */
  async deleteMany(store: StoreName, ids: readonly string[]): Promise<void> {
    if (!ids.length) return;
    if (!this.idb) {
      for (const id of ids) this.mem(store).delete(id);
      return;
    }
    await this.transaction([store], (tx) => {
      const objectStore = tx.objectStore(store);
      for (const id of ids) objectStore.delete(id);
    });
  }

  private mem(store: StoreName): Map<string, unknown> {
    let map = this.memory.get(store);
    if (!map) {
      map = new Map();
      this.memory.set(store, map);
    }
    return map;
  }

  private request(
    store: StoreName,
    mode: IDBTransactionMode,
    make: (s: IDBObjectStore) => IDBRequest,
  ): Promise<unknown> {
    let result: unknown;
    return this.transaction(
      [store],
      (tx) => {
        const req = make(tx.objectStore(store));
        req.onsuccess = () => {
          result = req.result;
        };
      },
      mode,
    ).then(() => result);
  }

  private transaction(
    stores: StoreName[],
    body: (tx: IDBTransaction) => void,
    mode: IDBTransactionMode = 'readwrite',
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.idb) {
        reject(new Error('no database'));
        return;
      }
      let tx: IDBTransaction | null = null;
      try {
        tx = this.idb.transaction(stores, mode);
        body(tx);
      } catch (error) {
        // Abort so a half-queued batch is never committed.
        try {
          tx?.abort();
        } catch {
          /* already finished */
        }
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('transaction error'));
      tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'));
    });
  }
}
