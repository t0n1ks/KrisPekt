import { SCRATCH_HINT_MS } from '../../core/constants';
import type { EventBus } from '../../app/EventBus';
import type { Language, Notebook, Page, Preferences, Stroke, TextItem, ToolKind } from '../../core/types';
import { byId } from '../../core/utils/dom';
import { ColorLists } from '../../domain/ColorLists';
import { PageRepair } from '../../domain/PageRepair';
import { PageSizePolicy } from '../../domain/PageSizePolicy';
import type { PageSizes } from '../../domain/PageSizes';
import { EditorCanvas, type EditorCanvasHooks } from '../../editor/EditorCanvas';
import { PageDeletion } from '../../editor/PageDeletion';
import { PageOperations } from '../../editor/PageOperations';
import { ImageInserter } from '../../features/images/ImageInserter';
import { ImageRejectedError, type ImageEncoder } from '../../features/images/ImageEncoder';
import type { PdfImporter } from '../../features/pdf/PdfImporter';
import type { BlobSweeper } from '../../services/BlobSweeper';
import { ExportController, type ExportRequest } from '../../features/export/ExportController';
import { PageRasterizer } from '../../features/export/PageRasterizer';
import { PngExporter } from '../../features/export/PngExporter';
import { ZipArchive } from '../../features/export/ZipArchive';
import type { FileSaver } from '../../features/files/FileSaver';
import { PdfExporter } from '../../features/pdf/PdfExporter';
import { PdfFont } from '../../features/pdf/PdfFont';
import { PdfImages } from '../../features/pdf/PdfImages';
import type { I18n } from '../../i18n/I18n';
import { KeyboardShortcuts } from '../../input/KeyboardShortcuts';
import type { BlobRepository } from '../../storage/BlobRepository';
import { PageRepository } from '../../storage/PageRepository';
import type { SaveQueue } from '../../storage/SaveQueue';
import type { Tool } from '../../tools/Tool';
import type { DialogFactory } from '../dialogs/DialogFactory';
import type { Menu, MenuEntry } from '../dialogs/Menu';
import { PageSettingsDialog } from '../dialogs/PageSettingsDialog';
import { Snackbar } from '../dialogs/Snackbar';
import type { Toast } from '../dialogs/Toast';
import { icon } from '../icons';
import { languageMenu, languageShort } from '../widgets/languageMenu';
import { InputDiagnosticsOverlay } from './InputDiagnosticsOverlay';
import { ScratchOutMenu } from './ScratchOutMenu';
import { PagesPanel } from './PagesPanel';
import { RulerWidget } from './RulerWidget';
import { SelectionBar } from './SelectionBar';
import { TextBoxEditor } from './TextBoxEditor';
import { TextLayout } from '../../canvas/TextLayout';
import { ToolOptionsPopover } from './ToolOptionsPopover';
import type { ToolPresetController } from '../../editor/ToolPresetController';
import { EditorToolbar } from './EditorToolbar';
import { TopBar } from './TopBar';
import { ZoomMenu } from './ZoomMenu';

/** What the editor asks of the rest of the app. */
export interface EditorActions {
  closed(): void;
  editNotebook(nb: Notebook): void;
  exportNotebook(nb: Notebook): void;
  setLanguage(language: Language): void;
  subjectName(subjectId: string): string;
}

export interface EditorViewDeps {
  i18n: I18n;
  bus: EventBus;
  prefs: Preferences;
  savePrefs: () => void;
  presets: ToolPresetController;
  sizes: PageSizes;
  menu: Menu;
  dialogs: DialogFactory;
  toast: Toast;
  pages: PageRepository;
  blobs: BlobRepository;
  sweeper: BlobSweeper;
  saveQueue: SaveQueue;
  imageEncoder: ImageEncoder;
  pdfImporter: PdfImporter;
  files: FileSaver;
  makeId: () => string;
  actions: EditorActions;
  onStorageError: (error: unknown) => void;
}

