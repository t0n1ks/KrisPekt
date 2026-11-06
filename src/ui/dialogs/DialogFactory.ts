import type { EventBus } from '../../app/EventBus';
import { el } from '../../core/utils/dom';
import type { I18n } from '../../i18n/I18n';
import { Sheet, type SheetOptions } from './Sheet';

/** Opens sheets and confirmation dialogs; shared by every view. */
export class DialogFactory {
  private readonly open: Sheet[] = [];
  private readonly onKey = (e: KeyboardEvent): void => {
    const top = this.open.at(-1);
    if (e.key !== 'Escape' || !top) return;
    // One Escape closes one thing: the page behind the sheet must not react as well.
    e.stopPropagation();
    if (!top.locked) top.close();
  };

  constructor(
    private readonly i18n: I18n,
    private readonly bus: EventBus,
  ) {}

  /** Whether any sheet is open (the automatic backup waits until none is). */
  get hasOpenSheet(): boolean {
    return this.open.length > 0;
  }

  /** Opens a sheet. */
  sheet(options: SheetOptions): Sheet {
    if (!this.open.length) document.addEventListener('keydown', this.onKey);
    const sheet: Sheet = new Sheet(this.i18n, this.bus, {
      ...options,
      onClose: () => {
        this.open.splice(this.open.indexOf(sheet), 1);
        if (!this.open.length) document.removeEventListener('keydown', this.onKey);
        options.onClose?.();
      },
    });
    this.open.push(sheet);
    return sheet.open();
  }

  /**
   * Asks a yes/no question. Resolves true only when the confirm button is pressed;
   * cancelling, the × button and tapping outside all resolve false.
   */
  confirm(title: string, text: string, okLabel = this.i18n.t('delete'), danger = true): Promise<boolean> {
    return new Promise((resolve) => {
      let answered = false;
      const answer = (value: boolean): void => {
        answered = true;
        resolve(value);
      };
      this.sheet({
        title,
        body: el('p', { class: 'hint hint--large' }, text),
        actions: [
          { label: this.i18n.t('cancel'), onClick: () => answer(false) },
          { label: okLabel, primary: !danger, danger, onClick: () => answer(true) },
        ],
        onClose: () => {
          if (!answered) resolve(false);
        },
      });
    });
  }
}
