const LOCK_NAME = 'krispekt-open-tab';

/** The part of the Web Locks API this class uses. */
type Locks = Pick<LockManager, 'request' | 'query'>;

/**
 * Knows whether the app is also open in another tab. Every tab holds a shared lock for as long as
 * it lives. Cleaning up stored images needs this: another tab may be using an image that it has
 * not saved a reference to yet.
 */
export class TabPresence {
  constructor(private readonly locks: Locks | null = globalThis.navigator?.locks ?? null) {
    void this.locks
      ?.request(LOCK_NAME, { mode: 'shared' }, () => new Promise(() => undefined))
      ?.catch(() => undefined);
  }

  /** Whether another tab is open. When it cannot tell, it says yes, the cautious answer. */
  async othersOpen(): Promise<boolean> {
    if (!this.locks) return false;
    try {
      const { held = [] } = await this.locks.query();
      return new Set(held.filter((lock) => lock.name === LOCK_NAME).map((lock) => lock.clientId)).size > 1;
    } catch {
      return true;
    }
  }
}