/** How far below the tool tray the "Paste" button sits. */
const PASTE_BAR_TOP = 72;

/** The notebook editor screen. */
export class EditorView {
  private readonly root = byId('editor');
  private readonly fab = byId<HTMLButtonElement>('fab');
  private readonly canvas: EditorCanvas;
  private readonly topBar: TopBar;
  private readonly toolbar: EditorToolbar;
  private readonly popover: ToolOptionsPopover;
  private readonly panel: PagesPanel;
  private readonly selectionBar: SelectionBar;
  private readonly textEditor: TextBoxEditor;
  private readonly rulerWidget: RulerWidget;
  private readonly pageOps: PageOperations;
  private readonly deletion: PageDeletion;
  private readonly snackbar = new Snackbar();
  private readonly pageSettings: PageSettingsDialog;
  private readonly images: ImageInserter;
  private readonly exporter: ExportController;
  private readonly diagnostics: InputDiagnosticsOverlay;
  private readonly zoom: ZoomMenu;

  constructor(private readonly deps: EditorViewDeps) {
    const { i18n, sizes, menu } = deps;
    this.diagnostics = new InputDiagnosticsOverlay(i18n);
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
    this.textEditor = new TextBoxEditor({
      camera: c.camera,
      layout: c.layout,
      session: c.session,
      texts: c.texts,
      i18n,
      menu,
      prefs: () => deps.prefs.txt,
      savePrefs: deps.savePrefs,
      recentColors: () => deps.prefs.recent.pen,
      commitColor: (color) => {
        deps.prefs.recent.pen = ColorLists.pushRecent(deps.prefs.recent.pen, color);
        deps.savePrefs();
        return deps.prefs.recent.pen;
      },
      makeId: deps.makeId,
      recordUndo: (page) => c.undo.record(page),
      undoPage: () => void c.undo.undo(),
      redoPage: () => void c.undo.redo(),
      canUndoPage: () => c.history.canUndo,
      canRedoPage: () => c.history.canRedo,
      isPalm: (e) => c.router.isPalmTouch(e),
      toast: (message) => deps.toast.show(message),
      redraw: () => c.renderer.request(),
    });
    this.zoom = new ZoomMenu({
      camera: c.camera,
      viewport: c.viewport,
      i18n,
      notebook: () => c.session.nb,
      markDirty: () => deps.saveQueue.markNotebookDirty(),
      redraw: () => c.renderer.request(),
      toast: (message) => deps.toast.show(message),
    });
    this.topBar = new TopBar(i18n, sizes, this.topBarHandlers());
    this.toolbar = new EditorToolbar({
      stage: c.stage,
      i18n,
      menu,
      toast: deps.toast,
      bus: deps.bus,
      prefs: deps.prefs,
      savePrefs: deps.savePrefs,
      presets: deps.presets,
      tools: () => c.tools,
      popover: () => this.popover,
      setTool: (kind) => this.setTool(kind),
      rulerOn: () => c.ruler.on,
      toggleRuler: () => this.toggleRuler(),
      insertPhoto: () => void this.insertPhoto(),
      undo: () => void c.undo.undo(),
      redo: () => void c.undo.redo(),
    });
    this.popover = new ToolOptionsPopover(
      c.stage,
      c.camera,
      () => this.toolbar.rect(),
      deps.bus,
      (tool) => this.toolbar.pinControl(tool),
    );
    this.selectionBar = new SelectionBar(i18n, menu, {
      recolor: (color) => c.selection.recolor(color),
      duplicate: () => c.selection.duplicate(),
      copy: () => this.copySelection(),
      paste: () => void this.pasteSelection(),
      canPaste: () => c.selection.canPaste,
      remove: () => c.selection.remove(),
      deselect: () => c.selection.clear(),
    });
    this.rulerWidget = new RulerWidget(
      c.ruler,
      c.camera,
      c.theme,
      i18n,
      (e) => c.router.down(e),
      (e) => c.router.isPalmTouch(e),
    );
    this.pageOps = this.createPageOperations();
    this.deletion = this.createPageDeletion();
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
    this.exporter = this.createExporter();
    this.fab.append(icon('plus', 26));
    this.fab.addEventListener('click', () => this.pageOps.add());
    new KeyboardShortcuts(this.shortcutHandlers());
    this.watchEnvironment();
  }

