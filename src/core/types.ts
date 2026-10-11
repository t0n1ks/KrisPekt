/** Interface languages. */
export type Language = 'uk' | 'ru' | 'de' | 'en';

/** Paper backgrounds a page can have. */
export type Background = 'plain' | 'grid' | 'gridm' | 'lines' | 'dots';

/** Editor tools selectable in the tray. */
export type ToolKind = 'pen' | 'hl' | 'eraser' | 'lasso' | 'text';

/** Stroke flavours: an ink pen (filled outline) or a highlighter (wide translucent centre line). */
export type StrokeKind = 'pen' | 'hl';

/** Pen brush types. Strokes without a brush id are `ballpoint`. */
export type BrushKind = 'ballpoint' | 'fountain' | 'fineliner' | 'pencil' | 'brush';

/** Eraser behaviour: cut away part of a stroke ("pixel eraser"), or remove whole strokes. */
export type EraserMode = 'part' | 'whole';

/** Page dimensions in millimetres. */
export interface PageSize {
  w: number;
  h: number;
}

export interface Subject {
  id: string;
  name: string;
  /** Cover colour, `#rrggbb`. */
  color: string;
  order: number;
  createdAt: number;
}

/** Where the notebook was last left open. */
export interface NotebookView {
  pageId: string | null;
  z: number;
}

export interface Notebook {
  id: string;
  subjectId: string;
  title: string;
  color: string;
  /** Base page size, owned by the first page; locked pages always use it. */
  base: PageSize;
  /** Background for new pages. */
  bg: Background;
  /** Page order. */
  pageIds: string[];
  createdAt: number;
  updatedAt: number;
  sample?: boolean;
  view: NotebookView | null;
}

/**
 * A freehand stroke. `p` is a flat list `[x, y, pressure, x, y, pressure, …]` in page-local
 * world px. It is a Float32Array in memory and IndexedDB, and a rounded number array in backups.
 */
export interface Stroke {
  id: string;
  k: StrokeKind;
  /** Colour, `#rrggbb`. */
  c: string;
  /** Nominal width in world px. */
  s: number;
  p: Float32Array;
  /** Brush of a pen stroke; missing means `ballpoint` (all strokes made before brushes existed). */
  b?: BrushKind;
}

/** Anything drawable as a stroke; in-progress strokes use a plain number array. */
export interface StrokeLike {
  k: StrokeKind;
  c: string;
  s: number;
  p: ArrayLike<number>;
  b?: BrushKind;
}

export interface TextItem {
  id: string;
  x: number;
  y: number;
  /** Wrap width in world px. */
  w: number;
  /** The text itself. */
  t: string;
  /** Font size in world px. */
  fs: number;
  c: string;
}

export interface ImageItem {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Id of the record in the `blobs` store. */
  blob: string;
}

export interface Page {
  id: string;
  nbId: string;
  /** Width in mm. */
  w: number;
  /** Height in mm. */
  h: number;
  /** Locked pages always use the notebook's base size. */
  locked: boolean;
  bg: Background;
  /** Rasterised PDF page used as the background, if any. */
  bgBlob: string | null;
  strokes: Stroke[];
  texts: TextItem[];
  images: ImageItem[];
  updatedAt: number;
}

export interface BlobRecord {
  id: string;
  blob: Blob;
}

export interface PenPrefs {
  c: string;
  s: number;
}

export interface EraserPrefs {
  mode: EraserMode;
  r: number;
}

export interface TextPrefs {
  fs: number;
  c: string;
}

/** Recently used custom colours, newest first; pen and highlighter keep separate lists. */
export interface RecentColors {
  pen: string[];
  hl: string[];
}

/** User preferences, stored in localStorage under `konspektnik.prefs.v1`. */
export interface Preferences {
  /** The pen's current brush. */
  brush: BrushKind;
  /** Colour and size remembered per brush. */
  brushes: Record<BrushKind, PenPrefs>;
  hl: PenPrefs;
  er: EraserPrefs;
  txt: TextPrefs;
  /** Up to five pinned pen colours shown in the tray. */
  favs: string[];
  recent: RecentColors;
  fingerDraw: boolean;
  /** True once the user toggled finger drawing by hand (disables auto-switch on stylus detection). */
  fingerSet: boolean;
  straighten: boolean;
  seeded: boolean;
  lang?: Language;
}

/** A point in screen (stage-local CSS px) or world coordinates. */
export interface Point {
  x: number;
  y: number;
}

/** Axis-aligned box given by its corners. */
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
