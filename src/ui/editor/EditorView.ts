import type { EventBus } from '../../app/EventBus';
import { ZOOM_MAX, ZOOM_MIN } from '../../core/constants';
import type { Language, Notebook, Page, Preferences, ToolKind } from '../../core/types';
import { byId } from '../../core/utils/dom';
import { clamp } from '../../core/utils/math';
import { ColorLists } from '../../domain/ColorLists';
import { PageSizePolicy } from '../../domain/PageSizePolicy';
import type { PageSizes } from '../../domain/PageSizes';
import { EditorCanvas, type EditorCanvasHooks } from '../../editor/EditorCanvas';
import { PageOperations } from '../../editor/PageOperations';
import { ImageInserter } from '../../features/images/ImageInserter';
import { ImageRejectedError, type ImageEncoder } from '../../features/images/ImageEncoder';
import type { PdfImporter } from '../../features/pdf/PdfImporter';
import { PdfExporter } from '../../features/pdf/PdfExporter';
import type { I18n } from '../../i18n/I18n';
import { KeyboardShortcuts } from '../../input/KeyboardShortcuts';
import type { BlobRepository } from '../../storage/BlobRepository';
import type { PageRepository } from '../../storage/PageRepository';
import type { SaveQueue } from '../../storage/SaveQueue';
import type { Tool } from '../../tools/Tool';
import type { DialogFactory } from '../dialogs/DialogFactory';
import type { Menu, MenuEntry } from '../dialogs/Menu';
import { PageSettingsDialog } from '../dialogs/PageSettingsDialog';
import type { Toast } from '../dialogs/Toast';
import { icon } from '../icons';
import { languageMenu, languageShort } from '../widgets/languageMenu';
import { PagesPanel } from './PagesPanel';
import { RulerWidget } from './RulerWidget';
import { SelectionBar } from './SelectionBar';
import { TextEditorOverlay } from './TextEditorOverlay';
import { ToolOptionsPopover } from './ToolOptionsPopover';
import { ToolTray } from './ToolTray';
import { TopBar } from './TopBar';

/** What the editor asks of the rest of the app. */
export interface EditorActions {
  closed(): void;
  editNotebook(nb: Notebook): void;
  exportPdf(nb: Notebook): void;
  setLanguage(language: Language): void;
  subjectName(subjectId: string): string;
}

export interface EditorViewDeps {
  i18n: I18n;
  bus: EventBus;
  prefs: Preferences;
  savePrefs: () => void;
  sizes: PageSizes;
  menu: Menu;
  dialogs: DialogFactory;
  toast: Toast;
  pages: PageRepository;
  blobs: BlobRepository;
  saveQueue: SaveQueue;
  imageEncoder: ImageEncoder;
  pdfImporter: PdfImporter;
  makeId: () => string;
  actions: EditorActions;
  onStorageError: (error: unknown) => void;
}

/** The notebook editor screen. */
export class EditorView {
  private readonly root = byId('editor');
  private readonly fab = byId<HTMLButtonElement>('fab');
  private readonly canvas: EditorCanvas;
  private readonly topBar: TopBar;
  private readonly tray: ToolTray;
  private readonly popover: ToolOptionsPopover;
  private readonly panel: PagesPanel;
  private readonly selectionBar: SelectionBar;
  private readonly textEditor: TextEditorOverlay;
  private readonly rulerWidget: RulerWidget;
  private readonly pageOps: PageOperations;
  private readonly pageSettings: PageSettingsDialog;
  private readonly images: ImageInserter;
  private readonly exporter: PdfExporter;

