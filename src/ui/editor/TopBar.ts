import type { Page } from '../../core/types';
import { byId, el, replaceChildren } from '../../core/utils/dom';
import type { PageSizes } from '../../domain/PageSizes';
import type { I18n } from '../../i18n/I18n';
import { icon } from '../icons';

export interface TopBarHandlers {
  back(): void;
  title(): void;
  zoom(): void;
  lock(): void;
  pages(): void;
  undo(): void;
  redo(): void;
  more(anchor: HTMLElement): void;
}

/** The editor's top bar: back, title, zoom, page-size lock, page counter, undo/redo, ⋯. */
export class TopBar {
  private readonly back = byId<HTMLButtonElement>('btnBack');
  private readonly titleButton = byId<HTMLButtonElement>('btnTitle');
  private readonly title = byId('edTitle');
  private readonly subtitle = byId('edSub');
  private readonly zoom = byId<HTMLButtonElement>('btnZoom');
  private readonly lock = byId<HTMLButtonElement>('btnLock');
  private readonly pages = byId<HTMLButtonElement>('btnPages');
  private readonly undoButton = byId<HTMLButtonElement>('btnUndo');
  private readonly redoButton = byId<HTMLButtonElement>('btnRedo');
  private readonly moreButton = byId<HTMLButtonElement>('btnEdMore');
  private lastKey = '';
  private readonly cleanup: (() => void)[] = [];

  constructor(
    private readonly i18n: I18n,
    private readonly sizes: PageSizes,
    handlers: TopBarHandlers,
  ) {
    this.back.append(icon('back'));
    this.undoButton.append(icon('undo'));
    this.redoButton.append(icon('redo'));
    this.moreButton.append(icon('more'));
    const bind = (button: HTMLButtonElement, fn: () => void): void => {
      button.addEventListener('click', fn);
      this.cleanup.push(() => button.removeEventListener('click', fn));
    };
    bind(this.back, handlers.back);
    bind(this.titleButton, handlers.title);
    bind(this.zoom, handlers.zoom);
    bind(this.lock, handlers.lock);
    bind(this.pages, handlers.pages);
    bind(this.undoButton, handlers.undo);
    bind(this.redoButton, handlers.redo);
    bind(this.moreButton, () => handlers.more(this.moreButton));
  }

  get moreAnchor(): HTMLElement {
    return this.moreButton;
  }

  setTitle(title: string, subject: string): void {
    this.title.textContent = title;
    this.subtitle.textContent = subject;
  }

  setUndoState(canUndo: boolean, canRedo: boolean): void {
    this.undoButton.disabled = !canUndo;
    this.redoButton.disabled = !canRedo;
  }

  /** Updates the lock pill, page counter and zoom; skipped when nothing visible changed. */
  update(page: Page, index: number, count: number, zoom: number): void {
    const key = [index, count, page.locked, page.w, page.h, Math.round(zoom * 100)].join('|');
    if (key === this.lastKey) return;
    this.lastKey = key;
    const t = this.i18n;
    replaceChildren(
      this.lock,
      icon(page.locked ? 'lock' : 'unlock', 17),
      el('span', null, this.sizes.short(page.w, page.h)),
    );
    this.lock.classList.toggle('pill--unlocked', !page.locked);
    const state = page.locked ? t.t('stLocked') : t.t('stUnlocked');
    this.lock.setAttribute('aria-label', t.t('lockAria', { size: this.sizes.label(page.w, page.h), state }));
    replaceChildren(this.pages, icon('pages', 17), el('span', null, `${index + 1}/${count}`));
    this.zoom.textContent = Math.round(zoom * 100) + '%';
  }

  /** Forces the next update to redraw (after a language change). */
  invalidate(): void {
    this.lastKey = '';
  }

  applyLanguage(): void {
    const t = this.i18n;
    const labels: [HTMLElement, string][] = [
      [this.back, t.t('toShelf')],
      [this.titleButton, t.t('nbSettings')],
      [this.zoom, t.t('fitWidth')],
      [this.pages, t.t('pages')],
      [this.undoButton, t.t('undo')],
      [this.redoButton, t.t('redo')],
      [this.moreButton, t.t('more')],
    ];
    for (const [node, label] of labels) node.setAttribute('aria-label', label);
    this.invalidate();
  }

  destroy(): void {
    for (const off of this.cleanup.splice(0)) off();
  }
}