  /* ---------- wiring ---------- */

  /** PDF (vector or raster) and PNG export, drawn with the editor's own painter. */
  private createExporter(): ExportController {
    const { i18n, toast, blobs, files } = this.deps;
    const c = this.canvas;
    const notify = (message: string, ms?: number): void => toast.show(message, ms);
    const rasterizer = new PageRasterizer(c.painter, c.bitmaps);
    const pdf = new PdfExporter({
      painter: c.painter,
      rasterizer,
      images: new PdfImages(blobs),
      font: new PdfFont(),
      i18n,
      notify,
    });
    const png = new PngExporter(rasterizer, i18n, notify);
    return new ExportController({ pdf, png, zip: new ZipArchive(), files, i18n, notify });
  }

  private hooks(): EditorCanvasHooks {
    const d = this.deps;
    return {
      afterRender: () => this.afterRender(),
      onSelectionChange: (state) => {
        if (state) {
          this.selectionBar.show();
          this.positionOverlays();
        } else this.showPasteOrNothing();
      },
      onUndoState: (u, r) => this.toolbar.setUndoState(u, r),
      onRestored: (_pages, resized) => {
        if (resized) this.canvas.viewport.relayout();
        this.refreshPanel();
      },
      onToolChange: (tool) => this.onToolChange(tool),
      onBitmapLoaded: () => this.panel.refreshSoon(),
      beforePointerDown: () => this.beforePointerDown(),
      onPenSeen: () => this.onPenSeen(),
      onZoomBlocked: () => this.zoom.showBlockedHint(),
      onTwoFingerTap: () => {
        if (this.canvas.undo.undo()) d.toast.show(d.i18n.t('undone'), 1000);
      },
      onInputSample: (sample) => this.diagnostics.record(sample),
      onScratchReport: (report) => this.diagnostics.noteScratch(report),
      onScratchHint: () => this.showScratchHint(),
      settle: () => this.settle(),
      hiddenTextOn: (page) => this.textEditor.hiddenOn(page),
      editText: (page, item, x, y) => {
        if (item) this.textEditor.select(page, item);
        else this.textEditor.startNew(page, x, y);
      },
      setTool: (kind) => this.setTool(kind),
      refreshTray: () => this.toolbar.render(),
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
      zoom: (anchor: HTMLElement) => this.deps.menu.show(anchor, this.zoom.entries()),
      lock: () => this.openPageSettings(c().session.currentPage()),
      pages: () => {
        this.settle();
        this.popover.close();
        this.panel.open(c().session.pages, c().session.currentIndex);
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
      camera: c.camera,
      layout: c.layout,
      undo: c.undo,
      saveQueue: d.saveQueue,
      i18n: d.i18n,
      sizes: d.sizes,
      makeId: d.makeId,
      toast: (message, ms) => d.toast.show(message, ms),
      settle: () => this.settle(),
      onPagesChanged: () => this.refreshPanel(),
    });
  }

  private createPageDeletion(): PageDeletion {
    const c = this.canvas;
    const d = this.deps;
    return new PageDeletion({
      session: c.session,
      pageOps: this.pageOps,
      undo: c.undo,
      cache: c.cache,
      saveQueue: d.saveQueue,
      sweeper: d.sweeper,
      i18n: d.i18n,
      prompt: this.snackbar,
      toast: (message) => d.toast.show(message),
      confirm: (title, text) => d.dialogs.confirm(title, text),
      settle: () => this.settle(),
      onPagesChanged: () => this.refreshPanel(),
    });
  }

