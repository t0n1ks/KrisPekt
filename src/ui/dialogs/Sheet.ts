import type { EventBus } from '../../app/EventBus';
import { el } from '../../core/utils/dom';
import type { I18n } from '../../i18n/I18n';
import { icon } from '../icons';

export interface SheetAction {
  label: string;
  primary?: boolean;
  danger?: boolean;
  /** Runs on click; return `false` to keep the sheet open. */
  onClick?: () => unknown;
}

export interface SheetOptions {
  title: string;
  body: Node;
  actions?: readonly SheetAction[];
  /** Focus the first text input after opening. */
  focus?: boolean;
  /** Called once when the sheet closes, however it closes. */
  onClose?: () => void;
}

/**
 * A modal dialog: centred on wide screens, a bottom sheet on phones. Closes on the ×
 * button, a tap on the scrim, or an action (unless it returns false).
 */
export class Sheet {
  private readonly scrim: HTMLDivElement;
  private closed = false;

  constructor(
    i18n: I18n,
    private readonly bus: EventBus,
    private readonly options: SheetOptions,
  ) {
    const box = el(
      'div',
      { class: 'sheet', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': options.title } },
      el(
        'div',
        { class: 'sheet__head' },
        el('h2', { class: 'sheet__title' }, options.title),
        el(
          'button',
          {
            class: 'icon-btn',
            attrs: { type: 'button', 'aria-label': i18n.t('close') },
            on: { click: () => this.close() },
          },
          icon('close'),
        ),
      ),
      el('div', { class: 'sheet__body' }, options.body),
    );
    if (options.actions?.length) box.append(this.footer(options.actions));
    this.scrim = el('div', { class: 'scrim' }, box);
    this.scrim.addEventListener('pointerdown', (e) => {
      if (e.target === this.scrim) this.close();
    });
  }

  /** Shows the sheet. */
  open(): this {
    this.bus.emit('menu-opened', undefined);
    document.body.append(this.scrim);
    if (this.options.focus) {
      setTimeout(() => this.scrim.querySelector<HTMLInputElement>('input[type=text]')?.focus(), 60);
    }
    return this;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.scrim.remove();
    this.options.onClose?.();
  }

  private footer(actions: readonly SheetAction[]): HTMLDivElement {
    const foot = el('div', { class: 'sheet__foot' });
    for (const action of actions) {
      const cls = 'btn' + (action.primary ? ' btn--primary' : '') + (action.danger ? ' btn--danger' : '');
      foot.append(
        el(
          'button',
          {
            class: cls,
            attrs: { type: 'button' },
            on: {
              click: () => {
                void this.run(action);
              },
            },
          },
          action.label,
        ),
      );
    }
    return foot;
  }

  private async run(action: SheetAction): Promise<void> {
    const result = action.onClick ? await action.onClick() : undefined;
    if (result !== false) this.close();
  }
}
