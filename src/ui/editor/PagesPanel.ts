import type { PagePainter } from '../../canvas/PagePainter';
import { MM } from '../../core/constants';
import type { Page } from '../../core/types';
import { byId, context2d, el, replaceChildren } from '../../core/utils/dom';
import type { PageSizes } from '../../domain/PageSizes';
import type { I18n } from '../../i18n/I18n';
import type { Menu } from '../dialogs/Menu';
import { icon } from '../icons';

export interface PagesPanelHandlers {
  goTo(page: Page): void;
  addAfter(page: Page): void;
  addAtEnd(): void;
  settings(page: Page): void;
  duplicate(page: Page): void;
  remove(page: Page): void;
  move(page: Page, dir: -1 | 1): void;
}

/** Thumbnail width in CSS px. */
const THUMB_W = 84;
/** Thumbnails drawn per animation slice, so a long notebook does not block the UI. */
const THUMBS_PER_SLICE = 4;

/** Side panel listing the pages with thumbnails, size/lock info and page actions. */
export class PagesPanel {
  private readonly node = byId('panel');
  private readonly list = byId('plist');
  private readonly title = byId('panelTitle');
  private readonly closeButton = byId<HTMLButtonElement>('panelClose');
  private readonly addButton = byId<HTMLButtonElement>('panelAdd');
  private job = 0;
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly i18n: I18n,
    private readonly sizes: PageSizes,
    private readonly menu: Menu,
    private readonly painter: PagePainter,
    private readonly dpr: () => number,
    private readonly handlers: PagesPanelHandlers,
  ) {
    this.closeButton.append(icon('close'));
    this.closeButton.addEventListener('click', () => this.hide());
    this.addButton.addEventListener('click', () => handlers.addAtEnd());
  }

  get isOpen(): boolean {
    return !this.node.hidden;
  }

  hide(): void {
    this.node.hidden = true;
  }

  /** Opens or closes the panel. Returns whether it is now open. */
  toggle(): boolean {
    this.node.hidden = !this.node.hidden;
    return this.isOpen;
  }

  applyLanguage(): void {
    const t = this.i18n;
    this.node.setAttribute('aria-label', t.t('nbPages'));
    this.closeButton.setAttribute('aria-label', t.t('close'));
    this.title.textContent = t.t('pages');
    replaceChildren(this.addButton, icon('plus', 20), el('span', null, t.t('pageToEnd')));
  }

  /** Re-renders thumbnails a little later (e.g. after an image finished loading). */
  refreshSoon(pages: readonly Page[], current: number): void {
    if (!this.isOpen) return;
    clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => this.render(pages, current), 400);
  }

  /** Rebuilds the list; thumbnails are painted progressively. */
  render(pages: readonly Page[], current: number): void {
    if (!this.isOpen) return;
    const job = ++this.job;
    const todo: [HTMLCanvasElement, Page, number][] = [];
    this.title.textContent = this.i18n.t('pagesCount', { n: pages.length });
    const items = pages.map((page, i) => {
      const scale = THUMB_W / (page.w * MM);
      const th = Math.round(page.h * MM * scale);
      const d = this.dpr();
      const canvas = el('canvas', {
        class: 'page-item__canvas',
        attrs: { width: Math.round(THUMB_W * d), height: Math.round(th * d) },
        style: { width: THUMB_W + 'px', height: th + 'px' },
      });
      todo.push([canvas, page, scale * d]);
      return this.item(page, i, pages.length, i === current, canvas);
    });
    replaceChildren(this.list, ...items);
    this.paintThumbs(job, todo, 0);
    items[current]?.scrollIntoView({ block: 'nearest' });
  }

  private paintThumbs(job: number, todo: [HTMLCanvasElement, Page, number][], from: number): void {
    if (job !== this.job) return;
    const end = Math.min(todo.length, from + THUMBS_PER_SLICE);
    for (let k = from; k < end; k++) {
      const entry = todo[k];
      if (!entry) continue;
      const [canvas, page, scale] = entry;
      const ctx = context2d(canvas);
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      this.painter.paint(ctx, page, scale, null);
    }
    if (end < todo.length) setTimeout(() => this.paintThumbs(job, todo, end), 16);
  }

  /** Highlights the current page without rebuilding. */
  highlight(current: number): void {
    if (!this.isOpen) return;
    [...this.list.children].forEach((n, i) => n.classList.toggle('page-item--active', i === current));
  }

  private item(
    page: Page,
    i: number,
    count: number,
    active: boolean,
    canvas: HTMLCanvasElement,
  ): HTMLElement {
    const t = this.i18n;
    const h = this.handlers;
    const more = el(
      'button',
      {
        class: 'icon-btn page-item__action',
        attrs: { type: 'button', 'aria-label': t.t('pageActions', { n: i + 1 }) },
      },
      icon('more', 19),
    );
    more.addEventListener('click', () =>
      this.menu.show(more, [
        { label: t.t('newPageAfter'), icon: 'plus', onClick: () => h.addAfter(page) },
        { label: t.t('sizeBg'), icon: 'page', onClick: () => h.settings(page) },
        { label: t.t('duplicate'), icon: 'copy', onClick: () => h.duplicate(page) },
        '-',
        { label: t.t('deletePage'), icon: 'trash', danger: true, onClick: () => h.remove(page) },
      ]),
    );
    const action = (
      label: string,
      iconName: 'up' | 'down',
      disabled: boolean,
      fn: () => void,
    ): HTMLButtonElement =>
      el(
        'button',
        {
          class: 'icon-btn page-item__action',
          attrs: { type: 'button', 'aria-label': label, disabled },
          on: { click: fn },
        },
        icon(iconName, 19),
      );
    return el(
      'div',
      { class: 'page-item' + (active ? ' page-item--active' : '') },
      el(
        'button',
        {
          class: 'page-item__thumb',
          attrs: { type: 'button', 'aria-label': t.t('goPage', { n: i + 1 }) },
          on: { click: () => h.goTo(page) },
        },
        canvas,
      ),
      el(
        'div',
        { class: 'page-item__info' },
        el('b', { class: 'page-item__name' }, t.t('pageN', { n: i + 1 })),
        el(
          'span',
          { class: 'page-item__size' },
          el('span', null, icon(page.locked ? 'lock' : 'unlock', 15)),
          this.sizes.short(page.w, page.h) + (page.locked ? '' : ' · ' + t.t('ownShort')),
        ),
        page.bgBlob ? el('span', { class: 'muted' }, t.t('fromPdf')) : null,
        el(
          'div',
          { class: 'page-item__actions' },
          action(t.t('up'), 'up', i === 0, () => h.move(page, -1)),
          action(t.t('down'), 'down', i === count - 1, () => h.move(page, 1)),
          more,
        ),
      ),
    );
  }
}
