import { CARD_PLACE_HINT_MS, MM } from '../../core/constants';
import type { CardItem, CardKind, LinkCard, Page, PdfCard, Point, UrlLink } from '../../core/types';
import { el } from '../../core/utils/dom';
import { pickFile } from '../../core/utils/files';
import { CardRules } from '../../domain/CardRules';
import { FileNames } from '../../domain/FileNames';
import type { EditorSession } from '../../editor/EditorSession';
import type { LinkHit, PagePressTargets } from '../../editor/PagePressTargets';
import type { UndoController } from '../../editor/UndoController';
import type { PdfAttachments, PreparedPdf } from '../../features/attachments/PdfAttachments';
import { PdfRejectedError } from '../../features/attachments/PdfRejectedError';
import type { FileSaver } from '../../features/files/FileSaver';
import type { I18n, TextKey } from '../../i18n/I18n';
import type { PressKind, PressTarget } from '../../input/InputRouter';
import type { BlobRepository } from '../../storage/BlobRepository';
import { MAX_LEN } from '../../storage/validation/guards';
import type { DialogFactory } from '../dialogs/DialogFactory';
import type { LinkDialog } from '../dialogs/LinkDialog';
import type { LinkOpener } from '../dialogs/LinkOpener';
import type { Menu, MenuEntry } from '../dialogs/Menu';
import { field } from '../widgets/field';
import type { PdfViewer } from './PdfViewer';

export interface CardControllerDeps {
  i18n: I18n;
  menu: Menu;
  dialogs: DialogFactory;
  files: FileSaver;
  blobs: Pick<BlobRepository, 'get'>;
  attachments: PdfAttachments;
  viewer: PdfViewer;
  linkDialog: LinkDialog;
  links: LinkOpener;
  /** Follows a link that was tapped. */
  openLink: (hit: LinkHit) => Promise<void>;
  /** What a long press on a link offers. */
  linkEntries: (hit: LinkHit) => MenuEntry[];
  targets: PagePressTargets;
  session: EditorSession;
  undo: Pick<UndoController, 'record'>;
  makeId: () => string;
  stage: HTMLElement;
  prompt: {
    show(prompt: {
      message: string;
      action: string;
      ms: number;
      onAction: () => void;
      onExpire: () => void;
    }): void;
    hide(): void;
  };
  toast: (message: string, ms?: number) => void;
  /** Takes away a toast still showing, so that it does not cover the hint. */
  dismissToast: () => void;
  /** Finishes text editing and clears the selection. */
  settle: () => void;
  /** Selects a card with the lasso, for moving and resizing. */
  selectCard: (page: Page, card: CardItem) => void;
  /** Imports a PDF's pages as notebook pages. */
  insertPages: (file: Blob) => Promise<void>;
}

/** A new card waiting for the user to tap where it goes. */
type Pending = { kind: 'pdf'; prepared: PreparedPdf } | { kind: 'link'; link: UrlLink; title: string };

const REJECTION_TEXT: Record<PdfRejectedError['reason'], TextKey> = {
  'too-large': 'attachTooBig',
  'wrong-type': 'wrongFileType',
  'no-space': 'attachNoSpace',
};

/**
 * What the user does with attachment cards and linked words: inserting a card, opening it, and its
 * menu. Implements the press side of input, so taps on the page reach cards before any tool.
 */
export class CardController implements PressTarget {
  private pending: Pending | null = null;
  private readonly anchor = el('div', { class: 'card-anchor' });

  constructor(private readonly deps: CardControllerDeps) {
    deps.stage.append(this.anchor);
  }

  /** The choices of ⋯ → Insert, and of the toolbar's attachment button. */
  insertEntries(): MenuEntry[] {
    const { i18n } = this.deps;
    return [
      { label: i18n.t('insertPdfFile'), icon: 'file', onClick: () => void this.insertPdf() },
      { label: i18n.t('insertLink'), icon: 'link', onClick: () => void this.insertLink() },
    ];
  }

  /** Forgets a card still waiting for its spot. */
  cancelPlacement(): void {
    if (!this.pending) return;
    this.pending = null;
    this.deps.prompt.hide();
  }

  /* ---------- presses on the page ---------- */

  kindAt(pt: Point, e: PointerEvent): PressKind | null {
    if (this.pending) return this.deps.targets.pageAt(pt) ? 'place' : null;
    // The eraser end of a stylus erases, whatever is under it.
    if (e.pointerType === 'pen' && (e.button === 5 || (e.buttons & 32) !== 0)) return null;
    return this.deps.targets.at(pt) ? 'tap' : null;
  }

