import { BitmapCache } from '../canvas/BitmapCache';
import { Camera } from '../canvas/Camera';
import { LiveLayer } from '../canvas/LiveLayer';
import { PageCache, type SkipInfo } from '../canvas/PageCache';
import { PageLayout } from '../canvas/PageLayout';
import { PagePainter } from '../canvas/PagePainter';
import { PatternPainter } from '../canvas/PatternPainter';
import { Renderer } from '../canvas/Renderer';
import { StageCanvas } from '../canvas/StageCanvas';
import { StrokeGeometry } from '../canvas/StrokeGeometry';
import { StrokePainter } from '../canvas/StrokePainter';
import { TextLayout } from '../canvas/TextLayout';
import { ThemeColors } from '../canvas/ThemeColors';
import type { Page, Point, Preferences, Stroke, TextItem, ToolKind } from '../core/types';
import { byId, context2d } from '../core/utils/dom';
import { History } from '../domain/History';
import type { I18n } from '../i18n/I18n';
import { GestureController } from '../input/GestureController';
import { InputRouter } from '../input/InputRouter';
import type { BlobRepository } from '../storage/BlobRepository';
import type { SaveQueue } from '../storage/SaveQueue';
import { EraserTool } from '../tools/EraserTool';
import { HighlighterTool } from '../tools/HighlighterTool';
import { LassoTool } from '../tools/LassoTool';
import { PenTool } from '../tools/PenTool';
import { Ruler } from '../tools/Ruler';
import { Selection, type SelectionState } from '../tools/Selection';
import { TextTool } from '../tools/TextTool';
import type { Tool } from '../tools/Tool';
import type { ToolContext } from '../tools/ToolContext';
import { ToolManager } from '../tools/ToolManager';
import { EditorSession } from './EditorSession';
import { UndoController } from './UndoController';
import { Viewport } from './Viewport';

/** What the drawing pipeline needs from the surrounding editor UI. */
export interface EditorCanvasHooks {
  afterRender(): void;
  onSelectionChange(state: SelectionState | null): void;
  onUndoState(canUndo: boolean, canRedo: boolean): void;
  onRestored(page: Page, resized: boolean): void;
  onToolChange(tool: Tool): void;
  onBitmapLoaded(): void;
  /** First thing on pointer-down; true swallows the event. */
  beforePointerDown(): boolean;
  onPenSeen(): void;
  onTwoFingerTap(): void;
  /** Finish text editing and drop the selection. */
  settle(): void;
  hiddenTextOn(page: Page): string | null;
  editText(page: Page, item: TextItem | null, x: number, y: number): void;
  setTool(kind: ToolKind): void;
  refreshTray(): void;
  toast(message: string, ms?: number): void;
  confirm(title: string, text: string, okLabel: string): Promise<boolean>;
}

export interface EditorCanvasDeps {
  i18n: I18n;
  prefs: Preferences;
  savePrefs: () => void;
  blobs: BlobRepository;
  saveQueue: SaveQueue;
  makeId: () => string;
  hooks: EditorCanvasHooks;
}

/**
 * The editor's drawing pipeline: camera and layout, painters and caches, the two canvases,
 * undo, selection, ruler, tools and input routing, wired together.
 */
export class EditorCanvas {
  readonly stage = byId('stage');
  readonly mainCanvas = byId<HTMLCanvasElement>('cv');
  readonly liveCanvas = byId<HTMLCanvasElement>('live');
  readonly camera = new Camera();
  readonly layout = new PageLayout();
  readonly theme = new ThemeColors();
  readonly geometry = new StrokeGeometry();
  readonly strokes = new StrokePainter();
  readonly texts = new TextLayout(context2d(document.createElement('canvas')));
  readonly ruler = new Ruler();
  readonly history = new History();
  readonly session: EditorSession;
  readonly bitmaps: BitmapCache;
  readonly painter: PagePainter;
  readonly cache: PageCache;
  readonly renderer: Renderer;
  readonly live: LiveLayer;
  readonly undo: UndoController;
  readonly viewport: Viewport;
  readonly selection: Selection;
  readonly tools: ToolManager;
  readonly gestures: GestureController;
  readonly router: InputRouter;
  private readonly canvases = new StageCanvas([this.mainCanvas, this.liveCanvas]);

  constructor(private readonly deps: EditorCanvasDeps) {
    const { hooks, saveQueue } = deps;
    this.session = new EditorSession(
      () => this.renderer.request(),
      (page) => saveQueue.markPageDirty(page),
      () => saveQueue.markNotebookDirty(),
    );
    this.bitmaps = new BitmapCache(deps.blobs);
    this.bitmaps.setLoadedHandler((id) => this.onBitmapLoaded(id));
    this.painter = new PagePainter(new PatternPainter(), this.strokes, this.texts, this.bitmaps);
    this.cache = new PageCache(this.painter, this.strokes);
    this.renderer = this.createRenderer();
    this.live = new LiveLayer(this.liveCanvas, this.camera, this.layout);
    this.viewport = new Viewport(this.camera, this.layout, this.session, this.renderer);
    this.undo = new UndoController({
      history: this.history,
      session: this.session,
      beforeStep: () => hooks.settle(),
      onRestored: (page, resized) => hooks.onRestored(page, resized),
      onStateChange: (u, r) => hooks.onUndoState(u, r),
    });
    this.selection = this.createSelection();
    this.tools = this.createTools();
    this.live.setPainters([this.tools, this.selection]);
    this.gestures = this.createGestures();
    this.router = new InputRouter({
      canvas: this.mainCanvas,
      stage: this.stage,
      camera: this.camera,
      gestures: this.gestures,
      tools: this.tools,
      beforePointerDown: () => hooks.beforePointerDown(),
      onPenSeen: () => hooks.onPenSeen(),
    });
  }

