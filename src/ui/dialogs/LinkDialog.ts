import { MAX_URL_LENGTH } from '../../core/constants';
import type { InternalLink, LinkTarget } from '../../core/types';
import { el } from '../../core/utils/dom';
import { FileNames } from '../../domain/FileNames';
import { LinkRules } from '../../domain/LinkRules';
import { SafeUrl } from '../../domain/SafeUrl';
import type { I18n } from '../../i18n/I18n';
import { MAX_LEN } from '../../storage/validation/guards';
import { Segmented } from '../widgets/Segmented';
import { field } from '../widgets/field';
import type { DialogFactory } from './DialogFactory';
import type { Sheet, SheetAction } from './Sheet';
import type { LinkTargetPicker } from './LinkTargetPicker';

export interface LinkDialogOptions {
  /** The link there is now. */
  link?: LinkTarget;
  /** With a title field (a link card, not a word in a text box). */
  title?: string;
  withTitle?: boolean;
  /** Offers to remove a link that exists. */
  canRemove?: boolean;
  /** Also offers places in the notes, in a second tab. */
  notes?: boolean;
  /** Opens on that tab, even for a new link. */
  startInNotes?: boolean;
}

export type LinkChoice =
  | { kind: 'url'; href: string; title: string }
  | { kind: 'internal'; link: InternalLink }
  | { kind: 'remove' };

type LinkTab = 'url' | 'notes';

/** Makes the picker for one dialog. */
export type LinkPickerFactory = (
  onPick: (link: InternalLink) => void,
  current: InternalLink | null,
) => LinkTargetPicker;

/**
 * Asks where a link leads: a web address and, for a card, its title; or a place in the notes. Only
 * an address that may be opened gets out.
 */
export class LinkDialog {
  constructor(
    private readonly i18n: I18n,
    private readonly dialogs: DialogFactory,
    private readonly picker: LinkPickerFactory,
  ) {}

  /** Resolves with the choice, or null if cancelled. */
  ask(options: LinkDialogOptions = {}): Promise<LinkChoice | null> {
    return new Promise((resolve) => {
      let answered = false;
      const answer = (choice: LinkChoice): void => {
        answered = true;
        resolve(choice);
      };
      let sheet: Sheet | null = null;
      const form = this.urlForm(options, answer);
      const current = options.link && LinkRules.isInternal(options.link) ? options.link : null;
      const notes = options.notes
        ? this.picker((link) => {
            answer({ kind: 'internal', link });
            sheet?.close();
          }, current)
        : null;
      const start: LinkTab = notes && (current || options.startInNotes) ? 'notes' : 'url';
      const error = el('p', { class: 'field__error', attrs: { role: 'alert' } }, this.i18n.t('linkPickHint'));
      error.hidden = true;
      let tab = start;
      const show = (next: LinkTab): void => {
        tab = next;
        form.node.hidden = next !== 'url';
        if (notes) notes.node.hidden = next !== 'notes';
        error.hidden = true;
      };
      const save = (): boolean => {
        if (tab === 'url') return form.save();
        // Leaving a link as it is is a fine answer; a new one needs a place.
        error.hidden = current !== null;
        return current !== null;
      };
      const actions: SheetAction[] = [{ label: this.i18n.t('save'), primary: true, onClick: save }];
      if (options.canRemove) {
        actions.unshift({
          label: this.i18n.t('linkRemove'),
          danger: true,
          onClick: () => answer({ kind: 'remove' }),
        });
      }
      sheet = this.dialogs.sheet({
        title: this.i18n.t('linkDialogTitle'),
        body: el(
          'div',
          { class: 'stack' },
          notes ? this.tabs(start, show).node : null,
          form.node,
          notes?.node,
          notes ? error : null,
        ),
        actions,
        // On a phone the keyboard would hide the list that is the point of the notes tab.
        focus: start === 'url',
        onClose: () => {
          if (!answered) resolve(null);
        },
      });
      show(start);
    });
  }

  private tabs(start: LinkTab, show: (tab: LinkTab) => void): Segmented<LinkTab> {
    return new Segmented<LinkTab>(
      [
        { v: 'url', label: this.i18n.t('linkTabWeb') },
        { v: 'notes', label: this.i18n.t('linkTabNotes') },
      ],
      start,
      show,
    );
  }

  private urlForm(
    options: LinkDialogOptions,
    answer: (choice: LinkChoice) => void,
  ): { node: HTMLElement; save: () => boolean } {
    const { i18n } = this;
    const href = options.link?.kind === 'url' ? options.link.href : '';
    const url = LinkDialog.input('linkUrl', href, i18n.t('linkUrlPh'), MAX_URL_LENGTH);
    url.setAttribute('inputmode', 'url');
    const title = LinkDialog.input('linkName', options.title ?? '', i18n.t('linkTitlePh'), MAX_LEN.name);
    const error = el('p', { class: 'field__error', attrs: { role: 'alert' } });
    error.hidden = true;
    const save = (): boolean => {
      const safe = SafeUrl.fromInput(url.value);
      if (!safe) {
        error.textContent = i18n.t('linkInvalid');
        error.hidden = false;
        return false;
      }
      const name = FileNames.label(title.value, MAX_LEN.name) || SafeUrl.hostname(safe);
      answer({ kind: 'url', href: safe, title: name });
      return true;
    };
    const node = el(
      'div',
      { class: 'stack' },
      field(i18n.t('linkUrlField'), url),
      options.withTitle ? field(i18n.t('linkTitleField'), title) : null,
      error,
    );
    return { node, save };
  }

  private static input(id: string, value: string, placeholder: string, maxlength: number): HTMLInputElement {
    return el('input', {
      class: 'input',
      attrs: { type: 'text', id, value, placeholder, maxlength, autocapitalize: 'off', spellcheck: 'false' },
    });
  }
}
