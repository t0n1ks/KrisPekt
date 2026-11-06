import type {
  AutoBackupInterval,
  Background,
  BrushKind,
  ExportPrefs,
  Language,
  PenPrefs,
  PngScale,
  Preferences,
  RasterDpi,
  ScratchLevel,
  ScratchThresholds,
} from './types';

/* ---------- units and layout ---------- */

/** World px per millimetre (CSS reference pixel at 96 dpi). */
export const MM = 96 / 25.4;
/** World px between pages. */
export const GAP = 30;
export const ZOOM_MIN = 0.15;
export const ZOOM_MAX = 8;
/** Ruler height in screen px. */
export const RULER_H = 64;

/* ---------- rendering limits ---------- */

/** Device pixel ratio is capped to keep canvases affordable on high-density screens. */
export const MAX_DPR = 2;
/** Max pixels in a page-cache bitmap; larger pages are drawn directly. */
export const MAX_CACHE_PX = 14e6;
/**
 * Max pixels of a page bitmap repainted during a pinch (its old bitmap was outdated). Lower than
 * {@link MAX_CACHE_PX} so the repaint stays fast; the pinch end repaints at full quality.
 */
export const PINCH_CACHE_PX = 4e6;
/** Decoded images / PDF pages kept in memory. */
export const BITMAP_LRU_SIZE = 8;
/** Page caches kept when they are off-screen. */
export const PAGE_CACHE_KEEP = 3;

export const TEXT_FONT = '"Onest", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
/** Font sizes offered for text, in world px. */
export const TEXT_SIZES: readonly number[] = [10, 12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 64];
/** Text line height as a multiple of the font size. */
export const TEXT_LINE_HEIGHT = 1.35;

/* ---------- paper colours drawn on the canvas (same in both themes) ---------- */

export const PAPER = {
  white: '#FFFFFF',
  /** Overlay colour drawn on white paper: lasso, selection frame. */
  ui: '#2343B0',
  lassoFill: 'rgba(35,67,176,.07)',
  grid: '#C3D3E8',
  gridMargin: '#E47F86',
  lines: '#BCCDE4',
  linesMargin: '#E9A1A7',
  dots: '#9CB1CD',
  /** Placeholder while a PDF background is loading. */
  bgPlaceholder: '#F2F4F7',
  /** Placeholder while an image is loading. */
  imagePlaceholder: '#EEF1F5',
  eraserFill: 'rgba(255,255,255,.35)',
  eraserRing: 'rgba(30,40,60,.7)',
  /** Linked words on the page. */
  link: '#1D4ED8',
  /** A link whose target was deleted. */
  linkBroken: '#B3261E',
  /** The bookmark marker at an anchor. */
  anchorMark: '#C9822B',
  cardFill: '#F6F8FB',
  cardEdge: '#C5CFDC',
  cardTitle: '#1B2433',
  cardMeta: '#566274',
  cardProblem: '#B3261E',
  cardBadge: '#C22A36',
  cardBadgeText: '#FFFFFF',
} as const;

/** Fallbacks when theme variables cannot be read. */
export const THEME_FALLBACK = {
  desk: '#E3E7ED',
  shadow: 'rgba(0,0,0,.2)',
  label: '#7A8494',
  fg: '#171C26',
  muted: '#596273',
} as const;

/* ---------- palettes ---------- */

/**
 * Cover and subject colours: a 6 × 4 grid of deep and muted shades that suit the white cover
 * label, with pastels in the last row. The first eight are the original palette, so existing
 * covers still show as selected. Names: `coverColorNames`.
 */
export const COVER_COLORS = [
  '#2F5DA8',
  '#2E7D5B',
  '#1E8C93',
  '#B23A48',
  '#C9822B',
  '#6B4FA0',
  '#B5527A',
  '#3D4451',
  '#1F3A68',
  '#1F5A3D',
  '#7A2234',
  '#7B5236',
  '#C9A227',
  '#155E63',
  '#5E6B2E',
  '#4A2B5E',
  '#4C6A92',
  '#1C1F26',
  '#A9C4E8',
  '#B5D8B8',
  '#F1C0CF',
  '#F3E3A1',
  '#CDBDE8',
  '#E3CBA8',
] as const;
/**
 * Pen palette: a 6 × 5 grid in reading order. Columns are hues (blue, red, green, purple,
 * orange, teal), the first four rows go from deep to bright, the last row is neutral from black
 * to light grey. Every colour stays readable on white paper. Names: `penColorNames`.
 */
