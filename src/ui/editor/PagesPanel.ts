import type { PagePainter } from '../../canvas/PagePainter';
import type { Page } from '../../core/types';
import { byId, context2d, el, replaceChildren } from '../../core/utils/dom';
import type { PageGridShape } from '../../domain/PageGrid';
import type { PageSizes } from '../../domain/PageSizes';
import type { I18n } from '../../i18n/I18n';
import type { Menu, MenuEntry } from '../dialogs/Menu';
import { icon } from '../icons';
import { PageCell } from './PageCell';
import { PageDragController } from './PageDragController';
import { PageThumbnails } from './PageThumbnails';

export interface PagesPanelHandlers {
  goTo(page: Page): void;
  addBefore(page: Page): void;
  addAfter(page: Page): void;
  settings(page: Page): void;
  duplicate(page: Page): void;
  /** Bookmarks a whole page. */
  bookmark(page: Page): void;
  /** Copies a link to a page, inside the app. */
  copyLink(page: Page): void;
  /** Deletes pages after confirmation; resolves to whether they were deleted. */
  remove(pages: readonly Page[]): Promise<boolean>;
  moveTo(page: Page, index: number): void;
}

export interface PagesPanelDeps {
  i18n: I18n;
  sizes: PageSizes;
  menu: Menu;
  painter: Pick<PagePainter, 'paint'>;
  loadBitmap: (id: string) => Promise<unknown>;
  revision: (page: Page) => number;
  dpr: () => number;
  /** Whether a dialog is open above the panel; it then handles Escape itself. */
  sheetOpen: () => boolean;
  handlers: PagesPanelHandlers;
}

/** Delay before repainting after an image finished loading, so several loads share one repaint. */
const REFRESH_DELAY_MS = 200;

/**
 * The page organizer: a full-screen grid of thumbnails for going to, inserting, reordering,
 * duplicating and deleting pages. Cells are kept between updates, so changing the order costs
 * little however many pages there are.
 */
export class PagesPanel {
  private readonly node = byId('panel');
  private readonly list = byId('plist');
  private readonly title = byId('panelTitle');
  private readonly hint = byId('panelHint');
  private readonly closeButton = byId<HTMLButtonElement>('panelClose');
  private readonly selectButton = byId<HTMLButtonElement>('panelSelect');
  private readonly foot = byId('panelFoot');
  private readonly selectedCount = byId('panelSelCount');
  private readonly deleteButton = byId<HTMLButtonElement>('panelDelete');
  private readonly cancelButton = byId<HTMLButtonElement>('panelSelCancel');
  private readonly indicator = el('div', { class: 'pages-panel__drop', attrs: { hidden: true } });
  private readonly addEnd = el('button', {
    class: 'page-item__add',
    attrs: { type: 'button' },
    on: { click: () => this.addAtEnd() },
  });
  private readonly thumbnails: PageThumbnails;
  private readonly drag: PageDragController;
  private readonly cells = new Map<Page, PageCell>();
  private readonly selected = new Set<Page>();
  private pages: readonly Page[] = [];
  private current = 0;
  private selecting = false;
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly onKey = (e: KeyboardEvent): void => this.handleKey(e);

  constructor(private readonly deps: PagesPanelDeps) {
    this.thumbnails = new PageThumbnails({
      root: this.list,
      painter: deps.painter,
      loadBitmap: deps.loadBitmap,
      revision: deps.revision,
      dpr: deps.dpr,
    });
    this.drag = new PageDragController({
      list: this.list,
      indicator: this.indicator,
      enabled: () => !this.selecting,
      indexOf: (target) => this.indexOfThumb(target),
      grid: () => this.grid(),
      ghost: (index) => this.ghost(index),
      onDrop: (from, to) => this.dropped(from, to),
      onHold: (index) => this.held(index),
    });
    this.closeButton.append(icon('close'));
    this.closeButton.addEventListener('click', () => this.hide());
    this.selectButton.addEventListener('click', () => this.setSelecting(!this.selecting));
    this.cancelButton.addEventListener('click', () => this.setSelecting(false));
    this.deleteButton.addEventListener('click', () => void this.deleteSelected());
    document.addEventListener('keydown', this.onKey);
  }

  get isOpen(): boolean {
    return !this.node.hidden;
  }

