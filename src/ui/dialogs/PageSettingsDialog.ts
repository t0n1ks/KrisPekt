import type { Page } from '../../core/types';
import { el, replaceChildren } from '../../core/utils/dom';
import type { EditorSession } from '../../editor/EditorSession';
import type { PageOperations } from '../../editor/PageOperations';
import { PageSizePolicy } from '../../domain/PageSizePolicy';
import type { PageSizes } from '../../domain/PageSizes';
import type { I18n } from '../../i18n/I18n';
import { icon } from '../icons';
import { BackgroundPicker } from '../widgets/BackgroundPicker';
import { field } from '../widgets/field';
import { SizePicker } from '../widgets/SizePicker';
import type { DialogFactory } from './DialogFactory';

export interface PageSettingsDeps {
  i18n: I18n;
  sizes: PageSizes;
  dialogs: DialogFactory;
  session: EditorSession;
  pages: PageOperations;
}

/** Lock, size and background of one page, plus a preview of what the next new page will be. */
export class PageSettingsDialog {
  constructor(private readonly deps: PageSettingsDeps) {}

  open(page: Page): void {
    const { i18n, sizes, session, pages } = this.deps;
    const lockButton = el('button', { class: 'lock-row', attrs: { type: 'button' } });
    const next = el('div', { class: 'next-page' });
    const size = new SizePicker(i18n, sizes, page.w, page.h, (w, h) => {
      pages.resize(page, w, h);
      refresh();
    });
    const refresh = (): void => {
      this.renderLock(lockButton, page);
      size.set(page.w, page.h);
      size.disable(page.locked);
      replaceChildren(
        next,
        el('span', null, icon('plus', 18)),
        el('span', null, i18n.t('nextPage', { x: this.nextPageText(page) })),
      );
    };
    lockButton.addEventListener('click', () => {
      pages.setLocked(page, !page.locked);
      refresh();
    });
    const background = page.bgBlob
      ? el('p', { class: 'hint' }, i18n.t('pdfBg'))
      : new BackgroundPicker(i18n, page.bg, (bg) => pages.setBackground(page, bg)).node;
    refresh();
    this.deps.dialogs.sheet({
      title: i18n.t('pageN', { n: session.indexOf(page) + 1 }),
      body: el(
        'div',
        { class: 'stack' },
        lockButton,
        field(i18n.t('pageSize'), size.node),
        next,
        field(i18n.t('bg'), background),
      ),
      actions: [
        { label: i18n.t('bgAll'), onClick: () => pages.applyBackgroundToAll(page) },
        { label: i18n.t('done'), primary: true },
      ],
    });
  }

  private renderLock(button: HTMLButtonElement, page: Page): void {
    const { i18n, sizes, session } = this.deps;
    const base = session.nb.base;
    button.className = 'lock-row ' + (page.locked ? 'lock-row--locked' : 'lock-row--unlocked');
    button.setAttribute('aria-pressed', page.locked ? 'true' : 'false');
    const sub = page.locked
      ? i18n.t('lockedSub', { size: sizes.label(base.w, base.h) })
      : i18n.t('unlockedSub', { size: sizes.label(page.w, page.h), base: sizes.label(base.w, base.h) });
    replaceChildren(
      button,
      el('span', { class: 'lock-row__icon' }, icon(page.locked ? 'lock' : 'unlock', 24)),
      el(
        'span',
        null,
        el('b', { class: 'lock-row__title' }, page.locked ? i18n.t('lockedTitle') : i18n.t('unlockedTitle')),
        el('small', { class: 'lock-row__sub' }, sub),
      ),
    );
  }

  private nextPageText(page: Page): string {
    const { i18n, sizes, session } = this.deps;
    const n = PageSizePolicy.newPageAfter(session.nb, page, () => 'preview');
    return i18n.t(n.locked ? 'nextLocked' : 'nextUnlocked', { size: sizes.label(n.w, n.h) });
  }
}
