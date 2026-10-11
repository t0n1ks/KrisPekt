import type { BrushRegistry } from '../canvas/brushes/BrushRegistry';
import type { Camera } from '../canvas/Camera';
import type { PageLayout } from '../canvas/PageLayout';
import type { StrokeGeometry } from '../canvas/StrokeGeometry';
import type { StrokePainter } from '../canvas/StrokePainter';
import type { TextLayout } from '../canvas/TextLayout';
import type { Page, Preferences, Stroke, TextItem, ToolKind } from '../core/types';
import type { EditorSession } from '../editor/EditorSession';
import type { I18n } from '../i18n/I18n';
import type { Ruler } from './Ruler';
import type { Selection } from './Selection';

/** Services the tools need, wired by the editor (dependency injection). */
export interface ToolContext {
  camera: Camera;
  layout: PageLayout;
  session: EditorSession;
  geometry: StrokeGeometry;
  brushes: BrushRegistry;
  strokes: StrokePainter;
  texts: TextLayout;
  selection: Selection;
  ruler: Ruler;
  i18n: I18n;
  prefs: Preferences;
  makeId: () => string;
  savePrefs(): void;
  /** Records a page's state for undo before changing it. */
  recordUndo(page: Page): void;
  /** Adds a finished stroke to a page (undo, save, incremental cache update). */
  commitStroke(page: Page, stroke: Stroke): void;
  requestRender(): void;
  requestLive(): void;
  toast(message: string, ms?: number): void;
  confirm(title: string, text: string, okLabel: string): Promise<boolean>;
  /** Opens the text box editor for a new (`item` null) or existing text. */
  editText(page: Page, item: TextItem | null, x: number, y: number): void;
  /** Switches tools. */
  setTool(kind: ToolKind): void;
  /** Rebuilds the tray after colour or favourite changes. */
  refreshTray(): void;
}
