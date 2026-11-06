import { MAX_URL_LENGTH } from '../../core/constants';
import { el } from '../../core/utils/dom';
import { FileNames } from '../../domain/FileNames';
import { SafeUrl } from '../../domain/SafeUrl';
import type { I18n } from '../../i18n/I18n';
import { MAX_LEN } from '../../storage/validation/guards';
import { field } from '../widgets/field';
import type { DialogFactory } from './DialogFactory';
import type { SheetAction } from './Sheet';

export interface LinkDialogOptions {
  href?: string;
  /** With a title field (a link card, not a word in a text box). */
  title?: string;
  withTitle?: boolean;
  /** Offers to remove a link that exists. */
  canRemove?: boolean;
}

export type LinkChoice = { kind: 'url'; href: string; title: string } | { kind: 'remove' };

/** Asks for a web address and, for a card, its title. Only an address that may be opened gets out. */
export class LinkDialog {
  constructor(
    private readonly i18n: I18n,
    private readonly dialogs: DialogFactory,
  ) {}

  /** Resolves with the choice, or null if cancelled. */
  ask(options: LinkDialogOptions = {}): Promise<LinkChoice | null> {
    return new Promise((resolve) => {
      let answered = false;
      const answer = (choice: LinkChoice): void => {
        answered = true;
        resolve(choice);
      };
      const { i18n } = this;
      const url = LinkDialog.input('linkUrl', options.href ?? '', i18n.t('linkUrlPh'), MAX_URL_LENGTH);
      url.setAttribute('inputmode', 'url');
      const title = LinkDialog.input('linkName', options.title ?? '', i18n.t('linkTitlePh'), MAX_LEN.name);
      const error = el('p', { class: 'field__error', attrs: { role: 'alert' } });
      error.hidden = true;
      const save = (): boolean => {
        const href = SafeUrl.fromInput(url.value);
        if (!href) {
          error.textContent = i18n.t('linkInvalid');
          error.hidden = false;
          return false;
        }
        const name = FileNames.label(title.value, MAX_LEN.name) || SafeUrl.hostname(href);
        answer({ kind: 'url', href, title: name });
        return true;
      };
      const actions: SheetAction[] = [{ label: i18n.t('save'), primary: true, onClick: save }];
      if (options.canRemove) {
        actions.unshift({
          label: i18n.t('linkRemove'),
          danger: true,
          onClick: () => answer({ kind: 'remove' }),
        });
      }
      this.dialogs.sheet({
        title: i18n.t('linkDialogTitle'),
        body: el(
          'div',
          { class: 'stack' },
          field(i18n.t('linkUrlField'), url),
          options.withTitle ? field(i18n.t('linkTitleField'), title) : null,
          error,
        ),
        actions,
        focus: true,
        onClose: () => {
          if (!answered) resolve(null);
        },
      });
    });
  }

  private static input(id: string, value: string, placeholder: string, maxlength: number): HTMLInputElement {
    return el('input', {
      class: 'input',
      attrs: { type: 'text', id, value, placeholder, maxlength, autocapitalize: 'off', spellcheck: 'false' },
    });
  }
}