  tap(pt: Point): void {
    if (this.pending) {
      this.place(pt, this.pending);
      return;
    }
    const hit = this.deps.targets.at(pt);
    if (hit?.kind === 'link') void this.deps.openLink(hit);
    else if (hit?.onMenu) this.showMenu(pt, hit.page, hit.card);
    else if (hit) void this.openCard(hit.card);
  }

  longPress(pt: Point): boolean {
    const hit = this.deps.targets.at(pt);
    if (!hit) return false;
    if (hit.kind === 'card') {
      this.showMenu(pt, hit.page, hit.card);
      return true;
    }
    const entries = this.deps.linkEntries(hit);
    if (!entries.length) return false;
    this.placeAnchor(pt);
    this.deps.menu.show(this.anchor, entries);
    return true;
  }

  /* ---------- inserting ---------- */

  private async insertPdf(): Promise<void> {
    const { i18n, toast } = this.deps;
    this.deps.settle();
    const file = await pickFile('application/pdf');
    if (!file) return;
    toast(i18n.t('pdfOpening'), 0);
    try {
      const prepared = await this.deps.attachments.prepare(file, file.name);
      this.waitForSpot({ kind: 'pdf', prepared });
    } catch (error) {
      toast(i18n.t(error instanceof PdfRejectedError ? REJECTION_TEXT[error.reason] : 'attachFail'), 4000);
    }
  }

  private async insertLink(): Promise<void> {
    this.deps.settle();
    const choice = await this.deps.linkDialog.ask({ withTitle: true });
    if (choice?.kind !== 'url') return;
    this.waitForSpot({
      kind: 'link',
      link: { kind: 'url', href: choice.href },
      title: choice.title,
    });
  }

  private waitForSpot(pending: Pending): void {
    const { i18n } = this.deps;
    this.deps.dismissToast();
    this.pending = pending;
    this.deps.prompt.show({
      message: i18n.t('cardPlaceHint'),
      action: i18n.t('cancel'),
      ms: CARD_PLACE_HINT_MS,
      onAction: () => (this.pending = null),
      onExpire: () => (this.pending = null),
    });
  }

  private place(pt: Point, pending: Pending): void {
    const at = this.deps.targets.pageAt(pt);
    if (!at) return;
    this.cancelPlacement();
    void this.commit(pending, at.page, at.local.y);
  }

  private async commit(pending: Pending, page: Page, y: number): Promise<void> {
    const kind: CardKind = pending.kind;
    const spot = { id: this.deps.makeId(), ...CardRules.place(kind, page.w * MM, page.h * MM, y) };
    if (pending.kind === 'link') {
      this.add(page, { ...spot, kind: 'link', link: pending.link, title: pending.title });
      return;
    }
    try {
      await this.deps.attachments.store(pending.prepared);
    } catch (error) {
      const full = error instanceof DOMException && error.name === 'QuotaExceededError';
      this.deps.toast(this.deps.i18n.t(full ? 'attachNoSpace' : 'attachFail'), 4000);
      return;
    }
    if (this.deps.session.has(page)) this.add(page, { ...spot, ...pending.prepared.fields });
  }

  private add(page: Page, card: CardItem): void {
    this.deps.undo.record(page);
    page.cards = [...page.cards, card];
    this.deps.session.touch(page);
  }

  /* ---------- opening ---------- */

  private async openCard(card: CardItem): Promise<void> {
    if (card.kind === 'link') {
      await this.deps.links.open(card.link);
      return;
    }
    if (card.problem) {
      await this.offerCopy(card);
      return;
    }
    const file = await this.file(card);
    if (file) await this.deps.viewer.open(file, card.name);
  }

  /** A file that cannot be shown can still be saved and opened elsewhere. */
  private async offerCopy(card: PdfCard): Promise<void> {
    const { i18n, dialogs } = this.deps;
    const text = i18n.t(card.problem === 'locked' ? 'pdfLockedText' : 'pdfBrokenText');
    const ok = await dialogs.confirm(card.name, text, i18n.t('cardSaveCopy'), false);
    if (ok) await this.saveCopy(card);
  }

  private async file(card: PdfCard): Promise<Blob | null> {
    try {
      const file = await this.deps.blobs.get(card.blob);
      if (file) return file;
    } catch {
      /* Told below, like a missing file. */
    }
    this.deps.toast(this.deps.i18n.t('attachMissing'), 4000);
    return null;
  }

