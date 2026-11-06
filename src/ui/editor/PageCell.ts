import type { Page } from '../../core/types';
import { el, replaceChildren } from '../../core/utils/dom';
import type { PageSizes } from '../../domain/PageSizes';
import type { I18n } from '../../i18n/I18n';
import { icon } from '../icons';

export interface PageCellHandlers {
  /** The thumbnail was tapped. */
  open(page: Page): void;
  /** The "+" before the page was tapped. */
  insertBefore(page: Page): void;
  /** The ⋮ button was tapped, or the thumbnail right-clicked. */
  menu(page: Page, anchor: HTMLElement): void;
}

/** One page in the organizer: thumbnail, "+" before it, number, size, ⋮ and its title, if any. */
export class PageCell {
  readonly node: HTMLDivElement;
  /** Holds the thumbnail canvas. */
  readonly thumb: HTMLButtonElement;
  private readonly insert: HTMLButtonElement;
  private readonly more: HTMLButtonElement;
  private readonly number = el('b', { class: 'page-item__name' });
  private readonly size = el('span', { class: 'page-item__size' });
  private readonly title = el('span', { class: 'page-item__title' });
  private readonly check = el('span', { class: 'page-item__check' }, icon('check', 18));

  constructor(
    readonly page: Page,
    private readonly i18n: I18n,
    private readonly sizes: PageSizes,
    handlers: PageCellHandlers,
  ) {
    this.thumb = el('button', {
      class: 'page-item__thumb',
      attrs: { type: 'button' },
      on: {
        click: () => handlers.open(page),
        contextmenu: (e) => {
          e.preventDefault();
          // A long press by finger or stylus is the drag controller's to handle.
          const type = (e as PointerEvent).pointerType;
          if (type !== 'touch' && type !== 'pen') handlers.menu(page, this.more);
        },
      },
    });
    this.insert = el(
      'button',
      {
        class: 'page-item__insert',
        attrs: { type: 'button' },
        on: { click: () => handlers.insertBefore(page) },
      },
      icon('plus', 16),
    );
    this.more = el(
      'button',
      {
        class: 'icon-btn page-item__more',
        attrs: { type: 'button' },
        on: { click: () => handlers.menu(page, this.more) },
      },
      icon('more', 18),
    );
    this.node = el(
      'div',
      { class: 'page-item' },
      this.insert,
      el('div', { class: 'page-item__frame' }, this.thumb, this.check),
      el('div', { class: 'page-item__info' }, this.number, this.size, this.more),
      this.title,
    );
  }

  /** Updates what depends on the page's position, size and state. */
  update(index: number, state: { active: boolean; selecting: boolean; selected: boolean }): void {
    const t = this.i18n;
    const n = index + 1;
    const { page } = this;
    this.number.textContent = String(n);
    this.title.textContent = page.title ?? '';
    this.title.hidden = !page.title;
    replaceChildren(
      this.size,
      icon(page.locked ? 'lock' : 'unlock', 13),
      el(
        'span',
        { class: 'page-item__size-text' },
        this.sizes.short(page.w, page.h) + (page.bgBlob ? ' · ' + t.t('fromPdf') : ''),
      ),
    );
    this.insert.setAttribute('aria-label', t.t('insertBeforeN', { n }));
    this.more.setAttribute('aria-label', t.t('pageActions', { n }));
    this.thumb.setAttribute('aria-label', t.t(state.selecting ? 'selectPageN' : 'goPage', { n }));
    if (state.selecting) this.thumb.setAttribute('aria-pressed', String(state.selected));
    else this.thumb.removeAttribute('aria-pressed');
    this.setActive(state.active);
    this.node.classList.toggle('page-item--selected', state.selected);
  }

  setActive(active: boolean): void {
    this.node.classList.toggle('page-item--active', active);
  }
}
