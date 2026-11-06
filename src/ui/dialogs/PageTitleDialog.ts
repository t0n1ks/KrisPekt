import { MAX_PAGE_TITLE } from '../../core/constants';
import { el } from '../../core/utils/dom';
import { FileNames } from '../../domain/FileNames';
import type { I18n } from '../../i18n/I18n';
import { field } from '../widgets/field';
import type { DialogFactory } from './DialogFactory';

/** Asks for a page's title. It is optional: without one the page goes by its number. */
export class PageTitleDialog {
  constructor(
    private readonly i18n: I18n,
    private readonly dialogs: DialogFactory,
  ) {}

  /** Resolves with the cleaned title, empty to have none, or null if cancelled. */
  ask(title: string, pageLabel: string): Promise<string | null> {
    const { i18n } = this;
    return new Promise((resolve) => {
      let answer: string | null = null;
      const input = el('input', {
        class: 'input',
        attrs: {
          type: 'text',
          id: 'pageTitle',
          value: title,
          maxlength: MAX_PAGE_TITLE,
          placeholder: i18n.t('pageTitlePh'),
        },
      });
      this.dialogs.sheet({
        title: i18n.t('pageRename'),
        body: el(
          'div',
          { class: 'stack' },
          field(i18n.t('pageTitleField'), input),
          el('p', { class: 'hint' }, i18n.t('pageTitleHint', { label: pageLabel })),
        ),
        actions: [
          {
            label: i18n.t('save'),
            primary: true,
            onClick: () => {
              answer = FileNames.label(input.value, MAX_PAGE_TITLE);
              return true;
            },
          },
        ],
        focus: true,
        onClose: () => resolve(answer),
      });
    });
  }
}
