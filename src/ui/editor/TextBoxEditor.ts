import type { Camera } from '../../canvas/Camera';
import type { PageLayout } from '../../canvas/PageLayout';
import type { TextLayout } from '../../canvas/TextLayout';
import { MM } from '../../core/constants';
import type { LinkTarget, Page, TextItem, TextParagraph, TextPrefs, TextStyle } from '../../core/types';
import { byId } from '../../core/utils/dom';
import { clamp } from '../../core/utils/math';
import type { EditorSession } from '../../editor/EditorSession';
import { PastedText } from '../../domain/PastedText';
import { RichText, type ParagraphPatch, type StylePatch } from '../../domain/RichText';
import type { LinkChoice, LinkDialogOptions } from '../dialogs/LinkDialog';
import { TextBoxRules, type PageBounds } from '../../domain/TextBoxRules';
import { TextEditHistory } from '../../domain/TextEditHistory';
import type { I18n } from '../../i18n/I18n';
import { LIMITS, MAX_LEN } from '../../storage/validation/guards';
import type { Menu } from '../dialogs/Menu';
import { TextBoxFrame, type FrameDragKind } from './TextBoxFrame';
import { TextDomCodec, type TextRange } from './TextDomCodec';
import { TextFormatBar, type FormatState } from './TextFormatBar';

/** The box being worked on; the page keeps the old item until the change is committed. */
interface Draft {
  id: string;
  x: number;
  y: number;
  w: number;
  auto: boolean;
  fs: number;
  c: string;
  paras: TextParagraph[];
}

interface Session {
  page: Page;
  /** The item on the page, or null for a box that does not exist yet. */
  original: TextItem | null;
  draft: Draft;
  /** What the draft was when last saved; unchanged means nothing to save. */
  saved: string;
  editing: boolean;
  history: TextEditHistory<EditState>;
  selection: TextRange;
  /** The style for what is typed next at a caret, until the caret moves. */
  pending: StylePatch | null;
  composing: boolean;
  dragStart: { x: number; y: number; w: number } | null;
}

/** A point to go back to inside an editing session. */
interface EditState {
  draft: Draft;
  selection: TextRange;
}

export interface TextBoxEditorDeps {
  camera: Camera;
  layout: PageLayout;
  session: EditorSession;
  texts: TextLayout;
  i18n: I18n;
  menu: Menu;
  prefs: () => TextPrefs;
  savePrefs: () => void;
  recentColors: () => readonly string[];
  commitColor: (color: string) => readonly string[];
  makeId: () => string;
  recordUndo: (page: Page) => void;
  undoPage: () => void;
  redoPage: () => void;
  canUndoPage: () => boolean;
  canRedoPage: () => boolean;
  isPalm: (e: PointerEvent) => boolean;
  toast: (message: string) => void;
  /** Asks for a link's address; resolves null if cancelled. */
  askLink: (options: LinkDialogOptions) => Promise<LinkChoice | null>;
  /** Redraws after the camera moved to keep the caret in view. */
  redraw: () => void;
}

/** The caret stays this far from the edge of what the keyboard leaves of the screen. */
const CARET_MARGIN = 16;

/**
 * A text box on the page, from being selected to being edited. While it is open, the box is shown
 * by a DOM element, scaled with the page and hidden from the page bitmap, so moving and resizing
 * are live; the DOM runs at world px, which keeps its line breaks independent of the zoom and equal
 * to the canvas's (see {@link RichTextLayout}).
 *
 * - Selected: frame and handles; each change is saved at once as one page undo step.
 * - Editing: typing, with undo steps of its own. Leaving saves everything as one page undo step.
 */
export class TextBoxEditor {
  private readonly root = byId('textEd');
  private readonly frame: TextBoxFrame;
  private readonly bar: TextFormatBar;
  private open: Session | null = null;
  /** The link dialog has the focus; the box must stay open behind it. */
  private askingLink = false;
  private readonly onSelectionChange = (): void => this.syncSelection();
  private readonly onViewportChange = (): void => this.viewportChanged();
  private readonly onHidden = (): void => {
    if (document.visibilityState === 'hidden') this.commit();
  };

