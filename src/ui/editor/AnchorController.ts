import type { LinkGeometry } from '../../canvas/LinkGeometry';
import { MAX_ANCHOR_NAME } from '../../core/constants';
import type { Anchor, Box, InternalLink, Page, PageRect, TextItem } from '../../core/types';
import { FileNames } from '../../domain/FileNames';
import { LinkClipboard } from '../../domain/LinkClipboard';
import type { EditorSession } from '../../editor/EditorSession';
import type { UndoController } from '../../editor/UndoController';
import type { I18n } from '../../i18n/I18n';
import type { AnchorDialog } from '../dialogs/AnchorDialog';

export interface AnchorControllerDeps {
  i18n: I18n;
  dialog: AnchorDialog;
  session: EditorSession;
  undo: Pick<UndoController, 'record'>;
  geometry: Pick<LinkGeometry, 'anchorBox' | 'itemsBox'>;
  clipboard: LinkClipboard;
  makeId: () => string;
  toast: (message: string) => void;
  /** A place was linked to or copied. */
  remember: (link: InternalLink) => void;
}

/** The name a new anchor starts with: the first line of its text, or "Page N". */
export function defaultAnchorName(text: string | null, pageLabel: string): string {
  const line = (text ?? '').split('\n').find((candidate) => candidate.trim());
  return (line && FileNames.label(line, MAX_ANCHOR_NAME)) || pageLabel;
}

/** Creating, renaming and deleting anchors, each one undo step on its page. */
export class AnchorController {
  constructor(private readonly deps: AnchorControllerDeps) {}

  /** The link to a page. */
  pageLink(page: Page): InternalLink {
    return { kind: 'page', nb: page.nbId, id: page.id };
  }

  /** Bookmarks a whole page. */
  async addToPage(page: Page): Promise<boolean> {
    return this.add(page, [], undefined, null);
  }

  /** Bookmarks items selected with the lasso, named after the first text box among them. */
  async addToItems(page: Page, ids: ReadonlySet<string>): Promise<boolean> {
    const text = page.texts.find((item) => ids.has(item.id));
    return this.add(page, [...ids], undefined, text?.t ?? null);
  }

  /** Bookmarks a text box, or a stretch of one. */
  async addToText(page: Page, item: TextItem, range: [number, number] | null): Promise<boolean> {
    const text = range ? item.t.slice(range[0], range[1]) : item.t;
    return this.add(page, [item.id], range ?? undefined, text);
  }

  /** Where an anchor is, and the anchor as it is now. */
  find(id: string): { page: Page; anchor: Anchor } | null {
    for (const page of this.deps.session.pages) {
      const anchor = page.anchors.find((a) => a.id === id);
      if (anchor) return { page, anchor };
    }
    return null;
  }

  async rename(id: string): Promise<void> {
    const found = this.find(id);
    if (!found) return;
    const name = await this.deps.dialog.ask(this.deps.i18n.t('bookmarkRename'), found.anchor.name);
    const now = this.find(id);
    if (!name || !now || name === now.anchor.name) return;
    this.deps.undo.record(now.page);
    now.page.anchors = now.page.anchors.map((a) => (a.id === id ? { ...a, name } : a));
    this.deps.session.touch(now.page);
  }

  /** Deletes an anchor. Links to it show as broken until undo brings it back. */
  remove(id: string): void {
    const found = this.find(id);
    if (!found) return;
    this.deps.undo.record(found.page);
    found.page.anchors = found.page.anchors.filter((a) => a.id !== id);
    this.deps.session.touch(found.page);
    this.deps.toast(this.deps.i18n.t('bookmarkDeleted'));
  }

  /** Copies a link inside the app, for "Paste link". */
  copyLink(link: InternalLink): void {
    this.deps.clipboard.copy(link);
    this.deps.remember(link);
    this.deps.toast(this.deps.i18n.t('linkCopiedApp'));
  }

  private async add(
    page: Page,
    items: string[],
    range: [number, number] | undefined,
    text: string | null,
  ): Promise<boolean> {
    const { i18n, session } = this.deps;
    const label = i18n.t('linkPageN', { n: session.indexOf(page) + 1 });
    const name = await this.deps.dialog.ask(i18n.t('bookmarkAdd'), defaultAnchorName(text, label));
    if (!name || !session.has(page)) return false;
    const anchor: Anchor = { id: this.deps.makeId(), name, items, rect: { x: 0, y: 0, w: 0, h: 0 } };
    if (range) anchor.range = range;
    anchor.rect = AnchorController.rectOf(this.deps.geometry.anchorBox(page, anchor));
    this.deps.undo.record(page);
    page.anchors = [...page.anchors, anchor];
    session.touch(page);
    return true;
  }

  private static rectOf(box: Box): PageRect {
    return { x: box.x0, y: box.y0, w: box.x1 - box.x0, h: box.y1 - box.y0 };
  }
}