  constructor(private readonly deps: EditorViewDeps) {
    const { i18n, sizes, menu } = deps;
    this.canvas = new EditorCanvas({
      i18n,
      prefs: deps.prefs,
      savePrefs: deps.savePrefs,
      blobs: deps.blobs,
      saveQueue: deps.saveQueue,
      makeId: deps.makeId,
      hooks: this.hooks(),
    });
    const c = this.canvas;
    this.textEditor = new TextEditorOverlay({
      camera: c.camera,
      layout: c.layout,
      session: c.session,
      prefs: () => deps.prefs.txt,
      makeId: deps.makeId,
      recordUndo: (page) => c.undo.record(page),
    });
    this.topBar = new TopBar(i18n, sizes, this.topBarHandlers());
    this.tray = new ToolTray(i18n, {
      tool: (kind, button) => this.onToolButton(kind, button),
      toolOptions: (kind) => this.openToolOptions(kind),
      swatch: (color) => this.onSwatch(color),
      swatchMenu: (index, button) => this.openSwatchMenu(index, button),
      ruler: () => this.toggleRuler(),
    });
    this.popover = new ToolOptionsPopover(c.stage, c.camera, () => this.tray.rect(), deps.bus);
    this.selectionBar = new SelectionBar(i18n, menu, {
      recolor: (color) => c.selection.recolor(color),
      duplicate: () => c.selection.duplicate(),
      remove: () => c.selection.remove(),
      deselect: () => c.selection.clear(),
    });
    this.rulerWidget = new RulerWidget(c.ruler, c.camera, c.theme, i18n, (e) => c.router.down(e));
    this.pageOps = this.createPageOperations();
    this.panel = this.createPagesPanel();
    this.pageSettings = new PageSettingsDialog({
      i18n,
      sizes,
      dialogs: deps.dialogs,
      session: c.session,
      pages: this.pageOps,
    });
    this.images = new ImageInserter({
      encoder: deps.imageEncoder,
      blobs: deps.blobs,
      bitmaps: c.bitmaps,
      camera: c.camera,
      layout: c.layout,
      makeId: deps.makeId,
    });
    this.exporter = new PdfExporter({
      painter: c.painter,
      bitmaps: c.bitmaps,
      i18n,
      notify: (m, ms) => deps.toast.show(m, ms),
    });
    this.fab.append(icon('plus', 26));
    this.fab.addEventListener('click', () => this.pageOps.add());
    new KeyboardShortcuts(this.shortcutHandlers());
    this.watchEnvironment();
  }

  /* ---------- wiring ---------- */

  private hooks(): EditorCanvasHooks {
    const d = this.deps;
    return {
      afterRender: () => this.afterRender(),
      onSelectionChange: (state) => {
        if (state) {
          this.selectionBar.show();
          this.positionOverlays();
        } else this.selectionBar.hide();
      },
      onUndoState: (u, r) => this.topBar.setUndoState(u, r),
      onRestored: (_page, resized) => {
        if (resized) this.canvas.viewport.relayout();
        this.refreshPanel();
      },
      onToolChange: (tool) => this.onToolChange(tool),
      onBitmapLoaded: () =>
        this.panel.refreshSoon(this.canvas.session.pages, this.canvas.session.currentIndex),
      beforePointerDown: () => this.beforePointerDown(),
      onPenSeen: () => this.onPenSeen(),
      onTwoFingerTap: () => {
        if (this.canvas.undo.undo()) d.toast.show(d.i18n.t('undone'), 1000);
      },
      settle: () => this.settle(),
      hiddenTextOn: (page) => this.textEditor.hiddenOn(page),
      editText: (page, item, x, y) => this.textEditor.start(page, item, x, y),
      setTool: (kind) => this.setTool(kind),
      refreshTray: () => this.renderTray(),
      toast: (message, ms) => d.toast.show(message, ms),
      confirm: (title, text, ok) => {
        this.popover.close();
        return d.dialogs.confirm(title, text, ok);
      },
    };
  }

  private topBarHandlers() {
    const c = (): EditorCanvas => this.canvas;
    return {
      back: () => void this.close(),
      title: () => this.deps.actions.editNotebook(c().session.nb),
      zoom: () => c().viewport.fitWidth(),
      lock: () => this.openPageSettings(c().session.currentPage()),
      pages: () => {
        if (this.panel.toggle()) this.refreshPanel();
      },
      undo: () => c().undo.undo(),
      redo: () => c().undo.redo(),
      more: (anchor: HTMLElement) => this.deps.menu.show(anchor, this.moreMenu()),
    };
  }

  private createPageOperations(): PageOperations {
    const c = this.canvas;
    const d = this.deps;
    return new PageOperations({
      session: c.session,
      viewport: c.viewport,
      undo: c.undo,
      cache: c.cache,
      blobs: d.blobs,
      pages: d.pages,
      saveQueue: d.saveQueue,
      i18n: d.i18n,
      sizes: d.sizes,
      makeId: d.makeId,
      toast: (message, ms) => d.toast.show(message, ms),
      confirm: (title, text) => d.dialogs.confirm(title, text),
      settle: () => this.settle(),
      forgetSelectionOn: (page) => {
        if (c.selection.current?.page === page) c.selection.clear();
      },
      onPagesChanged: () => this.refreshPanel(),
      onError: d.onStorageError,
    });
  }