  constructor(private readonly deps: TextBoxEditorDeps) {
    this.frame = new TextBoxFrame(deps.i18n, {
      isPalm: (e) => deps.isPalm(e),
      dragStart: () => this.dragStart(),
      dragMove: (kind, dx, dy) => this.dragMove(kind, dx, dy),
      dragEnd: () => this.dragEnd(),
      dragCancel: () => this.dragCancel(),
      tap: (x, y) => this.frameTapped(x, y),
    });
    this.bar = new TextFormatBar(deps.i18n, deps.menu, {
      format: (patch) => this.format(patch),
      paragraph: (patch) => this.paragraph(patch),
      stepSize: (delta) => this.stepSize(delta),
      link: () => void this.editLink(),
      undo: () => this.undo(),
      redo: () => this.redo(),
      remove: () => this.removeBox(),
      done: () => this.commit(),
      recentColors: () => deps.recentColors(),
      commitColor: (c) => deps.commitColor(c),
    });
    this.listen();
  }

  /** Whether a box is selected or being edited. */
  get active(): boolean {
    return this.open !== null;
  }

  /** Id of the text hidden from a page's bitmap while the DOM shows it. */
  hiddenOn(page: Page): string | null {
    return this.open?.page === page && this.open.original ? this.open.original.id : null;
  }

  /** Starts a new box at page point (x, y), in the last used style. */
  startNew(page: Page, x: number, y: number): void {
    const prefs = this.deps.prefs();
    const place = TextBoxRules.placeNew(x, y, prefs.fs, TextBoxEditor.bounds(page));
    const flags: TextStyle = {};
    for (const key of ['b', 'i', 'u', 's'] as const) if (prefs[key]) flags[key] = true;
    const draft: Draft = {
      id: this.deps.makeId(),
      ...place,
      auto: true,
      fs: prefs.fs,
      c: prefs.c,
      paras: [{ runs: [{ t: '', ...flags }] }],
    };
    this.begin(page, null, draft);
    this.enterEditing(null);
  }

  /** Selects an existing box: frame, handles and bar, with no keyboard yet. */
  select(page: Page, item: TextItem): void {
    const rich = this.deps.texts.migrated(item);
    this.begin(page, item, {
      id: item.id,
      x: rich.x,
      y: rich.y,
      w: rich.w,
      auto: rich.auto === true,
      fs: rich.fs,
      c: rich.c,
      paras: RichText.paragraphsOf(rich),
    });
  }

  /** Follows the camera: keeps the DOM box, frame and bar on the page. */
  position(): void {
    const s = this.open;
    if (!s) return;
    const { camera, layout } = this.deps;
    const z = camera.z;
    const pos = layout.pos(s.page);
    const screen = camera.toScreen(pos.x + s.draft.x, pos.y + s.draft.y);
    const { root } = this;
    root.style.width = s.draft.w + 'px';
    root.style.transform = `translate(${screen.x}px, ${screen.y}px) scale(${z})`;
    const height = root.offsetHeight * z;
    const width = s.draft.w * z;
    this.frame.place(screen.x, screen.y, width, height, s.editing);
    const stage = root.parentElement?.getBoundingClientRect();
    const left = (stage?.left ?? 0) + screen.x;
    const top = (stage?.top ?? 0) + screen.y;
    this.bar.place({ left, top, right: left + width, bottom: top + height });
  }

  /** Saves what is open and closes it. An empty box goes away. */
  commit(): void {
    const s = this.open;
    if (!s) return;
    this.reconcile(s);
    this.open = null;
    this.hideUi();
    this.save(s, true);
  }

  /** Closes the box, taking the on-screen keyboard with it. */
  blur(): void {
    this.commit();
  }

