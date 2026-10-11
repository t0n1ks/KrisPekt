import type { Language, Notebook } from '../core/types';

/** Cross-cutting events and their payloads. */
export interface AppEvents {
  'language-changed': Language;
  'page-changed': { index: number; count: number };
  'notebook-saved': Notebook;
}

type Handler<T> = (payload: T) => void;

/** A small typed publish/subscribe bus for events that several components care about. */
export class EventBus<Events extends object = AppEvents> {
  private readonly handlers = new Map<keyof Events, Set<Handler<never>>>();

  /** Subscribes to an event. Returns a function that unsubscribes. */
  on<K extends keyof Events>(type: K, handler: Handler<Events[K]>): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler as Handler<never>);
    return () => set.delete(handler as Handler<never>);
  }

  /** Notifies every subscriber of `type`. */
  emit<K extends keyof Events>(type: K, payload: Events[K]): void {
    const set = this.handlers.get(type);
    if (!set) return;
    for (const handler of [...set]) (handler as Handler<Events[K]>)(payload);
  }
}