  private createRenderer(): Renderer {
    return new Renderer({
      canvas: this.mainCanvas,
      camera: this.camera,
      layout: this.layout,
      session: this.session,
      cache: this.cache,
      painter: this.painter,
      theme: this.theme,
      i18n: this.deps.i18n,
      skipFor: (page) => this.skipFor(page),
      afterRender: () => this.deps.hooks.afterRender(),
    });
  }

  private createSelection(): Selection {
    return new Selection({
      camera: this.camera,
      layout: this.layout,
      session: this.session,
      geometry: this.geometry,
      strokes: this.strokes,
      texts: this.texts,
      bitmaps: this.bitmaps,
      recordUndo: (page) => this.undo.record(page),
      makeId: this.deps.makeId,
      onChange: (state) => {
        this.deps.hooks.onSelectionChange(state);
        this.live.request();
      },
    });
  }

  private createTools(): ToolManager {
    const ctx = this.toolContext();
    const tools = [
      new PenTool(ctx),
      new HighlighterTool(ctx),
      new EraserTool(ctx),
      new LassoTool(ctx),
      new TextTool(ctx),
    ];
    return new ToolManager(
      tools,
      () => this.deps.prefs,
      (tool) => this.deps.hooks.onToolChange(tool),
    );
  }

  private toolContext(): ToolContext {
    const { hooks, i18n, prefs, makeId } = this.deps;
    return {
      camera: this.camera,
      layout: this.layout,
      session: this.session,
      geometry: this.geometry,
      strokes: this.strokes,
      texts: this.texts,
      selection: this.selection,
      ruler: this.ruler,
      i18n,
      prefs,
      makeId,
      savePrefs: () => this.deps.savePrefs(),
      recordUndo: (page) => this.undo.record(page),
      commitStroke: (page, stroke) => this.commitStroke(page, stroke),
      requestRender: () => this.renderer.request(),
      requestLive: () => this.live.request(),
      toast: (message, ms) => hooks.toast(message, ms),
      confirm: (title, text, ok) => hooks.confirm(title, text, ok),
      editText: (page, item, x, y) => hooks.editText(page, item, x, y),
      setTool: (kind) => hooks.setTool(kind),
      refreshTray: () => hooks.refreshTray(),
    };
  }

  private createGestures(): GestureController {
    return new GestureController({
      camera: this.camera,
      layout: this.layout,
      renderer: this.renderer,
      releaseCapture: (id) => {
        try {
          this.mainCanvas.releasePointerCapture(id);
        } catch {
          /* already released */
        }
      },
      onTwoFingerTap: () => this.deps.hooks.onTwoFingerTap(),
      onTap: (pt: Point) => this.tools.tap(pt),
    });
  }

  /** Adds a finished stroke and draws it onto the cached page bitmap without a full repaint. */
  private commitStroke(page: Page, stroke: Stroke): void {
    this.undo.record(page);
    const oldRevision = this.session.revision(page);
    page.strokes.push(stroke);
    this.session.touch(page);
    this.cache.append(page, stroke, oldRevision, this.session.revision(page));
  }

  /**
   * Items the page bitmap must leave out, and the matching cache-key suffix:
   * `s<token>` for the selection, `e<id>` for the text being edited.
   */
  private skipFor(page: Page): SkipInfo {
    let set: Set<string> | null = null;
    let key = '';
    const hidden = this.selection.hiddenOn(page);
    if (hidden) {
      set = new Set(hidden.ids);
      key = 's' + hidden.token;
    }
    const editing = this.deps.hooks.hiddenTextOn(page);
    if (editing) {
      set ??= new Set();
      set.add(editing);
      key += 'e' + editing;
    }
    return { set, key };
  }

  private onBitmapLoaded(id: string): void {
    for (const page of this.session.pages) {
      if (page.bgBlob === id || page.images.some((im) => im.blob === id)) this.session.bump(page);
    }
    this.deps.hooks.onBitmapLoaded();
  }

  /** Re-measures the stage and resizes both canvases (DPR capped at 2). */
  resize(): void {
    this.camera.resize(this.stage.getBoundingClientRect(), window.devicePixelRatio);
    this.canvases.fit(this.camera);
    this.ruler.fit(this.camera.width, this.camera.height);
  }

  /** Sets the canvas cursor for the active tool. */
  applyCursor(tool: Tool): void {
    this.mainCanvas.classList.remove('stage__canvas--text', 'stage__canvas--crosshair');
    if (tool.cursorClass) this.mainCanvas.classList.add(tool.cursorClass);
  }
}