  /** Deletes the selected box, if one is selected but not being edited. */
  removeSelected(): boolean {
    if (!this.open || this.open.editing) return false;
    this.removeBox();
    return true;
  }

  /** Keys for a selected box: B, I, U with Ctrl, Escape. Returns whether it used the key. */
  handleKey(e: KeyboardEvent): boolean {
    const s = this.open;
    if (!s || s.editing) return false;
    if (e.key === 'Escape') {
      this.commit();
      return true;
    }
    return this.formatShortcut(e);
  }

  applyLanguage(): void {
    this.root.setAttribute('aria-label', this.deps.i18n.t('text'));
    this.frame.applyLanguage();
    this.bar.applyLanguage();
  }

  /** Removes the document listeners. */
  destroy(): void {
    document.removeEventListener('selectionchange', this.onSelectionChange);
    document.removeEventListener('visibilitychange', this.onHidden);
    window.visualViewport?.removeEventListener('resize', this.onViewportChange);
    window.visualViewport?.removeEventListener('scroll', this.onViewportChange);
    this.frame.destroy();
  }

  private listen(): void {
    const { root } = this;
    root.addEventListener('input', (e) => this.onInput(e as InputEvent));
    root.addEventListener('beforeinput', (e) => this.onBeforeInput(e));
    root.addEventListener('keydown', (e) => this.onKeyDown(e));
    root.addEventListener('paste', (e) => this.onPaste(e));
    root.addEventListener('drop', (e) => e.preventDefault());
    root.addEventListener('dragover', (e) => e.preventDefault());
    root.addEventListener('compositionstart', () => {
      if (this.open) this.open.composing = true;
    });
    root.addEventListener('compositionend', () => this.onCompositionEnd());
    root.addEventListener('focusout', (e) => {
      if (this.askingLink) return;
      if (this.open?.editing && !this.bar.owns(e.relatedTarget)) this.commit();
    });
    document.addEventListener('selectionchange', this.onSelectionChange);
    document.addEventListener('visibilitychange', this.onHidden);
    window.visualViewport?.addEventListener('resize', this.onViewportChange);
    window.visualViewport?.addEventListener('scroll', this.onViewportChange);
  }

  private begin(page: Page, original: TextItem | null, draft: Draft): void {
    this.commit();
    this.open = {
      page,
      original,
      draft,
      saved: TextBoxEditor.fingerprint(draft),
      editing: false,
      history: new TextEditHistory<EditState>(),
      selection: { start: 0, end: 0 },
      pending: null,
      composing: false,
      dragStart: null,
    };
    this.root.hidden = false;
    this.root.contentEditable = 'false';
    this.root.classList.remove('text-editor--editing');
    TextDomCodec.render(this.root, draft.paras, draft);
    this.deps.session.bump(page);
    this.bar.show(this.barState());
    this.fit();
  }

  private enterEditing(point: { x: number; y: number } | null): void {
    const s = this.open;
    if (!s) return;
    s.editing = true;
    this.root.contentEditable = 'true';
    this.root.classList.add('text-editor--editing');
    this.root.focus({ preventScroll: true });
    const length = RichText.length(s.draft.paras);
    const offset = point ? TextDomCodec.offsetFromPoint(this.root, point.x, point.y) : null;
    const at = clamp(offset ?? length, 0, length);
    s.selection = { start: at, end: at };
    TextDomCodec.select(this.root, s.selection);
    this.refreshBar();
    this.position();
    this.revealCaret();
  }

  private hideUi(): void {
    const { root } = this;
    root.contentEditable = 'false';
    root.classList.remove('text-editor--editing');
    root.hidden = true;
    root.blur();
    this.frame.hide();
    this.bar.hide();
  }

