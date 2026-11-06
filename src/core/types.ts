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

/** How often the app saves a backup file by itself. */
export type AutoBackupInterval = 'daily' | '3days' | 'weekly' | 'off';

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
  /** When it went to the Trash; absent means it is on the shelf. */
  deletedAt?: number;
}

/** Where the notebook was last left open. */
export interface NotebookView {
  pageId: string | null;
  z: number;
}

/** An anchor as the notebook lists it; see `AnchorMarks`. */
export interface AnchorMark {
  id: string;
  pageId: string;
  name: string;
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
  /** Position among the subject's notebooks; older notebooks without it sort by creation time. */
  order?: number;
  view: NotebookView | null;
  /** The zoom the user locked this notebook at; absent means unlocked. */
  zoomLock?: number;
  /** Its anchors, derived from its pages, so links can be checked without loading any page. */
  marks?: AnchorMark[];
  /** When it went to the Trash; absent means it is on the shelf. */
  deletedAt?: number;
  /** It went to the Trash because its subject did, and comes back with it. */
  deletedWithSubject?: true;
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

/** Character styling. An absent field means the box's own size or colour, or "off". */
/** A web address. */
export type UrlLink = { kind: 'url'; href: string };

/** A place in the notes, named by ids, so that it survives pages being reordered. */
export type InternalLink =
  { kind: 'anchor' | 'page'; nb: string; id: string } | { kind: 'notebook'; nb: string };

/** Where a link leads. Everything that opens a link goes through this type. */
export type LinkTarget = UrlLink | InternalLink;

export interface TextStyle {
  /** Font size in world px. */
  fs?: number;
  c?: string;
  /** Bold, italic, underline, strikethrough. */
  b?: true;
  i?: true;
  u?: true;
  s?: true;
  /** Where the text leads; drawn in the link colour and underlined. */
  link?: LinkTarget;
}

/** A stretch of text in one style. */
export interface TextSpan extends TextStyle {
  t: string;
}

export interface TextParagraph {
  /** At least one run; an empty paragraph has one empty run, which carries its style. */
  runs: TextSpan[];
  /** Absent means left. */
  align?: 'center' | 'right';
  list?: 'bullet' | 'number';
}

/**
 * A text box. Its height is never stored: it follows from the text and the width. Items written
 * before rich text have no `paras` and no `auto`; they load and render as they always did, and
 * get `paras` when edited.
 */
export interface TextItem {
  id: string;
  x: number;
  y: number;
  /** Wrap width in world px. */
  w: number;
  /** The text without styles; paragraphs on separate lines. */
  t: string;
  /** Default font size in world px. */
  fs: number;
  /** Default colour. */
  c: string;
  /** The box grows with its text; off once the user sets the width by hand. */
  auto?: true;
  /** The styled text. */
  paras?: TextParagraph[];
  /** A table of contents, which the app can write again; otherwise an ordinary box. */
  toc?: true;
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

export type CardKind = 'pdf' | 'link';

/** What every attachment card has: its rectangle on the page, in world px. */
interface CardBase {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** An attached PDF. It is shown on the card and in the viewer, and is never run or trusted. */
export interface PdfCard extends CardBase {
  kind: 'pdf';
  /** Id of the file in the `blobs` store; files with the same content share one. */
  blob: string;
  /** Id of the first page's image in the `blobs` store. */
  thumb: string | null;
  /** The sanitised file name, with its extension. */
  name: string;
  /** 0 when unknown (a file that could not be opened). */
  pages: number;
  bytes: number;
  /** Set when the file could not be opened; it can still be saved. */
  problem?: 'locked' | 'broken';
}

/** A web link. No preview, title or icon is ever fetched for it. */
export interface LinkCard extends CardBase {
  kind: 'link';
  link: UrlLink;
  title: string;
}

export type CardItem = PdfCard | LinkCard;

/** A rectangle on a page, in world px. */
export interface PageRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A place in the notes that links can lead to. */
export interface Anchor {
  id: string;
  name: string;
  /** The items it covers, and it moves with them. None: the whole page. */
  items: string[];
  /** A stretch of the text box in `items`, by character offsets. */
  range?: [number, number];
  /** Where the items last were; stands in when they cannot be measured. */
  rect: PageRect;
}

/** Handwriting (or any other items) that works as a link, and moves with them. */
export interface InkLink {
  id: string;
  items: string[];
  rect: PageRect;
  link: LinkTarget;
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
  /** Attachment cards; pages stored before they existed load with none. */
  cards: CardItem[];
  /** Anchors and ink links live on the page, so one undo step restores them with its items. */
  anchors: Anchor[];
  inkLinks: InkLink[];
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

/** The style of the next new text box: the last one used. */
export interface TextPrefs {
  fs: number;
  c: string;
  b?: true;
  i?: true;
  u?: true;
  s?: true;
}

/** Recently used custom colours, newest first; pen and highlighter keep separate lists. */
export interface RecentColors {
  pen: string[];
  hl: string[];
}

/** Export formats: vector PDF, raster PDF (lossless images), PNG images. */
export type ExportFormat = 'pdf' | 'pdfRaster' | 'png';

/** Raster PDF resolutions. */
export type RasterDpi = 300 | 600;

/** PNG sizes as multiples of the page at 96 dpi. */
export type PngScale = 2 | 4 | 6;

/** Which pages an export includes; `current` exists only in the editor. */
export type ExportScope = 'current' | 'all' | 'range';

/** The last export choices. */
export interface ExportPrefs {
  format: ExportFormat;
  dpi: RasterDpi;
  scale: PngScale;
  /** PNG without paper and pattern. */
  transparent: boolean;
  pages: ExportScope;
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
  /** A quick two-finger tap undoes. */
  twoFingerUndo: boolean;
  /** A single finger never scrolls: scrolling and zoom need two fingers. */
  twoFingerScroll: boolean;
  straighten: boolean;
  seeded: boolean;
  /** Stored images may have lost their last page; see BlobSweeper. */
  blobSweepDue: boolean;
  lang?: Language;
  /** Automatic backup interval. */
  autoBackup: AutoBackupInterval;
  /** When the last backup (manual or automatic) was saved, ms since epoch; 0 = never. */
  lastBackupAt: number;
  /** Size of the last backup in bytes (large backups are saved automatically less often). */
  lastBackupBytes: number;
  /** When content (a page, notebook or subject) was last written, ms since epoch; 0 = never. */
  lastChangeAt: number;
  /** The last export choices. */
  exp: ExportPrefs;
  /** Scribbling over content deletes it. */
  scratch: ScratchPrefs;
  /** Bookmark markers on the pages; never in exports. */
  anchorMarkers: boolean;
  /** Places recently linked to, newest first. */
  recentLinks: InternalLink[];
  /** New photos keep their full size and a high quality; off, they are made smaller. */
  keepOriginalPhotos: boolean;
  /** Pinned tool presets, at most twelve. */
  presets?: ToolPreset[];
  /** Toolbar order and hidden items; the default layout when absent. */
  toolbar?: ToolbarPrefs;
  /** The base tools' settings while a preset is in use. Loading puts them back. */
  presetBase?: ToolSettings;
}

/** How readily a scribble counts as crossing out. */
export type ScratchLevel = 'low' | 'normal' | 'high';

/** The scratch-out settings; in storage the whole field is optional. */
export interface ScratchPrefs {
  on: boolean;
  level: ScratchLevel;
  /** How many times the hint has been shown. */
  hints: number;
}

/** What a stroke must measure to be a scribble, and how much of a target it must cover. */
export interface ScratchThresholds {
  minReversals: number;
  minDensity: number;
  maxPitch: number;
  maxWinding: number;
  minCoverage: number;
}

/** The settings of all tools, as the tools read them. */
export type ToolSettings = Pick<Preferences, 'brush' | 'brushes' | 'hl' | 'er' | 'txt'>;

/** A pinned tool with its settings. */
export type ToolPreset =
  | { id: string; tool: 'pen'; brush: BrushKind; c: string; s: number }
  | { id: string; tool: 'hl'; c: string; s: number }
  | { id: string; tool: 'eraser'; mode: EraserMode; r: number }
  | ({ id: string; tool: 'text' } & TextPrefs);

/** The user's toolbar: item ids in order, and the ones hidden. See ToolbarLayout. */
export interface ToolbarPrefs {
  order: string[];
  hidden: string[];
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