export const PEN_COLORS = [
  '#172554',
  '#7F1D1D',
  '#14532D',
  '#4C1D95',
  '#7C2D12',
  '#134E4A',
  '#1E40AF',
  '#C81E2C',
  '#15803D',
  '#7C3AED',
  '#C2410C',
  '#0E7490',
  '#2563EB',
  '#E11D48',
  '#16A34A',
  '#9333EA',
  '#EA580C',
  '#0891B2',
  '#3B82F6',
  '#EF4444',
  '#65A30D',
  '#C026D3',
  '#D97706',
  '#0D9488',
  '#000000',
  '#16181D',
  '#374151',
  '#4B5563',
  '#6B7280',
  '#9CA3AF',
] as const;
/** Highlighter palette: six neon colours, then their pastel versions. Names: `hlColorNames`. */
export const HL_COLORS = [
  '#FDE047',
  '#4ADE80',
  '#F472B6',
  '#38BDF8',
  '#FB923C',
  '#C084FC',
  '#FEF08A',
  '#86EFAC',
  '#F9A8D4',
  '#7DD3FC',
  '#FDBA74',
  '#D8B4FE',
] as const;
/** Swatch columns of the pen and highlighter palettes. */
export const PALETTE_COLUMNS = 6;
/** Pinned colours in the tray. */
export const MAX_FAVORITES = 5;
/** Custom colours remembered per tool. */
export const MAX_RECENT_COLORS = 8;
export const BACKGROUNDS: readonly Background[] = ['plain', 'grid', 'gridm', 'lines', 'dots'];

/* ---------- languages ---------- */

export interface LanguageInfo {
  k: Language;
  /** Short code shown on the language pill. */
  short: string;
  /** Endonym, identical in every interface language. */
  name: string;
}
export const LANGUAGES: readonly LanguageInfo[] = [
  { k: 'uk', short: 'UA', name: 'Українська' },
  { k: 'ru', short: 'RU', name: 'Русский' },
  { k: 'de', short: 'DE', name: 'Deutsch' },
  { k: 'en', short: 'EN', name: 'English' },
];
export const LOCALES: Record<Language, string> = { uk: 'uk-UA', ru: 'ru-RU', de: 'de-DE', en: 'en-GB' };
export const FALLBACK_LANGUAGE: Language = 'ru';

/* ---------- storage ---------- */

export const DB_NAME = 'konspektnik';
export const DB_VERSION = 1;
export const DB_OPEN_TIMEOUT_MS = 5000;
export const PREFS_KEY = 'konspektnik.prefs.v1';
export const BACKUP_APP = 'krispekt';
export const BACKUP_APP_LEGACY = 'konspektnik';
/** The ZIP backup. Old JSON backups have `version: 1`. */
export const BACKUP_FORMAT = 2;

/* ---------- pen brushes ---------- */

/** Brush ids in the order shown in the pen options. */
export const BRUSH_KINDS: readonly BrushKind[] = ['ballpoint', 'fountain', 'fineliner', 'pencil', 'brush'];

export interface BrushSpec {
  /** Colour and size a brush starts with. */
  defaults: PenPrefs;
  /** Size slider range in world px. */
  min: number;
  max: number;
  step: number;
}

export const BRUSH_SPECS: Record<BrushKind, BrushSpec> = {
  ballpoint: { defaults: { c: '#1E40AF', s: 2 }, min: 0.6, max: 8, step: 0.1 },
  fountain: { defaults: { c: '#172554', s: 2.4 }, min: 0.8, max: 10, step: 0.1 },
  fineliner: { defaults: { c: '#16181D', s: 1.2 }, min: 0.4, max: 6, step: 0.1 },
  pencil: { defaults: { c: '#4B5563', s: 1.6 }, min: 0.6, max: 6, step: 0.1 },
  brush: { defaults: { c: '#16181D', s: 4 }, min: 1, max: 20, step: 0.5 },
};

/** Export starts as a vector PDF of all pages. */
export const DEFAULT_EXPORT: ExportPrefs = {
  format: 'pdf',
  dpi: 300,
  scale: 4,
  transparent: false,
  pages: 'all',
};