  /** Writes the draft to the page as one undo step, if anything changed. */
  private save(s: Session, closing: boolean): void {
    const { session } = this.deps;
    const page = s.page;
    const paras = RichText.trimmedEnd(s.draft.paras);
    const blank = RichText.isBlank(paras);
    const unchanged = TextBoxEditor.fingerprint({ ...s.draft, paras }) === s.saved;
    if ((unchanged && !blank) || (blank && !s.original)) {
      if (closing) session.bump(page);
      return;
    }
    this.deps.recordUndo(page);
    const index = s.original ? page.texts.findIndex((t) => t.id === s.original?.id) : -1;
    const item = blank ? null : this.finalItem(s, paras);
    if (!item) {
      if (index >= 0) page.texts.splice(index, 1);
    } else if (index >= 0) page.texts[index] = item;
    else page.texts.push(item);
    session.touch(page);
    if (!closing && item) {
      s.original = item;
      s.saved = TextBoxEditor.fingerprint(s.draft);
    }
  }

  private finalItem(s: Session, paras: TextParagraph[]): TextItem {
    const { texts } = this.deps;
    const d = s.draft;
    const item: TextItem = {
      id: d.id,
      x: d.x,
      y: d.y,
      w: d.w,
      t: RichText.plainText(paras),
      fs: d.fs,
      c: d.c,
      paras,
    };
    if (!d.auto) return item;
    item.auto = true;
    const bounds = TextBoxEditor.bounds(s.page);
    item.w = TextBoxRules.autoWidth(texts.naturalWidth(item), item.x, item.fs, bounds);
    return item;
  }

  private removeBox(): void {
    const s = this.open;
    if (!s) return;
    this.open = null;
    this.hideUi();
    const index = s.original ? s.page.texts.findIndex((t) => t.id === s.original?.id) : -1;
    if (index < 0) {
      this.deps.session.bump(s.page);
      return;
    }
    this.deps.recordUndo(s.page);
    s.page.texts.splice(index, 1);
    this.deps.session.touch(s.page);
  }

  /** Width and position from the rules, for the text as it is now. */
  private fit(): void {
    const s = this.open;
    if (!s) return;
    const d = s.draft;
    const bounds = TextBoxEditor.bounds(s.page);
    const { texts } = this.deps;
    const item = TextBoxEditor.itemOf(d);
    if (d.auto) d.w = TextBoxRules.autoWidth(texts.naturalWidth(item), d.x, d.fs, bounds);
    const height = texts.box({ ...item, w: d.w }).y1 - d.y;
    const kept = TextBoxRules.keptInside(d, height, bounds);
    d.x = kept.x;
    d.y = kept.y;
    d.w = kept.w;
    this.position();
  }

  private static itemOf(d: Draft): TextItem {
    return {
      id: d.id,
      x: d.x,
      y: d.y,
      w: d.w,
      t: RichText.plainText(d.paras),
      fs: d.fs,
      c: d.c,
      paras: d.paras,
    };
  }

  private static fingerprint(d: Draft): string {
    return JSON.stringify([d.x, d.y, d.w, d.auto, d.fs, d.c, RichText.trimmedEnd(d.paras)]);
  }

  private static bounds(page: Page): PageBounds {
    return { width: page.w * MM, height: page.h * MM };
  }

  /* ---------- typing ---------- */

  private onInput(e: InputEvent): void {
    const s = this.open;
    if (!s?.editing) return;
    const paras = TextDomCodec.parse(this.root);
    if (RichText.length(paras) > MAX_LEN.text) {
      this.deps.toast(this.deps.i18n.t('textTooLong'));
      TextDomCodec.render(this.root, s.draft.paras, s.draft);
      TextDomCodec.select(this.root, s.selection);
      return;
    }
    const data = e.data ?? '';
    s.history.record(
      this.editState(s),
      'typing',
      e.timeStamp,
      /\s$/.test(data) || e.inputType === 'insertParagraph',
    );
    s.draft = { ...s.draft, paras };
    if (s.composing || TextDomCodec.isCanonical(this.root)) TextDomCodec.syncMarkers(this.root, paras);
    else this.rerender(s);
    this.syncSelection();
    this.fit();
    this.refreshBar();
    this.revealCaret();
  }

