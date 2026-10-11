import type { Background, Language, Preferences } from './types';

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
/** Decoded images / PDF pages kept in memory. */
export const BITMAP_LRU_SIZE = 8;
/** Page caches kept when they are off-screen. */
export const PAGE_CACHE_KEEP = 3;

export const TEXT_FONT = '"Onest", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
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

export const COVER_COLORS = [
  '#2F5DA8',
  '#2E7D5B',
  '#B23A48',
  '#C9822B',
  '#6B4FA0',
  '#3D4451',
  '#1E8C93',
  '#B5527A',
] as const;
export const PEN_COLORS = [
  '#1E40AF',
  '#16181D',
  '#C81E2C',
  '#15803D',
  '#7C3AED',
  '#C2410C',
  '#0E7490',
  '#6B7280',
] as const;
export const HL_COLORS = ['#FDE047', '#86EFAC', '#F9A8D4', '#7DD3FC', '#FDBA74'] as const;
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

export const DEFAULT_PREFS: Preferences = {
  pen: { c: '#1E40AF', s: 2 },
  hl: { c: '#FDE047', s: 18 },
  er: { mode: 'part', r: 16 },
  txt: { fs: 18, c: '#16181D' },
  favs: ['#1E40AF', '#16181D', '#C81E2C'],
  fingerDraw: true,
  fingerSet: false,
  straighten: true,
  seeded: false,
};

/** Debounce before dirty pages are written. */
export const SAVE_DELAY_PAGE_MS = 700;
/** Debounce before notebook metadata is written. */
export const SAVE_DELAY_NOTEBOOK_MS = 300;
export const UNDO_LIMIT = 150;

/* ---------- input timing ---------- */

/** Touches are ignored while the pen is down and this long after any pen activity (palm rejection). */
export const PALM_REJECT_MS = 500;
/** A pen-down revokes a touch pan that started less than this long ago. */
export const PAN_REVOKE_MS = 400;
/** Holding the stylus still this long straightens the line. */
export const STRAIGHTEN_HOLD_MS = 650;
/** Two-finger tap → undo, when shorter than this … */
export const TWO_FINGER_TAP_MS = 300;
/** … and moving less than this many px. */
export const TWO_FINGER_TAP_SLOP = 10;

/* ---------- import / export limits ---------- */

export const MAX_BACKUP_BYTES = 300 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
export const MAX_BLOB_BYTES = 25 * 1024 * 1024;
export const MAX_PDF_BYTES = 200 * 1024 * 1024;
export const MAX_PDF_PAGES = 500;
export const IMAGE_MAX_EDGE = 2200;
export const IMAGE_JPEG_QUALITY = 0.88;
export const PDF_IMPORT_WIDTH = 1800;
export const PDF_IMPORT_MAX_SCALE = 3;
export const PDF_IMPORT_JPEG_QUALITY = 0.86;
export const PDF_EXPORT_SCALE = 2;
export const PDF_EXPORT_JPEG_QUALITY = 0.9;
export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
