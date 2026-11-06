import { MAX_ANCHOR_NAME } from '../../core/constants';
import { el } from '../../core/utils/dom';
import { FileNames } from '../../domain/FileNames';
import type { I18n } from '../../i18n/I18n';
import { field } from '../widgets/field';
import type { DialogFactory } from './DialogFactory';

/** Asks for a bookmark's name. It is required; a name of nothing but spaces does not count. */
export class AnchorDialog {
  constructor(
    private readonly i18n: I18n,
    private readonly dialogs: DialogFactory,
  ) {}

  /** Resolves with the cleaned name, or null if cancelled. */
  ask(title: string, name: string): Promise<string | null> {
    const { i18n } = this;
    return new Promise((resolve) => {
      let answer: string | null = null;
      const input = el('input', {
        class: 'input',
        attrs: { type: 'text', id: 'anchorName', value: name, maxlength: MAX_ANCHOR_NAME },
      });
      const error = el(
        'p',
        { class: 'field__error', attrs: { role: 'alert' } },
        i18n.t('bookmarkNameMissing'),
      );
      error.hidden = true;
      this.dialogs.sheet({
        title,
        body: el('div', { class: 'stack' }, field(i18n.t('bookmarkNameField'), input), error),
        actions: [
          {
            label: i18n.t('save'),
            primary: true,
            onClick: () => {
              answer = FileNames.label(input.value, MAX_ANCHOR_NAME);
              error.hidden = answer !== '';
              return answer !== '';
            },
          },
        ],
        focus: true,
        onClose: () => resolve(answer || null),
      });
    });
  }
}