export const DEFAULT_PREFS: Preferences = {
  brush: 'ballpoint',
  brushes: {
    ballpoint: { ...BRUSH_SPECS.ballpoint.defaults },
    fountain: { ...BRUSH_SPECS.fountain.defaults },
    fineliner: { ...BRUSH_SPECS.fineliner.defaults },
    pencil: { ...BRUSH_SPECS.pencil.defaults },
    brush: { ...BRUSH_SPECS.brush.defaults },
  },
  hl: { c: '#FDE047', s: 18 },
  er: { mode: 'part', r: 16 },
  txt: { fs: 18, c: '#16181D' },
  favs: ['#1E40AF', '#16181D', '#C81E2C'],
  recent: { pen: [], hl: [] },
  fingerDraw: true,
  fingerSet: false,
  twoFingerUndo: true,
  twoFingerScroll: false,
  straighten: true,
  scratch: { on: true, level: 'normal', hints: 0 },
  anchorMarkers: true,
  recentLinks: [],
  keepOriginalPhotos: false,
  seeded: false,
  blobSweepDue: true,
  autoBackup: '3days',
  lastBackupAt: 0,
  lastBackupBytes: 0,
  lastChangeAt: 0,
  exp: { ...DEFAULT_EXPORT },
};

/* ---------- scratch out ---------- */

export const SCRATCH_LEVEL_NAMES = ['low', 'normal', 'high'] as const;
/**
 * The limits of each sensitivity (see ScribbleDetector for what they measure). The pitch limits
 * are the fine line. Normal keeps a narrow "www", at about 0.18, as writing, and so also a coarse
 * zigzag of the same shape. High accepts both, because there has to be something to delete under
 * them, while "ж", at about 0.21, and an ordinary "www", at about 0.25, stay writing at every level.
 */
export const SCRATCH_LEVELS: Record<ScratchLevel, ScratchThresholds> = {
  low: { minReversals: 6, minDensity: 3.5, maxPitch: 0.11, maxWinding: 0.5, minCoverage: 0.75 },
  normal: { minReversals: 4, minDensity: 2.8, maxPitch: 0.16, maxWinding: 0.6, minCoverage: 0.6 },
  high: { minReversals: 3, minDensity: 2.2, maxPitch: 0.2, maxWinding: 0.7, minCoverage: 0.5 },
};
/** A reversal is a retreat over this share of a stroke's extent along its axis. */
export const SCRATCH_MIN_SWING = 0.5;
/** Fewer points than this are too few to go back and forth. */
export const SCRATCH_MIN_POINTS = 12;
/** A scribble is at least this big on the screen, in CSS px. */
export const SCRATCH_MIN_EXTENT_PX = 10;
/** The margin around a scribble's hull: this many ink widths, or this share of its shorter side. */
export const SCRATCH_MARGIN_INK = 2;
export const SCRATCH_MARGIN_SIDE = 0.25;
/** A word with this share of its characters covered goes as a whole. */
export const SCRATCH_WORD_SHARE = 0.6;
export const SCRATCH_FADE_MS = 150;
/** The hint shows this many times, and each time for this long. */
export const SCRATCH_HINT_COUNT = 3;
export const SCRATCH_HINT_MS = 4000;

/* ---------- toolbar ---------- */

/** Most pinned presets on the toolbar. */
export const MAX_TOOL_PRESETS = 12;
/**
 * Sizes the toolbar's overflow rule counts with, so that it never has to measure. They must match
 * `.tool-tray` in editor.css: the side margins, padding and border, a button, and the gap.
 */
export const TOOLBAR_CHROME_WIDTH = 24 + 12;
export const TOOLBAR_ITEM_WIDTH = 44;
export const TOOLBAR_GAP = 2;

/* ---------- automatic backup ---------- */

export const AUTO_BACKUP_INTERVALS: readonly AutoBackupInterval[] = ['daily', '3days', 'weekly', 'off'];
export const DAY_MS = 24 * 60 * 60 * 1000;
/** Days between automatic backups for each setting. */
export const AUTO_BACKUP_DAYS: Record<Exclude<AutoBackupInterval, 'off'>, number> = {
  daily: 1,
  '3days': 3,
  weekly: 7,
};
/** Backups larger than this are downloaded automatically at most once a week. */
export const LARGE_BACKUP_BYTES = 50 * 1024 * 1024;
export const LARGE_BACKUP_MIN_DAYS = 7;
/** Wait after start-up before an automatic backup, so it does not compete with the first render. */
export const AUTO_BACKUP_DELAY_MS = 2000;
/** While a dialog is open the automatic backup waits and retries after this long. */
export const AUTO_BACKUP_RETRY_MS = 3000;
/** Coming back after this long in the background counts as opening the app again. */
export const AUTO_BACKUP_RESUME_MS = 60 * 60 * 1000;
/** The shelf's backup status turns amber when the last backup is older than this and there are changes. */
export const BACKUP_STALE_DAYS = 7;
/** Holding a subject's drag handle this long starts dragging on touch screens. */
export const DRAG_LONG_PRESS_MS = 300;

/** Debounce before dirty pages are written. */
export const SAVE_DELAY_PAGE_MS = 700;
/** Debounce before notebook metadata is written. */
export const SAVE_DELAY_NOTEBOOK_MS = 300;
export const UNDO_LIMIT = 150;