  private onCompositionEnd(): void {
    const s = this.open;
    if (!s) return;
    s.composing = false;
    this.reconcile(s);
  }

  /** Reads the DOM once more and puts it in order; a browser may leave odd markup after typing. */
  private reconcile(s: Session): void {
    if (!s.editing) return;
    s.draft = { ...s.draft, paras: TextDomCodec.parse(this.root) };
    if (!s.composing && !TextDomCodec.isCanonical(this.root)) this.rerender(s);
  }

  private rerender(s: Session): void {
    const range = TextDomCodec.selection(this.root) ?? s.selection;
    TextDomCodec.render(this.root, s.draft.paras, s.draft);
    TextDomCodec.select(this.root, range);
    s.selection = range;
  }

  private onBeforeInput(e: InputEvent): void {
    const s = this.open;
    if (!s?.editing) return;
    switch (e.inputType) {
      case 'historyUndo':
        e.preventDefault();
        this.undo();
        return;
      case 'historyRedo':
        e.preventDefault();
        this.redo();
        return;
      case 'insertFromPaste':
      case 'insertFromDrop':
      case 'insertFromYank':
      case 'formatBold':
      case 'formatItalic':
      case 'formatUnderline':
      case 'formatStrikeThrough':
      case 'formatFontColor':
      case 'formatFontName':
        e.preventDefault();
        return;
      case 'insertLineBreak':
        e.preventDefault();
        this.insertPlain('\n');
        return;
      case 'insertParagraph':
        this.leaveEmptyListItem(s, e);
        return;
    }
  }

  /** Enter on an empty list item ends the list, as in every word processor. */
  private leaveEmptyListItem(s: Session, e: InputEvent): void {
    const range = TextDomCodec.selection(this.root) ?? s.selection;
    const para = RichText.paragraphAt(s.draft.paras, range.start);
    if (!para?.list || para.runs.some((run) => run.t)) return;
    e.preventDefault();
    this.paragraph({ list: null });
  }