  private createPagesPanel(): PagesPanel {
    const c = this.canvas;
    return new PagesPanel({
      i18n: this.deps.i18n,
      sizes: this.deps.sizes,
      menu: this.deps.menu,
      painter: c.painter,
      loadBitmap: (id) => c.bitmaps.load(id),
      revision: (page) => c.session.revision(page),
      dpr: () => c.camera.dpr,
      sheetOpen: () => this.deps.dialogs.hasOpenSheet,
      handlers: {
        goTo: (page) => c.viewport.scrollTo(page),
        addBefore: (page) => this.pageOps.addBefore(page),
        addAfter: (page) => this.pageOps.add(page),
        settings: (page) => this.openPageSettings(page),
        duplicate: (page) => this.pageOps.duplicate(page),
        remove: (pages) => this.deletion.request(pages),
        moveTo: (page, index) => this.pageOps.moveTo(page, index),
      },
    });
  }

  private shortcutHandlers() {
    const c = this.canvas;
    return {
      enabled: () => !this.root.hidden && c.session.isOpen && !this.panel.isOpen,
      undo: () => void c.undo.undo(),
      redo: () => void c.undo.redo(),
      textKey: (e: KeyboardEvent) => this.textEditor.handleKey(e),
      copySelection: () => this.copySelection(),
      cutSelection: () => {
        if (!this.copySelection()) return false;
        c.selection.remove();
        return true;
      },
      pasteSelection: () => this.pasteSelection(),
      deleteSelection: () => {
        if (this.textEditor.removeSelected()) return true;
        if (!c.selection.current) return false;
        c.selection.remove();
        return true;
      },
      escape: () => {
        if (this.toolbar.closeCustomizer()) return;
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
    // Over the bars the wheel is the browser's: a locked zoom must not let it zoom the whole page.
    this.root.addEventListener(
      'wheel',
      (e) => {
        if ((e.ctrlKey || e.metaKey) && c.camera.zoomLocked) e.preventDefault();
      },
      { passive: false },
    );
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
    // Canvas text does not load a font weight by itself in time for the first paint. Bold is part
    // of what is on pages, so it is loaded here, for screen and exports alike.
    const bold = document.fonts?.load(TextLayout.font(16, true), 'AЯ').catch(() => []);
    void Promise.all([document.fonts?.ready, bold]).then(() => {
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

  /** The open notebook's pages if `nb` is open (for exporting unsaved state). */
  pagesOf(nb: Notebook): Page[] | null {
    return this.canvas.session.notebook === nb ? this.canvas.session.pages : null;
  }

  /** The open page's index if `nb` is open, else null. */
  currentIndexOf(nb: Notebook): number | null {
    const session = this.canvas.session;
    if (session.notebook !== nb) return null;
    const page = session.currentPage();
    return page ? session.indexOf(page) : null;
  }

  /** Exports pages (of any notebook) as PDF or PNG and saves the file. */
  exportPages(request: ExportRequest): Promise<void> {
    return this.exporter.run(request);
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
    const repaired = this.repairLostItems(pages);
    nb.pageIds = pages.map((p) => p.id);
    c.cache.clear();
    c.undo.clear();
    c.session.open(nb, pages);
    this.deps.saveQueue.setNotebook(nb);
    if (created) pages.forEach((p) => this.deps.saveQueue.markPageDirty(p));
    repaired.forEach((p) => this.deps.saveQueue.markPageDirty(p));
    this.show();
    this.placeCamera(nb);
    this.topBar.setTitle(nb.title, this.deps.actions.subjectName(nb.subjectId));
    this.toolbar.render();
    c.renderer.render();
    return true;
  }

  /**
   * Moves items lying completely outside their page back onto it (older versions could lose a
   * selection dragged onto another page that way). Returns the pages that changed; the count
   * goes to the input diagnostics overlay, not to a toast.
   */
  private repairLostItems(pages: readonly Page[]): Page[] {
    const c = this.canvas;
    const boxes = { stroke: (s: Stroke) => c.geometry.bbox(s), text: (t: TextItem) => c.texts.box(t) };
    let count = 0;
    const changed = pages.filter((page) => {
      const moved = PageRepair.repair(page, boxes);
      count += moved;
      return moved > 0;
    });
    this.diagnostics.noteRepaired(count);
    return changed;
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
    c.camera.setZoomLock(null);
    c.camera.setZoom(nb.view?.z ? nb.view.z : c.camera.fitZoom(c.layout));
    c.camera.setZoomLock(nb.zoomLock ?? null);
    c.camera.centerX();
    const target = (nb.view?.pageId && c.session.find(nb.view.pageId)) || c.session.pages[0];
    if (target) c.viewport.scrollTo(target);
    if (c.ruler.on) c.ruler.placeDefault(c.camera.width, c.camera.height);
  }

  /**
   * Notes the open notebook's page and zoom for the next save. Runs when leaving the editor and
   * when the app goes to the background, because Android may then kill it without warning.
   */
  rememberView(): void {
    const { session, camera } = this.canvas;
    if (!session.notebook) return;
    const page = session.currentPage();
    session.notebook.view = { pageId: page ? page.id : null, z: camera.z };
  }

  /** Blobs in use that stored pages may not reference: undo steps and pages awaiting Undo. */
  blobsInUse(): Set<string> {
    const { session, history } = this.canvas;
    return new Set([
      ...PageRepository.blobIds(session.pages),
      ...history.blobIds(),
      ...this.deletion.pendingBlobIds(),
      ...this.canvas.selection.clipboardBlobIds(),
    ]);
  }

  /** Saves and returns to the shelf. */
  async close(): Promise<void> {
    const c = this.canvas;
    this.settle();
    this.popover.close();
    this.deps.menu.close();
    this.panel.hide();
    this.deletion.finish();
    this.rememberView();
    await this.deps.saveQueue.flush(true);
    c.session.close();
    c.undo.clear();
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
    if (page) {
      const { z, zoomLocked } = c.camera;
      this.topBar.update(page, c.session.currentIndex, c.session.pages.length, z, zoomLocked);
    }
    this.panel.highlight(c.session.currentIndex);
    this.deps.bus.emit('page-changed', { index: c.session.currentIndex, count: c.session.pages.length });
  }

  private positionOverlays(): void {
    const c = this.canvas;
    this.textEditor.position();
    this.rulerWidget.position();
    if (c.selection.current && this.selectionBar.visible) {
      this.selectionBar.position(c.selection.screenBox(), c.camera.width, c.camera.height);
    } else if (this.selectionBar.visible) {
      this.selectionBar.position(
        { x: c.camera.width / 2, y: c.camera.topPad + PASTE_BAR_TOP, w: 0, h: 0 },
        c.camera.width,
        c.camera.height,
      );
    }
  }

  /** Remembers the selected items, for pasting on any page of any notebook. */
  private copySelection(): boolean {
    const c = this.canvas;
    if (!c.selection.copy()) return false;
    this.deps.toast.show(this.deps.i18n.t('copiedSel'));
    this.selectionBar.show();
    this.positionOverlays();
    return true;
  }

  /** Pastes in the middle of the visible part of the current page. */
  private pasteSelection(): boolean {
    const c = this.canvas;
    const page = c.session.currentPage();
    if (!page || !c.selection.canPaste) return false;
    if (c.tools.kind !== 'lasso') c.tools.select('lasso');
    const center = c.layout.toPage(page, c.camera.toWorld(c.camera.width / 2, c.camera.height / 2));
    return c.selection.paste(page, center);
  }

  /** With the lasso on and something copied, "Paste" stays at hand while nothing is selected. */
  private showPasteOrNothing(): void {
    const c = this.canvas;
    if (c.selection.current) return;
    if (c.tools.kind === 'lasso' && c.selection.canPaste && c.session.isOpen) {
      this.selectionBar.showPaste();
      this.positionOverlays();
    } else this.selectionBar.hide();
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
    this.showPasteOrNothing();
    this.toolbar.toolChanged(tool);
    this.canvas.applyCursor(tool);
  }

  private toggleRuler(): void {
    const on = !this.canvas.ruler.on;
    this.rulerWidget.setVisible(on);
    if (on) this.deps.toast.show(this.deps.i18n.t('rulerHint'), 3200);
    this.toolbar.render();
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
      { label: i18n.t('customizeToolbar'), icon: 'sliders', onClick: () => this.toolbar.openCustomizer() },
      { label: i18n.t('addPdfPages'), icon: 'file', onClick: () => void this.importPdfHere() },
      { label: i18n.t('exportMenu'), icon: 'download', onClick: () => actions.exportNotebook(nb) },
      // The zoom pill is hidden on phones, so the lock has to be reachable from here too.
      this.zoom.lockEntry(),
      '-',
      {
        label: i18n.t('fingerDraw'),
        icon: 'hand',
        check: prefs.fingerDraw,
        onClick: () => this.toggleFingerDraw(),
        onLongPress: () => this.toggleDiagnostics(),
      },
      {
        label: i18n.t('twoFingerUndo'),
        icon: 'undo',
        check: prefs.twoFingerUndo,
        onClick: () => this.toggleTwoFingerUndo(),
      },
      {
        label: i18n.t('twoFingerScroll'),
        icon: 'scroll',
        check: prefs.twoFingerScroll,
        onClick: () => this.toggleTwoFingerScroll(),
      },
      this.scratchEntry(),
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

  private scratchEntry(): MenuEntry {
    const { i18n, prefs, toast, savePrefs } = this.deps;
    const menu = new ScratchOutMenu(i18n, prefs, (message) => {
      savePrefs();
      toast.show(message);
    });
    return {
      label: menu.summary(),
      icon: 'scribble',
      onClick: () => this.deps.menu.show(this.topBarMoreAnchor(), menu.entries()),
    };
  }

  /** The first few times, says what happened to the content and offers to bring it back. */
  private showScratchHint(): void {
    const { i18n } = this.deps;
    this.snackbar.show({
      message: i18n.t('scratchHint'),
      action: i18n.t('undo'),
      ms: SCRATCH_HINT_MS,
      onAction: () => this.canvas.undo.undo(),
      onExpire: () => undefined,
    });
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

  private toggleTwoFingerUndo(): void {
    const { prefs, i18n } = this.deps;
    prefs.twoFingerUndo = !prefs.twoFingerUndo;
    this.deps.savePrefs();
    this.deps.toast.show(i18n.t(prefs.twoFingerUndo ? 'twoFingerUndoOn' : 'twoFingerUndoOff'));
  }

  private toggleTwoFingerScroll(): void {
    const { prefs, i18n } = this.deps;
    prefs.twoFingerScroll = !prefs.twoFingerScroll;
    this.deps.savePrefs();
    this.deps.toast.show(i18n.t(prefs.twoFingerScroll ? 'twoFingerScrollOn' : 'twoFingerScrollOff'));
  }

  /** Hidden: a long press on "Draw with finger" shows the input diagnostics overlay. */
  private toggleDiagnostics(): void {
    const on = !this.diagnostics.visible;
    this.diagnostics.setVisible(on);
    this.deps.toast.show(this.deps.i18n.t(on ? 'inputDiagOn' : 'inputDiagOff'));
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
    this.textEditor.applyLanguage();
    this.topBar.applyLanguage();
    this.panel.applyLanguage();
    if (!c.session.isOpen) return;
    this.popover.close();
    this.toolbar.render();
    this.rulerWidget.invalidate();
    if (c.selection.current && this.selectionBar.visible) this.selectionBar.show();
    this.refreshPanel();
    c.texts.reset();
    c.renderer.request();
  }
}