/* ---------- input timing ---------- */

/**
 * Palm rejection (see `TouchClassifier`). A touch contact wider or taller than this many CSS px
 * is a palm. Tune with the input diagnostics overlay on the real tablet.
 */
export const PALM_SIZE_PX = 28;
/** A writing session lasts this long after the last pen event (down, move or hover). */
export const PEN_SESSION_MS = 1500;
/** A single finger starts scrolling only after moving more than this many px … */
export const PAN_START_SLOP_PX = 10;
/** … and no sooner than this long after it landed. */
export const PAN_START_DELAY_MS = 80;
/** A pen-down this soon after a single-finger pan ended puts the camera back where the pan started. */
export const PAN_REVERT_MS = 700;
/** A two-finger tap does not undo if the pen was active this recently. */
export const UNDO_PEN_QUIET_MS = 1000;
/** This many simultaneous touches are a palm or a grip and are all ignored. */
export const MAX_TOUCH_CONTACTS = 3;
/** A single-finger touch shorter than this … */
export const TAP_MAX_MS = 400;
/** … that moved less than this many px is a tap for the active tool. */
export const TAP_SLOP_PX = 8;
/** Pointer events kept by the input diagnostics overlay. */
export const INPUT_LOG_SIZE = 20;
/** Holding the stylus still this long straightens the line. */
export const STRAIGHTEN_HOLD_MS = 650;
/** Holding a tray button this long opens its menu or options instead of a tap action. */
export const LONG_PRESS_MS = 500;
/** Two-finger tap → undo, when shorter than this … */
export const TWO_FINGER_TAP_MS = 300;
/** … and moving less than this many px. */
export const TWO_FINGER_TAP_SLOP = 10;
/** "Pages deleted · Undo" stays this long; the pages' images are removed after it. */
export const PAGE_UNDO_WINDOW_MS = 6000;
/** A cleanup left over from the last run waits this long after start, so it never slows the start. */
export const BLOB_SWEEP_DELAY_MS = 4000;
/** Painted page thumbnails kept in memory (thumbnails on screen are always kept). */
export const THUMBNAIL_CACHE_SIZE = 60;
/** Two fingers must change their distance by this many px before they zoom … */
export const PINCH_ZOOM_SLOP_PX = 20;
/** … and by at least this share of how far they moved together, otherwise they are scrolling. */
export const PINCH_SPREAD_PER_TRAVEL = 0.5;
/** "Zoom locked at …" appears at most this often when a gesture tries to zoom. */
export const ZOOM_LOCK_HINT_MS = 5000;

/* ---------- anchors and internal links ---------- */

export const MAX_ANCHOR_NAME = 80;
/** A page's optional title, in characters. */
export const MAX_PAGE_TITLE = 120;
/** How many jumps "Back" remembers. */
export const NAV_HISTORY_LIMIT = 20;
/** How long the place a link led to stays highlighted; the animation in editor.css matches. */
export const JUMP_HIGHLIGHT_MS = 1000;
/** Recently used link targets offered first. */
export const MAX_RECENT_LINKS = 6;
/** The text of a new table of contents, in world px. */
export const CONTENTS_FONT_SIZE = 16;

/* ---------- trash ---------- */

/** Deleted notebooks and subjects stay this long. */
export const TRASH_DAYS = 30;
/** How often an app left open looks for items whose time is up. */
export const TRASH_PURGE_INTERVAL_MS = 60 * 60 * 1000;

/* ---------- import / export limits ---------- */

