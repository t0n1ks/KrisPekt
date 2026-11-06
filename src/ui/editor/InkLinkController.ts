import type { LinkGeometry } from '../../canvas/LinkGeometry';
import type { InkLink, InternalLink, LinkTarget, Page, PageRect, TextItem } from '../../core/types';
import type { LinkClipboard } from '../../domain/LinkClipboard';
import type { LinkDirectory } from '../../domain/LinkDirectory';
import { AnchorMarks } from '../../domain/AnchorMarks';
import { LinkRules } from '../../domain/LinkRules';
import { RichText } from '../../domain/RichText';
import type { EditorSession } from '../../editor/EditorSession';
import type { LinkHit } from '../../editor/PagePressTargets';
import type { UndoController } from '../../editor/UndoController';
import type { I18n } from '../../i18n/I18n';
import type { Selection } from '../../tools/Selection';
import type { DialogFactory } from '../dialogs/DialogFactory';
import type { LinkDialog } from '../dialogs/LinkDialog';
import type { LinkOpener } from '../dialogs/LinkOpener';
import type { MenuEntry } from '../dialogs/Menu';
import type { LinkNavigator } from './LinkNavigator';

export interface InkLinkControllerDeps {
  i18n: I18n;
  dialogs: DialogFactory;
  linkDialog: LinkDialog;
  web: LinkOpener;
  navigator: Pick<LinkNavigator, 'go'>;
  directory: LinkDirectory;
  session: EditorSession;
  selection: Pick<Selection, 'current' | 'clear'>;
  undo: Pick<UndoController, 'record'>;
  geometry: Pick<LinkGeometry, 'itemsBox'>;
  clipboard: LinkClipboard;
  makeId: () => string;
  toast: (message: string) => void;
  /** Bookmarks the selected items: the place a link can lead to. */
  bookmarkSelection: () => void;
  /** Removes the bookmarks on the selected items. */
  removeBookmarks: (page: Page, ids: ReadonlySet<string>) => void;
  /** Writes a table of contents again. */
  updateContents: (page: Page, item: TextItem) => void;
}

/** Following links wherever they are, and making handwriting (or anything lassoed) into a link. */
export class InkLinkController {
  constructor(private readonly deps: InkLinkControllerDeps) {}

  /** Follows a link that was tapped. Web addresses ask first; places in the notes need not. */
  async open(hit: LinkHit): Promise<void> {
    const { link } = hit;
    if (!LinkRules.isInternal(link)) {
      await this.deps.web.open(link);
      return;
    }
    if (!(await this.deps.navigator.go(link))) await this.offerRemoval(hit);
  }

  /** The target is gone: says so, and offers to remove the link. */
  private async offerRemoval(hit: LinkHit): Promise<void> {
    const { i18n, dialogs } = this.deps;
    const remove = await dialogs.confirm(
      i18n.t('linkBrokenTitle'),
      i18n.t('linkBrokenText'),
      i18n.t('linkRemove'),
    );
    if (remove) this.removeLink(hit);
  }

  /** What a long press on a link offers; nothing for a word in an ordinary text box. */
  hitEntries(hit: LinkHit): MenuEntry[] {
    const { i18n } = this.deps;
    const open: MenuEntry = { label: i18n.t('open'), icon: 'link', onClick: () => void this.open(hit) };
    if (hit.ink) {
      const { page, ink } = hit;
      return [
        open,
        { label: i18n.t('linkChange'), icon: 'edit', onClick: () => void this.change(page, ink) },
        { label: i18n.t('linkRemove'), icon: 'trash', danger: true, onClick: () => this.removeLink(hit) },
      ];
    }
    const { page, item } = hit;
    if (!item.toc) return [];
    return [
      open,
      {
        label: i18n.t('contentsUpdate'),
        icon: 'refresh',
        onClick: () => this.deps.updateContents(page, item),
      },
    ];
  }