  private createPagesPanel(): PagesPanel {
    const c = this.canvas;
    return new PagesPanel(this.deps.i18n, this.deps.sizes, this.deps.menu, c.painter, () => c.camera.dpr, {
      goTo: (page) => {
        c.viewport.scrollTo(page);
        if (c.camera.width < 700) this.panel.hide();
      },
      addAfter: (page) => this.pageOps.add(page),
      addAtEnd: () => this.pageOps.add(c.session.pages[c.session.pages.length - 1]),
      settings: (page) => this.openPageSettings(page),
      duplicate: (page) => this.pageOps.duplicate(page),
      remove: (page) => void this.pageOps.delete(page),
      move: (page, dir) => this.pageOps.move(page, dir),
    });
  }

  private shortcutHandlers() {
    const c = this.canvas;
    return {
      enabled: () => !this.root.hidden && c.session.isOpen,
      undo: () => void c.undo.undo(),
      redo: () => void c.undo.redo(),
      deleteSelection: () => {
        if (!c.selection.current) return false;
        c.selection.remove();
        return true;
      },
      escape: () => {
        c.selection.clear();
        this.popover.close();
      },
      setTool: (kind: ToolKind) => this.setTool(kind),
    };
  }

  /** Resize, theme and font events. */
  private watchEnvironment(): void {
    const c = this.canvas;
    const onResize = (): void => {
      if (this.root.hidden) return;
      c.resize();
      c.camera.clampTo(c.layout);
      c.renderer.render();
    };
    new ResizeObserver(onResize).observe(c.stage);
    window.addEventListener('resize', onResize);
    const themeChanged = (): void => {
      c.theme.read();
      this.rulerWidget.invalidate();
      c.renderer.request();
    };
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', themeChanged);
    new MutationObserver(themeChanged).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    void document.fonts?.ready.then(() => {
      c.texts.reset();
      for (const page of c.session.pages) c.session.bump(page);
      this.rulerWidget.invalidate();
    });
    c.theme.read();
  }

  /* ---------- open / close ---------- */

  get isOpen(): boolean {
    return this.canvas.session.isOpen;
  }

  /** The open notebook's pages if `nb` is open (for PDF export of unsaved state). */
  pagesOf(nb: Notebook): Page[] | null {
    return this.canvas.session.notebook === nb ? this.canvas.session.pages : null;
  }

  /** Renders pages (of any notebook) into a PDF file. */
  renderPdf(pages: readonly Page[]): Promise<Blob | null> {
    return this.exporter.export(pages);
  }

  /** Opens a notebook in the editor. Returns false if its pages could not be loaded. */
  async open(nb: Notebook): Promise<boolean> {
    const c = this.canvas;
    this.deps.menu.close();
    let pages: Page[];
    try {
      pages = await this.deps.pages.loadOrdered(nb);
    } catch (error) {
      this.deps.onStorageError(error);
      return false;
    }
    const created = !pages.length;
    if (created) pages = [PageSizePolicy.newPageAfter(nb, null, this.deps.makeId)];
    for (const p of pages) PageSizePolicy.enforceLock(p, nb.base);
    nb.pageIds = pages.map((p) => p.id);
    c.cache.clear();
    c.undo.clear();
    c.session.open(nb, pages);
    this.deps.saveQueue.setNotebook(nb);
    if (created) pages.forEach((p) => this.deps.saveQueue.markPageDirty(p));
    this.show();
    this.placeCamera(nb);
    this.topBar.setTitle(nb.title, this.deps.actions.subjectName(nb.subjectId));
    this.renderTray();
    c.renderer.render();
    return true;
  }

  private show(): void {
    const c = this.canvas;
    this.root.hidden = false;
    document.body.classList.add('is-editing');
    this.panel.hide();
    c.renderer.setEnabled(true);
    c.resize();
    c.layout.update(c.session.pages);
  }

  private placeCamera(nb: Notebook): void {
    const c = this.canvas;
    c.camera.z = nb.view?.z ? clamp(nb.view.z, ZOOM_MIN, ZOOM_MAX) : c.camera.fitZoom(c.layout);
    c.camera.centerX();
    const target = (nb.view?.pageId && c.session.find(nb.view.pageId)) || c.session.pages[0];
    if (target) c.viewport.scrollTo(target);
    if (c.ruler.on) c.ruler.placeDefault(c.camera.width, c.camera.height);
  }