/** Largest old JSON backup: it has to fit in one string in memory. */
export const MAX_BACKUP_BYTES = 300 * 1024 * 1024;
/* What a ZIP backup may hold. Restoring reads it entry by entry, so these are not memory limits for the whole. */
export const MAX_BACKUP_ENTRIES = 60_000;
/** Largest file in a backup; each is in memory while it is checked. */
export const MAX_BACKUP_ENTRY_BYTES = 256 * 1024 * 1024;
/** Largest manifest: its list of entries, at most about 7 MB. */
export const MAX_BACKUP_MANIFEST_BYTES = 16 * 1024 * 1024;
export const MAX_BACKUP_DATA_BYTES = 2 * 1024 * 1024 * 1024;
/** Longest line in `data.json`: one page, or the head. */
export const MAX_BACKUP_LINE_BYTES = 128 * 1024 * 1024;
/** Sum of all entries, unpacked. */
export const MAX_BACKUP_TOTAL_BYTES = 16 * 1024 * 1024 * 1024;
/** A ZIP without ZIP64 cannot be larger than 4 GiB; this leaves room for its directory. */
export const MAX_BACKUP_FILE_BYTES = 4 * 1024 * 1024 * 1024 - 16 * 1024 * 1024;
/** How much an entry may shrink, once it is over the floor. Deflate tops out near 1030:1. */
export const MAX_BACKUP_RATIO = 500;
export const MAX_BACKUP_RATIO_FLOOR = 1024 * 1024;
export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
export const MAX_BLOB_BYTES = 25 * 1024 * 1024;
export const MAX_PDF_BYTES = 200 * 1024 * 1024;
export const MAX_PDF_PAGES = 500;
/** Largest PDF that can be attached to a page. */
export const MAX_ATTACHMENT_PDF_BYTES = 50 * 1024 * 1024;
/** Longest web address, after normalising. */
export const MAX_URL_LENGTH = 2048;
/** Longest attached file name shown or saved. */
export const MAX_FILE_NAME = 120;
/** Storage must have this many times the size of a new attachment free. */
export const STORAGE_ROOM_FACTOR = 1.1;
/** Card heights in world px; lasso scaling may change them. */
export const CARD_HEIGHT = { pdf: 104, link: 68 } as const;
/** Free space on each side of a new card, in world px (12 mm). */
export const CARD_MARGIN = 45;
export const CARD_MIN_WIDTH = 150;
/** Width of the ⋮ zone at a card's right end, per unit of its height. */
export const CARD_MENU_ZONE = 0.55;
/** Thumbnails of attached PDFs: portrait 3:4, the first page fitted inside. */
export const CARD_THUMB_WIDTH = 240;
export const CARD_THUMB_HEIGHT = 320;
export const CARD_THUMB_QUALITY = 0.8;
/** How long the "tap the page" hint waits. */
export const CARD_PLACE_HINT_MS = 30_000;
/** Largest canvas one page of the built-in PDF viewer may take, in pixels. */
export const VIEWER_MAX_PIXELS = 8e6;
export const VIEWER_ZOOM_MIN = 1;
export const VIEWER_ZOOM_MAX = 5;
/** How far beyond the visible part of the viewer pages are rendered, in px. */
export const VIEWER_RENDER_MARGIN = 900;
/** Rendered pages kept in the viewer; the farthest are released first. */
export const VIEWER_KEEP_PAGES = 6;
/** New photos are at most this long on their longer side. */
export const IMAGE_MAX_EDGE = 2560;
/** WebP or JPEG quality of new photos. */
export const IMAGE_QUALITY = 0.85;
/** The same with "Keep original photo quality", which also keeps the full size. */
export const IMAGE_ORIGINAL_QUALITY = 0.95;
/** Longer side of the small copy that tells whether an image has transparency. */
export const IMAGE_ALPHA_SAMPLE_EDGE = 512;
/** Files of a type backups do not allow are converted to JPEG this large and this good. */
export const IMAGE_LEGACY_MAX_EDGE = 2200;
export const IMAGE_JPEG_QUALITY = 0.88;
/** A WebP photo goes into a vector PDF as JPEG (PDF has no WebP); a PNG could be ten times larger. */
export const PDF_WEBP_JPEG_QUALITY = 0.92;
export const PDF_IMPORT_WIDTH = 1800;
export const PDF_IMPORT_MAX_SCALE = 3;
export const PDF_IMPORT_JPEG_QUALITY = 0.86;
export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

/* ---------- export ---------- */

/** PDF points per world px (72 pt per inch; world px are 96 per inch). */
export const PT_PER_PX = 72 / 96;
/**
 * Canvas scale used for background patterns in vector PDF: lines 0.5 world px (0.375 pt)
 * wide, as in the earlier 2× export.
 */
export const PDF_PATTERN_SCALE = 2;
/** The text font embedded in vector PDFs (same-origin, loaded only during export). */
export const PDF_FONT_FILE = 'fonts/Onest-Regular.ttf';
/** Its own name in a PDF: viewers tell embedded fonts apart by name, and may merge two with one name. */
export const PDF_BOLD_FONT_NAME = 'Onest-Bold';
export const PDF_BOLD_FONT_FILE = 'fonts/Onest-Bold.ttf';
export const PDF_FONT_NAME = 'Onest';
/** Resolutions offered for raster PDF. */
export const RASTER_DPIS: readonly RasterDpi[] = [300, 600];
/** PNG export sizes, as multiples of the page at 96 dpi. */
export const PNG_SCALES: readonly PngScale[] = [2, 4, 6];
/** Largest raster page in pixels; a bigger page is rendered at a lower resolution. */
export const EXPORT_MAX_PX = 40e6;
