import { el, replaceChildren } from '../../core/utils/dom';

/** A message with one action at the bottom of the screen, which goes away by itself. */
export class Snackbar {
  private node: HTMLDivElement | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly host: HTMLElement = document.body) {}

  /** Shows a prompt, replacing any other. `onExpire` runs only if the time ran out. */
  show(prompt: {
    message: string;
    action: string;
    ms: number;
    onAction: () => void;
    onExpire: () => void;
  }): void {
    this.node ??= this.host.appendChild(el('div', { class: 'snackbar', attrs: { role: 'status' } }));
    const button = el(
      'button',
      {
        class: 'snackbar__action',
        attrs: { type: 'button' },
        on: {
          click: () => {
            this.hide();
            prompt.onAction();
          },
        },
      },
      prompt.action,
    );
    replaceChildren(this.node, el('span', null, prompt.message), button);
    this.node.hidden = false;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.hide();
      prompt.onExpire();
    }, prompt.ms);
  }

  hide(): void {
    clearTimeout(this.timer);
    if (this.node) this.node.hidden = true;
  }

  /** Removes the node. */
  destroy(): void {
    this.hide();
    this.node?.remove();
    this.node = null;
  }
}