  /**
   * What the selection bar's link button offers for the selected items: to make them a place links
   * lead to (a bookmark), or to make them lead somewhere (a link).
   */
  selectionEntries(): MenuEntry[] {
    const { i18n, clipboard } = this.deps;
    const selected = this.deps.selection.current;
    if (!selected) return [];
    const { page, ids } = selected;
    const linked = page.inkLinks.some((ink) => ink.items.every((id) => ids.has(id)));
    const bookmarked = AnchorMarks.on(page, ids).length > 0;
    return [
      { label: i18n.t('linkMake'), icon: 'bookmark', onClick: () => this.deps.bookmarkSelection() },
      { label: i18n.t('linkInsert'), icon: 'link', onClick: () => void this.insertOnSelection() },
      {
        label: i18n.t('linkPaste'),
        icon: 'paste',
        disabled: clipboard.current === null,
        onClick: () => this.pasteOnSelection(),
      },
      ...(linked
        ? [
            {
              label: i18n.t('linkRemove'),
              icon: 'trash' as const,
              onClick: () => this.removeFromSelection(),
            },
          ]
        : []),
      ...(bookmarked
        ? [
            {
              label: i18n.t('bookmarkRemoveHere'),
              icon: 'trash' as const,
              onClick: () => this.deps.removeBookmarks(page, ids),
            },
          ]
        : []),
    ];
  }

  private async insertOnSelection(): Promise<void> {
    const selected = this.deps.selection.current;
    if (!selected) return;
    const { page, ids } = selected;
    const existing = page.inkLinks.find((ink) => ink.items.every((id) => ids.has(id)));
    const link = await this.ask(existing?.link);
    if (link === undefined) return;
    if (link) this.bind(page, ids, link);
    else this.unbind(page, ids);
  }

  private async change(page: Page, ink: InkLink): Promise<void> {
    const link = await this.ask(ink.link);
    if (link === undefined) return;
    const ids = new Set(ink.items);
    if (link) this.bind(page, ids, link);
    else this.unbind(page, ids);
  }

  /** The place chosen; null to remove the link, undefined if the dialog was cancelled. */
  private async ask(current: LinkTarget | undefined): Promise<LinkTarget | null | undefined> {
    const choice = await this.deps.linkDialog.ask({
      link: current,
      canRemove: current !== undefined,
      notes: true,
      startInNotes: true,
    });
    if (!choice) return undefined;
    if (choice.kind === 'remove') return null;
    return choice.kind === 'internal' ? choice.link : { kind: 'url', href: choice.href };
  }

  private pasteOnSelection(): void {
    const selected = this.deps.selection.current;
    const link: InternalLink | null = this.deps.clipboard.current;
    if (!selected || !link) return;
    if (this.deps.directory.isBroken(link)) {
      this.deps.toast(this.deps.i18n.t('linkBrokenTitle'));
      return;
    }
    this.bind(selected.page, selected.ids, link);
  }

  private removeFromSelection(): void {
    const selected = this.deps.selection.current;
    if (selected) this.unbind(selected.page, selected.ids);
  }

  /** Items carry one link: a new one replaces any the selection covers. */
  private bind(page: Page, ids: ReadonlySet<string>, link: LinkTarget): void {
    const box = this.deps.geometry.itemsBox(page, ids);
    if (!box) return;
    const rect: PageRect = { x: box.x0, y: box.y0, w: box.x1 - box.x0, h: box.y1 - box.y0 };
    const kept = page.inkLinks.filter((ink) => !ink.items.every((id) => ids.has(id)));
    this.deps.undo.record(page);
    page.inkLinks = [...kept, { id: this.deps.makeId(), items: [...ids], rect, link }];
    this.done(page);
  }

  private unbind(page: Page, ids: ReadonlySet<string>): void {
    this.deps.undo.record(page);
    page.inkLinks = page.inkLinks.filter((ink) => !ink.items.every((id) => ids.has(id)));
    this.done(page);
  }

  /** The selection goes: selected items are drawn without their link mark. */
  private done(page: Page): void {
    this.deps.selection.clear();
    this.deps.session.touch(page);
  }

  private removeLink(hit: LinkHit): void {
    const { page } = hit;
    if (hit.ink) {
      const { ink } = hit;
      this.deps.undo.record(page);
      page.inkLinks = page.inkLinks.filter((other) => other.id !== ink.id);
    } else {
      const { item, link } = hit;
      const paras = item.paras;
      if (!paras) return;
      this.deps.undo.record(page);
      const edited = { ...item, paras: RichText.withoutLink(paras, link) };
      page.texts = page.texts.map((other) => (other.id === item.id ? edited : other));
    }
    this.deps.session.touch(page);
  }
}