  private async saveCopy(card: PdfCard): Promise<void> {
    const file = await this.file(card);
    if (!file) return;
    const name = FileNames.forPdfDownload(card.name, this.deps.i18n.t('pdfFallbackName'));
    await this.deps.files.save(name, file);
  }

  /* ---------- the menu ---------- */

  private placeAnchor(pt: Point): void {
    this.anchor.style.left = pt.x + 'px';
    this.anchor.style.top = pt.y + 'px';
  }

  private showMenu(pt: Point, page: Page, card: CardItem): void {
    this.placeAnchor(pt);
    const entries = card.kind === 'pdf' ? this.pdfEntries(page, card) : this.linkEntries(page, card);
    this.deps.menu.show(this.anchor, entries);
  }

  private pdfEntries(page: Page, card: PdfCard): MenuEntry[] {
    const { i18n } = this.deps;
    return [
      { label: i18n.t('open'), icon: 'file', onClick: () => void this.openCard(card) },
      { label: i18n.t('cardSaveCopy'), icon: 'download', onClick: () => void this.saveCopy(card) },
      {
        label: i18n.t('cardInsertPages'),
        icon: 'page',
        disabled: card.problem !== undefined,
        onClick: () => void this.insertPages(card),
      },
      { label: i18n.t('cardRename'), icon: 'edit', onClick: () => this.rename(page, card) },
      ...this.commonEntries(page, card),
    ];
  }

  private linkEntries(page: Page, card: LinkCard): MenuEntry[] {
    const { i18n } = this.deps;
    return [
      { label: i18n.t('open'), icon: 'link', onClick: () => void this.openCard(card) },
      { label: i18n.t('cardCopyLink'), icon: 'copy', onClick: () => void this.copyLink(card) },
      { label: i18n.t('cardEdit'), icon: 'edit', onClick: () => void this.editLink(page, card) },
      ...this.commonEntries(page, card),
    ];
  }

  private commonEntries(page: Page, card: CardItem): MenuEntry[] {
    const { i18n } = this.deps;
    return [
      { label: i18n.t('cardMove'), icon: 'lasso', onClick: () => this.deps.selectCard(page, card) },
      '-',
      { label: i18n.t('delete'), icon: 'trash', danger: true, onClick: () => this.remove(page, card) },
    ];
  }

  private async insertPages(card: PdfCard): Promise<void> {
    const file = await this.file(card);
    if (file) await this.deps.insertPages(file);
  }

  private async copyLink(card: LinkCard): Promise<void> {
    const { i18n, toast } = this.deps;
    try {
      await navigator.clipboard.writeText(card.link.href);
      toast(i18n.t('linkCopied'));
    } catch {
      toast(i18n.t('linkCopyFail'));
    }
  }

  private async editLink(page: Page, card: LinkCard): Promise<void> {
    const choice = await this.deps.linkDialog.ask({
      link: card.link,
      title: card.title,
      withTitle: true,
    });
    if (choice?.kind !== 'url') return;
    this.replace(page, { ...card, link: { kind: 'url', href: choice.href }, title: choice.title });
  }

  private rename(page: Page, card: PdfCard): void {
    const { i18n, dialogs } = this.deps;
    const input = el('input', {
      class: 'input',
      attrs: { type: 'text', id: 'card-name', value: card.name, maxlength: MAX_LEN.name },
    });
    dialogs.sheet({
      title: i18n.t('cardRename'),
      body: field(i18n.t('cardFileName'), input),
      actions: [
        {
          label: i18n.t('save'),
          primary: true,
          onClick: () => this.replace(page, { ...card, name: FileNames.sanitize(input.value, card.name) }),
        },
      ],
      focus: true,
    });
  }

  /** One undo step. The card is found by id: the page may have changed under an open dialog. */
  private replace(page: Page, card: CardItem): void {
    if (!page.cards.some((c) => c.id === card.id)) return;
    this.deps.undo.record(page);
    page.cards = page.cards.map((c) => (c.id === card.id ? card : c));
    this.deps.session.touch(page);
  }

  /** The stored file stays until no page or undo step needs it (see `BlobSweeper`). */
  private remove(page: Page, card: CardItem): void {
    this.deps.undo.record(page);
    page.cards = page.cards.filter((c) => c.id !== card.id);
    this.deps.session.touch(page);
  }
}
