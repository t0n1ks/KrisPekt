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
  /** Only code can close it: for work the user must not walk away from. */
  locked?: boolean;
}

/**
 * A modal dialog: centred on wide screens, a bottom sheet on phones. Closes on the ×
 * button, a tap on the scrim, or an action (unless it returns false).
 */
export class Sheet {
  private readonly scrim: HTMLDivElement;
  private closed = false;
  private readonly fitToView = (): void => this.fit();

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
        options.locked
          ? null
          : el(
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
      if (e.target === this.scrim && !options.locked) this.close();
    });
  }

  /** Shows the sheet. */
  open(): this {
    this.bus.emit('menu-opened', undefined);
    document.body.append(this.scrim);
    this.fit();
    window.visualViewport?.addEventListener('resize', this.fitToView);
    window.visualViewport?.addEventListener('scroll', this.fitToView);
    if (this.options.focus) {
      setTimeout(() => this.scrim.querySelector<HTMLInputElement>('input[type=text]')?.focus(), 60);
    }
    return this;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    window.visualViewport?.removeEventListener('resize', this.fitToView);
    window.visualViewport?.removeEventListener('scroll', this.fitToView);
    this.scrim.remove();
    this.options.onClose?.();
  }

  /** An on-screen keyboard covers the page without resizing it, so the sheet follows what it leaves. */
  private fit(): void {
    const view = window.visualViewport;
    if (!view) return;
    this.scrim.style.setProperty('--view-top', view.offsetTop + 'px');
    this.scrim.style.setProperty('--view-height', view.height + 'px');
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