  /** Saves and returns to the shelf. */
  async close(): Promise<void> {
    const c = this.canvas;
    this.settle();
    this.popover.close();
    this.deps.menu.close();
    if (c.session.notebook) {
      const page = c.session.currentPage();
      c.session.notebook.view = { pageId: page ? page.id : null, z: c.camera.z };
    }
    await this.deps.saveQueue.flush(true);
    c.session.close();
    this.deps.saveQueue.setNotebook(null);
    c.cache.clear();
    c.renderer.setEnabled(false);
    this.root.hidden = true;
    document.body.classList.remove('is-editing');
    this.deps.actions.closed();
  }

  /** Applies notebook-dialog changes to the open notebook. */
  notebookUpdated(nb: Notebook, baseChanged: boolean): void {
    if (this.canvas.session.notebook !== nb) return;
    if (baseChanged) this.pageOps.applyBase();
    this.topBar.setTitle(nb.title, this.deps.actions.subjectName(nb.subjectId));
  }

  /* ---------- per-frame updates ---------- */

  private afterRender(): void {
    const c = this.canvas;
    c.live.render();
    this.positionOverlays();
    const page = c.session.currentPage();
    if (page) this.topBar.update(page, c.session.currentIndex, c.session.pages.length, c.camera.z);
    this.panel.highlight(c.session.currentIndex);
    this.deps.bus.emit('page-changed', { index: c.session.currentIndex, count: c.session.pages.length });
  }

  private positionOverlays(): void {
    const c = this.canvas;
    this.textEditor.position();
    this.rulerWidget.position();
    if (c.selection.current && this.selectionBar.visible) {
      this.selectionBar.position(c.selection.screenBox(), c.camera.width, c.camera.height);
    }
  }

  private refreshPanel(): void {
    this.panel.render(this.canvas.session.pages, this.canvas.session.currentIndex);
  }

  /* ---------- tools ---------- */

  private settle(): void {
    this.textEditor.commit();
    this.canvas.selection.clear();
  }

  setTool(kind: ToolKind): void {
    this.textEditor.commit();
    this.popover.close();
    if (kind !== 'lasso') this.canvas.selection.clear();
    this.canvas.tools.select(kind);
  }

  private onToolChange(tool: Tool): void {
    this.renderTray();
    this.canvas.applyCursor(tool);
  }

  private renderTray(): void {
    this.tray.render(this.canvas.tools.kind, this.deps.prefs, this.canvas.ruler.on);
  }

  /** A tap on a tool: select it, or, if it is active, let it react (eraser) or toggle its options. */
  private onToolButton(kind: ToolKind, button: HTMLButtonElement): void {
    const tools = this.canvas.tools;
    if (tools.kind !== kind) {
      this.setTool(kind);
      return;
    }
    if (tools.current.onActiveTap()) this.popover.close();
    else this.popover.toggle(button, tools.current);
  }

  /** A long press on a tool: select it if needed and open its options. */
  private openToolOptions(kind: ToolKind): void {
    if (this.canvas.tools.kind !== kind) this.setTool(kind);
    const button = this.tray.buttonFor(kind);
    if (button) this.popover.open(button, this.canvas.tools.current);
  }

  private onSwatch(color: string): void {
    const { prefs } = this.deps;
    prefs.brushes[prefs.brush].c = color;
    this.deps.savePrefs();
    this.setTool('pen');
  }

  /** Long press on a pinned colour: replace it with the current pen colour, or remove it. */
  private openSwatchMenu(index: number, button: HTMLButtonElement): void {
    const { prefs, i18n, menu } = this.deps;
    const current = prefs.brushes[prefs.brush].c;
    const update = (favs: string[]): void => {
      prefs.favs = favs;
      this.deps.savePrefs();
      this.renderTray();
    };
    menu.show(button, [
      {
        label: i18n.t('favReplace'),
        swatch: current,
        onClick: () => update(ColorLists.replace(prefs.favs, index, current)),
      },
      {
        label: i18n.t('favRemove'),
        icon: 'trash',
        danger: true,
        onClick: () => update(ColorLists.remove(prefs.favs, index)),
      },
    ]);
  }

  private toggleRuler(): void {
    const on = !this.canvas.ruler.on;
    this.rulerWidget.setVisible(on);
    if (on) this.deps.toast.show(this.deps.i18n.t('rulerHint'), 3200);
    this.renderTray();
  }