  /** Opens the panel with the current page in view. */
  open(pages: readonly Page[], current: number): void {
    this.node.hidden = false;
    this.render(pages, current);
    this.cellAt(current)?.node.scrollIntoView({ block: 'center' });
  }

  /** Closes the panel and frees its thumbnails. */
  hide(): void {
    if (!this.isOpen) return;
    this.drag.cancel();
    this.node.hidden = true;
    this.selecting = false;
    this.selected.clear();
    this.foot.hidden = true;
    this.list.classList.remove('pages-panel__list--selecting');
    this.thumbnails.reset();
    this.cells.clear();
    replaceChildren(this.list);
  }

  applyLanguage(): void {
    const t = this.deps.i18n;
    this.node.setAttribute('aria-label', t.t('nbPages'));
    this.closeButton.setAttribute('aria-label', t.t('close'));
    this.deleteButton.textContent = t.t('delete');
    this.cancelButton.textContent = t.t('cancel');
    this.hint.textContent = t.t('pagesDragHint');
    this.addEnd.setAttribute('aria-label', t.t('pageToEnd'));
    replaceChildren(this.addEnd, icon('plus', 24));
    this.updateHead();
  }

  /** Repaints thumbnails a little later (e.g. after an image finished loading). */
  refreshSoon(): void {
    if (!this.isOpen) return;
    clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => this.thumbnails.refresh(), REFRESH_DELAY_MS);
  }

  /** Brings the grid in line with the page list. */
  render(pages: readonly Page[], current: number): void {
    if (!this.isOpen) return;
    this.pages = pages;
    this.current = current;
    const present = new Set(pages);
    for (const [page, cell] of this.cells) {
      if (present.has(page)) continue;
      this.thumbnails.unwatch(cell.thumb);
      this.cells.delete(page);
      this.selected.delete(page);
    }
    const nodes = pages.map((page, index) => {
      const cell = this.cellFor(page);
      cell.update(index, this.cellState(page, index));
      return cell.node;
    });
    replaceChildren(this.list, ...nodes, this.addEnd, this.indicator);
    this.updateHead();
    this.thumbnails.refresh();
  }

  /** Highlights the current page without rebuilding. */
  highlight(current: number): void {
    if (!this.isOpen || current === this.current) return;
    this.cellAt(this.current)?.setActive(false);
    this.current = current;
    this.cellAt(current)?.setActive(true);
  }

  /** Removes document listeners and observers. */
  destroy(): void {
    clearTimeout(this.refreshTimer);
    document.removeEventListener('keydown', this.onKey);
    this.drag.destroy();
    this.thumbnails.reset();
  }

  private cellAt(index: number): PageCell | undefined {
    const page = this.pages[index];
    return page && this.cells.get(page);
  }

  private cellState(page: Page, index: number) {
    return { active: index === this.current, selecting: this.selecting, selected: this.selected.has(page) };
  }

  private cellFor(page: Page): PageCell {
    const existing = this.cells.get(page);
    if (existing) return existing;
    const cell = new PageCell(page, this.deps.i18n, this.deps.sizes, {
      open: (p) => this.tapped(p),
      insertBefore: (p) => this.deps.handlers.addBefore(p),
      menu: (p, anchor) => this.deps.menu.show(anchor, this.menuFor(p)),
    });
    this.cells.set(page, cell);
    this.thumbnails.watch(cell.thumb, page);
    return cell;
  }

  private tapped(page: Page): void {
    if (!this.selecting) {
      this.deps.handlers.goTo(page);
      this.hide();
      return;
    }
    if (!this.selected.delete(page)) this.selected.add(page);
    this.render(this.pages, this.current);
  }

  private menuFor(page: Page): MenuEntry[] {
    const t = this.deps.i18n;
    const h = this.deps.handlers;
    const index = this.pages.indexOf(page);
    const last = this.pages.length - 1;
    return [
      { label: t.t('insertBefore'), icon: 'plus', onClick: () => h.addBefore(page) },
      { label: t.t('insertAfter'), icon: 'plus', onClick: () => h.addAfter(page) },
      { label: t.t('duplicate'), icon: 'copy', onClick: () => h.duplicate(page) },
      { label: t.t('sizeBg'), icon: 'page', onClick: () => h.settings(page) },
      { label: t.t('bookmarkAdd'), icon: 'bookmark', onClick: () => h.bookmark(page) },
      { label: t.t('pageCopyLink'), icon: 'link', onClick: () => h.copyLink(page) },
      '-',
      {
        label: t.t('moveEarlier'),
        icon: 'up',
        disabled: index <= 0,
        onClick: () => h.moveTo(page, index - 1),
      },
      {
        label: t.t('moveLater'),
        icon: 'down',
        disabled: index >= last,
        onClick: () => h.moveTo(page, index + 1),
      },
      { label: t.t('moveStart'), disabled: index <= 0, onClick: () => h.moveTo(page, 0) },
      { label: t.t('moveEnd'), disabled: index >= last, onClick: () => h.moveTo(page, last) },
      '-',
      {
        label: t.t('deletePage'),
        icon: 'trash',
        danger: true,
        onClick: () => void h.remove([page]),
      },
    ];
  }

  private addAtEnd(): void {
    const last = this.pages[this.pages.length - 1];
    if (last) this.deps.handlers.addAfter(last);
  }

  private setSelecting(on: boolean): void {
    this.selecting = on;
    this.selected.clear();
    this.foot.hidden = !on;
    this.list.classList.toggle('pages-panel__list--selecting', on);
    this.render(this.pages, this.current);
  }

  private async deleteSelected(): Promise<void> {
    const chosen = this.pages.filter((page) => this.selected.has(page));
    if (chosen.length && (await this.deps.handlers.remove(chosen))) this.setSelecting(false);
  }

  private updateHead(): void {
    const t = this.deps.i18n;
    this.title.textContent = t.t('pagesCount', { n: this.pages.length });
    this.selectButton.textContent = t.t(this.selecting ? 'cancel' : 'pagesSelect');
    this.selectedCount.textContent = t.t('pagesSelected', { n: this.selected.size });
    this.deleteButton.disabled = this.selected.size === 0;
    this.hint.hidden = this.selecting;
  }

  private handleKey(e: KeyboardEvent): void {
    if (!this.isOpen || e.key !== 'Escape') return;
    if (this.drag.active) this.drag.cancel();
    else if (this.deps.menu.isOpen) this.deps.menu.close();
    else if (this.deps.sheetOpen()) return;
    else if (this.selecting) this.setSelecting(false);
    else this.hide();
  }

  private indexOfThumb(target: Element): number | null {
    const thumb = target.closest('.page-item__thumb');
    if (!thumb) return null;
    const index = this.pages.findIndex((page) => this.cells.get(page)?.thumb === thumb);
    return index < 0 ? null : index;
  }

  /** Measures the laid-out grid: every cell has the same size. */
  private grid(): PageGridShape {
    const cell = (i: number): HTMLElement | undefined => this.cellAt(i)?.node;
    const first = cell(0);
    const originX = first?.offsetLeft ?? 0;
    const originY = first?.offsetTop ?? 0;
    let columns = 1;
    while (cell(columns)?.offsetTop === originY) columns++;
    const stepX = columns > 1 ? (cell(1)?.offsetLeft ?? 0) - originX : (first?.offsetWidth ?? 1);
    const below = cell(columns);
    const stepY = below ? below.offsetTop - originY : (first?.offsetHeight ?? 1);
    return { originX, originY, stepX, stepY, columns, count: this.pages.length };
  }

  private ghost(index: number): HTMLElement {
    const page = this.pages[index];
    const source = page ? this.thumbnails.canvasOf(page.id) : null;
    const copy = el('canvas', {
      class: 'page-ghost',
      attrs: { width: source?.width ?? 1, height: source?.height ?? 1 },
      style: { width: source?.style.width ?? '96px', height: source?.style.height ?? '136px' },
    });
    if (source) context2d(copy).drawImage(source, 0, 0);
    return copy;
  }

  private dropped(from: number, to: number): void {
    const page = this.pages[from];
    if (page) this.deps.handlers.moveTo(page, to);
  }

  private held(index: number): void {
    const page = this.pages[index];
    const anchor = page && this.cells.get(page)?.thumb;
    if (page && anchor) this.deps.menu.show(anchor, this.menuFor(page));
  }
}
