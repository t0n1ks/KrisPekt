import { el } from '../../core/utils/dom';
import type { I18n } from '../../i18n/I18n';
import type { DialogFactory } from './DialogFactory';

/** Explains where notes are stored, with a warning when storage is not persistent. */
export class StorageInfoDialog {
  constructor(
    private readonly i18n: I18n,
    private readonly dialogs: DialogFactory,
  ) {}

  open(persistent: boolean): void {
    const t = this.i18n;
    this.dialogs.sheet({
      title: t.t('storageTitle'),
      body: el(
        'div',
        { class: 'prose' },
        el('p', null, t.t('st1')),
        el('p', null, t.t('st2')),
        el('p', null, t.t('st3')),
        persistent ? null : el('p', { class: 'prose__warn' }, t.t('stWarn')),
      ),
      actions: [{ label: t.t('gotIt'), primary: true }],
    });
  }
}