  private beforePointerDown(): boolean {
    if (this.textEditor.active) {
      this.textEditor.blur();
      if (this.canvas.tools.kind === 'text') return true;
    }
    this.popover.close();
    this.deps.menu.close();
    return false;
  }

  /** The first time a stylus shows up, fingers switch to scrolling unless the user chose otherwise. */
  private onPenSeen(): void {
    const { prefs, i18n } = this.deps;
    if (!prefs.fingerDraw || prefs.fingerSet) return;
    prefs.fingerDraw = false;
    this.deps.savePrefs();
    this.deps.toast.show(i18n.t('penFound'), 3800);
  }

  /* ---------- menu actions ---------- */

  private moreMenu(): MenuEntry[] {
    const { i18n, prefs, actions } = this.deps;
    const nb = this.canvas.session.nb;
    return [
      {
        label: i18n.t('pageSizeBg'),
        icon: 'page',
        onClick: () => this.openPageSettings(this.canvas.session.currentPage()),
      },
      { label: i18n.t('insertPhoto'), icon: 'image', onClick: () => void this.insertPhoto() },
      { label: i18n.t('addPdfPages'), icon: 'file', onClick: () => void this.importPdfHere() },
      { label: i18n.t('savePdfNb'), icon: 'download', onClick: () => actions.exportPdf(nb) },
      '-',
      {
        label: i18n.t('fingerDraw'),
        icon: 'hand',
        check: prefs.fingerDraw,
        onClick: () => this.toggleFingerDraw(),
      },
      { label: i18n.t('nbSettings'), icon: 'edit', onClick: () => actions.editNotebook(nb) },
      {
        label: i18n.t('language') + ' · ' + languageShort(i18n.language),
        icon: 'globe',
        onClick: () =>
          this.deps.menu.show(
            this.topBarMoreAnchor(),
            languageMenu(i18n.language, (l) => actions.setLanguage(l)),
          ),
      },
    ];
  }

  private topBarMoreAnchor(): HTMLElement {
    return this.topBar.moreAnchor;
  }

  private toggleFingerDraw(): void {
    const { prefs, i18n } = this.deps;
    prefs.fingerDraw = !prefs.fingerDraw;
    prefs.fingerSet = true;
    this.deps.savePrefs();
    this.deps.toast.show(prefs.fingerDraw ? i18n.t('fingerOn') : i18n.t('fingerOff'));
  }

  private openPageSettings(page: Page | undefined): void {
    if (!page) return;
    this.textEditor.commit();
    this.pageSettings.open(page);
  }

  private async insertPhoto(): Promise<void> {
    const c = this.canvas;
    const page = c.session.currentPage();
    if (!page) return;
    try {
      const item = await this.images.pick(page);
      if (!item) return;
      c.undo.record(page);
      page.images.push(item);
      c.session.touch(page);
      this.setTool('lasso');
      c.selection.set(page, new Set([item.id]));
    } catch (error) {
      this.deps.toast.show(this.imageErrorText(error));
    }
  }

  private imageErrorText(error: unknown): string {
    const t = this.deps.i18n;
    if (!(error instanceof ImageRejectedError)) return t.t('imgFail');
    if (error.reason === 'too-large') return t.t('fileTooBig');
    if (error.reason === 'wrong-type') return t.t('wrongFileType');
    return t.t('imgFail');
  }

  private async importPdfHere(): Promise<void> {
    const c = this.canvas;
    const ref = c.session.currentPage() ?? null;
    const imported = await this.deps.pdfImporter.pickAndImport();
    if (!imported?.pages.length || !c.session.isOpen) return;
    for (const p of imported.pages) p.nbId = c.session.nb.id;
    this.pageOps.insert(ref, imported.pages);
    await this.deps.saveQueue.flush(true);
    const first = imported.pages[0];
    if (first) c.viewport.scrollTo(first);
  }

  /* ---------- language ---------- */

  applyLanguage(): void {
    const { i18n } = this.deps;
    const c = this.canvas;
    this.root.setAttribute('aria-label', i18n.t('notebook'));
    this.fab.setAttribute('aria-label', i18n.t('addPage'));
    this.textEditor.applyLabel(i18n.t('text'));
    this.topBar.applyLanguage();
    this.panel.applyLanguage();
    if (!c.session.isOpen) return;
    this.popover.close();
    this.renderTray();
    this.rulerWidget.invalidate();
    if (c.selection.current && this.selectionBar.visible) this.selectionBar.show();
    this.refreshPanel();
    c.texts.reset();
    c.renderer.request();
  }
}