  private onKeyDown(e: KeyboardEvent): void {
    const s = this.open;
    if (!s?.editing) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.commit();
      return;
    }
    if (this.formatShortcut(e)) return;
    if (!(e.ctrlKey || e.metaKey)) return;
    const key = e.key.toLowerCase();
    if (key === 'z' && !e.shiftKey) {
      e.preventDefault();
      this.undo();
    } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
      e.preventDefault();
      this.redo();
    }
  }

  private formatShortcut(e: KeyboardEvent): boolean {
    if (!(e.ctrlKey || e.metaKey) || e.shiftKey) return false;
    this.syncSelection();
    const flag = ({ b: 'b', i: 'i', u: 'u' } as const)[e.key.toLowerCase() as 'b' | 'i' | 'u'];
    if (!flag) return false;
    e.preventDefault();
    this.format({ [flag]: !this.barState().style[flag] });
    return true;
  }

  /** Pasted content becomes plain text. Nothing from the clipboard reaches the DOM as markup. */
  private onPaste(e: ClipboardEvent): void {
    e.preventDefault();
    if (this.open?.editing) this.insertPlain(PastedText.clean(e.clipboardData?.getData('text/plain') ?? ''));
  }

  private insertPlain(text: string): void {
    const s = this.open;
    if (!s) return;
    const range = TextDomCodec.selection(this.root) ?? s.selection;
    const room = MAX_LEN.text - (RichText.length(s.draft.paras) - (range.end - range.start));
    const fitted = PastedText.limited(text, room);
    if (fitted.length < text.length) this.deps.toast(this.deps.i18n.t('textTooLong'));
    if (!fitted) return;
    const style = { ...RichText.commonStyle(s.draft.paras, range.start, range.start) };
    s.history.record(this.editState(s), 'other', performance.now());
    const paras = RichText.replaceRange(s.draft.paras, range.start, range.end, fitted, style);
    s.draft = { ...s.draft, paras };
    const at = range.start + fitted.length;
    s.selection = { start: at, end: at };
    TextDomCodec.render(this.root, paras, s.draft);
    TextDomCodec.select(this.root, s.selection);
    this.fit();
    this.refreshBar();
    this.revealCaret();
  }

  private syncSelection(): void {
    const s = this.open;
    if (!s?.editing || document.activeElement !== this.root) return;
    const range = TextDomCodec.selection(this.root);
    if (!range) return;
    if (range.start !== s.selection.start || range.end !== s.selection.end) s.pending = null;
    s.selection = range;
    this.refreshBar();
  }

  private editState(s: Session): EditState {
    return { draft: s.draft, selection: { ...s.selection } };
  }

  /* ---------- formatting ---------- */

  private format(patch: StylePatch): void {
    const s = this.open;
    if (!s) return;
    this.rememberStyle(patch);
    this.deps.menu.close();
    if (!s.editing) {
      const length = RichText.length(s.draft.paras);
      const paras = RichText.applyStyle(s.draft.paras, 0, length, patch);
      s.draft = { ...s.draft, paras };
      this.afterFormat(s);
      return;
    }
    this.focusEditor(s);
    // The browser reports a selection change a moment later; a shortcut can come first.
    s.selection = TextDomCodec.selection(this.root) ?? s.selection;
    const range = s.selection;
    s.history.record(this.editState(s), 'other', performance.now());
    if (range.start === range.end && !this.atEmptyParagraph(s, range.start)) {
      this.formatAtCaret(s, patch);
      return;
    }
    const paras = RichText.applyStyle(s.draft.paras, range.start, range.end, patch);
    s.draft = { ...s.draft, paras };
    this.afterFormat(s);
  }

  /** At a caret there is nothing to style yet: the style waits for what is typed next. */
  private formatAtCaret(s: Session, patch: StylePatch): void {
    const offset = s.selection.start;
    s.pending = { ...s.pending, ...patch };
    const before = RichText.commonStyle(s.draft.paras, offset, offset);
    const style = RichText.styleOf(
      RichText.applyStyle([{ runs: [{ ...before, t: ' ' }] }], 0, 1, s.pending)[0]?.runs[0] ?? {},
    );
    TextDomCodec.render(this.root, s.draft.paras, s.draft);
    TextDomCodec.select(this.root, s.selection);
    TextDomCodec.insertCaretRun(this.root, offset, style, s.draft);
    this.refreshBar();
  }

  private atEmptyParagraph(s: Session, offset: number): boolean {
    return RichText.paragraphAt(s.draft.paras, offset)?.runs.every((run) => !run.t) ?? false;
  }

  private paragraph(patch: ParagraphPatch): void {
    const s = this.open;
    if (!s) return;
    this.deps.menu.close();
    if (s.editing) s.selection = TextDomCodec.selection(this.root) ?? s.selection;
    const range = s.editing ? s.selection : { start: 0, end: RichText.length(s.draft.paras) };
    if (s.editing) {
      this.focusEditor(s);
      s.history.record(this.editState(s), 'other', performance.now());
    }
    const paras = RichText.applyParagraph(s.draft.paras, range.start, range.end, patch);
    s.draft = { ...s.draft, paras };
    this.afterFormat(s);
  }

  private stepSize(delta: number): void {
    const size = clamp(this.barState().size + delta, LIMITS.fontSize[0], LIMITS.fontSize[1]);
    this.format({ fs: size });
  }

  /**
   * What the link button works on, with the link already there if any: the whole box when it is
   * only selected, the selection while editing, or the link the caret is in. Null: nothing to link.
   */
  private linkRange(s: Session): { start: number; end: number; link?: LinkTarget } | null {
    const paras = s.draft.paras;
    if (!s.editing) {
      const end = RichText.length(paras);
      return { start: 0, end, ...TextBoxEditor.commonLink(paras, 0, end) };
    }
    const { start, end } = s.selection;
    if (start === end) return RichText.linkRangeAt(paras, start);
    return { start, end, ...TextBoxEditor.commonLink(paras, start, end) };
  }

  private static commonLink(
    paras: readonly TextParagraph[],
    start: number,
    end: number,
  ): { link?: LinkTarget } {
    const { link } = RichText.commonStyle(paras, start, end);
    return link ? { link } : {};
  }

  /** The dialog takes the focus (and on a tablet closes the keyboard), so the box waits behind it. */
  private async editLink(): Promise<void> {
    const s = this.open;
    if (!s) return;
    this.deps.menu.close();
    if (s.editing) s.selection = TextDomCodec.selection(this.root) ?? s.selection;
    const range = this.linkRange(s);
    if (!range) {
      this.deps.toast(this.deps.i18n.t('linkSelectText'));
      return;
    }
    this.askingLink = true;
    const choice = await this.deps
      .askLink({ href: range.link?.href, canRemove: range.link !== undefined })
      .finally(() => (this.askingLink = false));
    if (this.open !== s) return;
    if (s.editing) this.focusEditor(s);
    if (!choice) return;
    if (s.editing) s.history.record(this.editState(s), 'other', performance.now());
    const link: LinkTarget | null = choice.kind === 'remove' ? null : { kind: 'url', href: choice.href };
    const paras = RichText.applyStyle(s.draft.paras, range.start, range.end, { link });
    s.draft = { ...s.draft, paras };
    this.afterFormat(s);
  }

  /** After a format: the DOM, the box and, for a selected box, the page. */
  private afterFormat(s: Session): void {
    TextDomCodec.render(this.root, s.draft.paras, s.draft);
    if (s.editing) TextDomCodec.select(this.root, s.selection);
    this.fit();
    if (!s.editing) this.save(s, false);
    this.refreshBar();
  }

  private focusEditor(s: Session): void {
    if (document.activeElement === this.root) return;
    this.root.focus({ preventScroll: true });
    TextDomCodec.select(this.root, s.selection);
  }

  /** The last used style is the default for new boxes. */
  private rememberStyle(patch: StylePatch): void {
    const prefs = this.deps.prefs();
    const next = RichText.patchedStyle(prefs, patch);
    for (const key of ['b', 'i', 'u', 's'] as const) Reflect.deleteProperty(prefs, key);
    Object.assign(prefs, next);
    this.deps.savePrefs();
  }

  private barState(): FormatState {
    const s = this.open;
    if (!s) {
      return { style: {}, size: 0, align: 'left', list: null, link: false, canUndo: false, canRedo: false };
    }
    const d = s.draft;
    const range = s.editing ? s.selection : { start: 0, end: RichText.length(d.paras) };
    const style = RichText.patchedStyle(
      { fs: d.fs, c: d.c, ...RichText.commonStyle(d.paras, range.start, range.end) } as TextStyle,
      s.pending ?? {},
    );
    const para = RichText.paragraphAt(d.paras, range.start);
    const first = para?.runs[0];
    const mixedSize =
      RichText.commonStyle(d.paras, range.start, range.end).fs === undefined && range.start !== range.end;
    return {
      style: TextBoxEditor.mixedColor(d, range, style),
      size: style.fs ?? (mixedSize ? (first?.fs ?? d.fs) : d.fs),
      align: para?.align ?? 'left',
      list: para?.list ?? null,
      link: this.linkRange(s)?.link !== undefined,
      canUndo: s.editing ? s.history.canUndo : this.deps.canUndoPage(),
      canRedo: s.editing ? s.history.canRedo : this.deps.canRedoPage(),
    };
  }

  /** Several colours in the selection show as no colour at all. */
  private static mixedColor(d: Draft, range: TextRange, style: TextStyle): TextStyle {
    const runs = RichText.applyStyle(d.paras, range.start, range.end, {});
    const colors = new Set<string>();
    let at = 0;
    for (const para of runs) {
      for (const run of para.runs) {
        const stop = at + run.t.length;
        if (run.t && at < range.end && stop > range.start) colors.add(run.c ?? d.c);
        at = stop;
      }
      at += 1;
    }
    if (colors.size <= 1) return style;
    const { c: _mixed, ...rest } = style;
    return rest;
  }

  private refreshBar(): void {
    if (this.open) this.bar.show(this.barState());
  }

  /* ---------- undo inside a box ---------- */

  private undo(): void {
    const s = this.open;
    if (!s) return;
    if (!s.editing) {
      this.deps.undoPage();
      return;
    }
    this.restore(s, s.history.undo(this.editState(s)));
  }

  private redo(): void {
    const s = this.open;
    if (!s) return;
    if (!s.editing) {
      this.deps.redoPage();
      return;
    }
    this.restore(s, s.history.redo(this.editState(s)));
  }

  private restore(s: Session, state: EditState | null): void {
    if (!state) return;
    this.focusEditor(s);
    s.draft = state.draft;
    s.selection = state.selection;
    s.pending = null;
    TextDomCodec.render(this.root, s.draft.paras, s.draft);
    TextDomCodec.select(this.root, s.selection);
    this.fit();
    this.refreshBar();
  }

  /* ---------- moving and resizing ---------- */

  private frameTapped(x: number, y: number): void {
    const s = this.open;
    if (s && !s.editing) this.enterEditing({ x, y });
  }

  private dragStart(): void {
    const s = this.open;
    if (!s) return;
    if (s.editing) s.history.record(this.editState(s), 'other', performance.now());
    s.dragStart = { x: s.draft.x, y: s.draft.y, w: s.draft.w };
  }

  private dragMove(kind: FrameDragKind, dx: number, dy: number): void {
    const s = this.open;
    if (!s?.dragStart) return;
    const z = this.deps.camera.z;
    const bounds = TextBoxEditor.bounds(s.page);
    const start = s.dragStart;
    if (kind === 'move') {
      s.draft = { ...s.draft, x: start.x + dx / z, y: start.y + dy / z };
    } else {
      const next = TextBoxRules.resized(start, kind, dx / z, bounds);
      s.draft = { ...s.draft, x: next.x, w: next.w, auto: false };
    }
    this.fit();
  }

  private dragEnd(): void {
    const s = this.open;
    if (!s) return;
    s.dragStart = null;
    if (!s.editing) this.save(s, false);
    this.refreshBar();
  }

  private dragCancel(): void {
    const s = this.open;
    if (!s?.dragStart) return;
    s.draft = { ...s.draft, x: s.dragStart.x, y: s.dragStart.y, w: s.dragStart.w };
    s.dragStart = null;
    this.fit();
  }

  /* ---------- the on-screen keyboard ---------- */

  private viewportChanged(): void {
    if (!this.open) return;
    this.position();
    this.revealCaret();
  }

  /**
   * Scrolls the page if the caret would end up under the on-screen keyboard or the bar. The
   * visual viewport is what the keyboard leaves free.
   */
  private revealCaret(): void {
    const s = this.open;
    const view = window.visualViewport;
    if (!s?.editing || !view) return;
    const selection = document.getSelection();
    if (!selection?.rangeCount) return;
    const rect = selection.getRangeAt(0).getClientRects()[0] ?? this.root.getBoundingClientRect();
    const limit = view.offsetTop + view.height - this.bar.height - CARET_MARGIN;
    if (rect.bottom <= limit) return;
    const { camera, layout } = this.deps;
    camera.y += (rect.bottom - limit) / camera.z;
    camera.clampTo(layout);
    this.deps.redraw();
  }
}
