/** The part of the browser's history this needs. */
export interface BackHistory {
  pushState(data: unknown, unused: string): void;
  back(): void;
}

export interface SystemBackGuardDeps {
  history: BackHistory;
  /** Where `popstate` arrives. */
  events: Pick<EventTarget, 'addEventListener'>;
  /** Whether there is a step to go back to. */
  hasSteps: () => boolean;
  /** Goes one step back; calls {@link SystemBackGuard.sync} when done. */
  goBack: () => void;
  /** A dialog is up, and the page behind it must not move. */
  blocked: () => boolean;
}

/**
 * Lets Android's back button walk back through followed links before it leaves the app. While there
 * are steps, one extra browser history entry is kept for the button to use up. The address is never
 * changed or read, so nothing about the notes reaches the URL.
 */
export class SystemBackGuard {
  private armed = false;
  private ignoreNextPop = false;

  constructor(private readonly deps: SystemBackGuardDeps) {
    deps.events.addEventListener('popstate', () => this.popped());
  }

  /** Brings the extra entry in line with the steps; call when they change. */
  sync(): void {
    const wanted = this.deps.hasSteps();
    if (wanted && !this.armed) {
      this.deps.history.pushState({ krispektBack: true }, '');
      this.armed = true;
    } else if (!wanted && this.armed) {
      this.armed = false;
      this.ignoreNextPop = true;
      this.deps.history.back();
    }
  }

  private popped(): void {
    if (this.ignoreNextPop) {
      this.ignoreNextPop = false;
      return;
    }
    if (!this.armed) return;
    this.armed = false;
    if (this.deps.blocked()) this.sync();
    else this.deps.goBack();
  }
}
