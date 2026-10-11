import { el } from '../../core/utils/dom';

/** A single status message at the top of the screen. */
export class Toast {
  private node: HTMLDivElement | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly host: HTMLElement = document.body) {}

  /** Shows `message` for `ms` milliseconds; `ms <= 0` keeps it until the next message. */
  show(message: string, ms = 2600): void {
    if (!this.node) {
      this.node = el('div', { class: 'toast', attrs: { role: 'status' } });
      this.host.append(this.node);
    }
    const node = this.node;
    node.textContent = message;
    node.hidden = false;
    clearTimeout(this.timer);
    if (ms > 0) {
      this.timer = setTimeout(() => {
        node.hidden = true;
      }, ms);
    }
  }

  hide(): void {
    clearTimeout(this.timer);
    if (this.node) this.node.hidden = true;
  }
}
