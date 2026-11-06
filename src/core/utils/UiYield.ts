/** Long stretches of work give way at least this often. */
const BUDGET_MS = 24;

/**
 * Lets the browser draw and handle taps during a long job on the main thread. It uses a message
 * rather than a timer: a timer in a hidden tab fires only once a second, which would stretch a
 * backup started just before the tablet was put down to hours.
 */
export class UiYield {
  private last = performance.now();
  private readonly channel = new MessageChannel();
  private wake: (() => void) | null = null;

  constructor() {
    this.channel.port1.onmessage = () => {
      this.wake?.();
      this.wake = null;
    };
  }

  /** Gives way if this job has been running for a while. */
  async pause(): Promise<void> {
    if (performance.now() - this.last < BUDGET_MS) return;
    await new Promise<void>((resolve) => {
      this.wake = resolve;
      this.channel.port2.postMessage(0);
    });
    this.last = performance.now();
  }

  /** Releases the channel, which would otherwise keep a test process alive. */
  close(): void {
    this.channel.port1.close();
    this.channel.port2.close();
  }
}
