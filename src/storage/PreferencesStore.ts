import {
  AUTO_BACKUP_INTERVALS,
  BRUSH_KINDS,
  BRUSH_SPECS,
  DEFAULT_PREFS,
  MAX_FAVORITES,
  MAX_RECENT_COLORS,
  PREFS_KEY,
} from '../core/constants';
import type { BrushKind, EraserMode, PenPrefs, Preferences } from '../core/types';
import { toClampedNumber } from '../core/utils/math';
import { isLanguage } from '../i18n/I18n';
import { COLOR_PATTERN, isRecord, type UnknownRecord } from './validation/guards';

/** Value ranges for tool settings (match the sliders and text presets). */
export const PREF_RANGES = {
  hl: [6, 40],
  eraser: [6, 60],
  textSize: [6, 200],
} as const;

/** Latest accepted timestamp (the ECMAScript date limit). */
const MAX_TIMESTAMP = 8.64e15;

function color(raw: unknown, fallback: string): string {
  return typeof raw === 'string' && COLOR_PATTERN.test(raw) ? raw : fallback;
}

function bool(raw: unknown, fallback: boolean): boolean {
  return typeof raw === 'boolean' ? raw : fallback;
}

function section(raw: UnknownRecord, key: string): UnknownRecord {
  const value = raw[key];
  return isRecord(value) ? value : {};
}

/** Valid colours from an untrusted list, at most `max`. */
function colorList(raw: unknown, max: number): string[] | null {
  if (!Array.isArray(raw)) return null;
  return raw.filter((c): c is string => typeof c === 'string' && COLOR_PATTERN.test(c)).slice(0, max);
}

function brushKind(raw: unknown): BrushKind {
  return BRUSH_KINDS.find((k) => k === raw) ?? DEFAULT_PREFS.brush;
}

/**
 * Colour and size per brush. Preferences saved before brushes existed have a single `pen`
 * entry, which becomes the ballpoint's settings.
 */
function brushPrefs(raw: UnknownRecord): Record<BrushKind, PenPrefs> {
  const stored = section(raw, 'brushes');
  const legacyPen = section(raw, 'pen');
  const entry = (kind: BrushKind): PenPrefs => {
    const spec = BRUSH_SPECS[kind];
    const value = isRecord(stored[kind]) ? stored[kind] : kind === 'ballpoint' ? legacyPen : {};
    return {
      c: color(value.c, spec.defaults.c),
      s: toClampedNumber(value.s, spec.min, spec.max, spec.defaults.s),
    };
  };
  const out = {} as Record<BrushKind, PenPrefs>;
  for (const kind of BRUSH_KINDS) out[kind] = entry(kind);
  return out;
}

/**
 * Loads and saves {@link Preferences} in localStorage (`konspektnik.prefs.v1`).
 * Stored values are merged over the defaults and every field is validated, so a
 * damaged or tampered entry can only fall back to defaults.
 */
export class PreferencesStore {
  constructor(private readonly storage: Storage | null = PreferencesStore.defaultStorage()) {}

  private static defaultStorage(): Storage | null {
    try {
      return globalThis.localStorage ?? null;
    } catch {
      return null;
    }
  }

  /** Reads preferences, falling back to defaults when storage is blocked or the value is invalid. */
  load(): Preferences {
    let raw: unknown;
    try {
      const text = this.storage?.getItem(PREFS_KEY);
      raw = text ? JSON.parse(text) : null;
    } catch {
      raw = null;
    }
    return PreferencesStore.sanitize(isRecord(raw) ? raw : {});
  }

  /** Writes preferences. Failures (quota, blocked storage) are ignored like in the prototype. */
  save(prefs: Preferences): void {
    try {
      this.storage?.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      /* storage blocked: preferences last for this session only */
    }
  }

  /** Builds valid preferences from an untrusted object. */
  static sanitize(raw: UnknownRecord): Preferences {
    const d = DEFAULT_PREFS;
    const hl = section(raw, 'hl');
    const er = section(raw, 'er');
    const txt = section(raw, 'txt');
    const recent = section(raw, 'recent');
    const prefs: Preferences = {
      brush: brushKind(raw.brush),
      brushes: brushPrefs(raw),
      hl: { c: color(hl.c, d.hl.c), s: toClampedNumber(hl.s, ...PREF_RANGES.hl, d.hl.s) },
      er: {
        mode: er.mode === 'whole' || er.mode === 'part' ? (er.mode as EraserMode) : d.er.mode,
        r: toClampedNumber(er.r, ...PREF_RANGES.eraser, d.er.r),
      },
      txt: { fs: toClampedNumber(txt.fs, ...PREF_RANGES.textSize, d.txt.fs), c: color(txt.c, d.txt.c) },
      favs: colorList(raw.favs, MAX_FAVORITES) ?? [...d.favs],
      recent: {
        pen: colorList(recent.pen, MAX_RECENT_COLORS) ?? [],
        hl: colorList(recent.hl, MAX_RECENT_COLORS) ?? [],
      },
      fingerDraw: bool(raw.fingerDraw, d.fingerDraw),
      fingerSet: bool(raw.fingerSet, d.fingerSet),
      twoFingerUndo: bool(raw.twoFingerUndo, d.twoFingerUndo),
      twoFingerScroll: bool(raw.twoFingerScroll, d.twoFingerScroll),
      straighten: bool(raw.straighten, d.straighten),
      seeded: bool(raw.seeded, d.seeded),
      autoBackup: AUTO_BACKUP_INTERVALS.find((v) => v === raw.autoBackup) ?? d.autoBackup,
      lastBackupAt: toClampedNumber(raw.lastBackupAt, 0, MAX_TIMESTAMP, d.lastBackupAt),
      lastBackupBytes: toClampedNumber(raw.lastBackupBytes, 0, Number.MAX_SAFE_INTEGER, d.lastBackupBytes),
      lastChangeAt: toClampedNumber(raw.lastChangeAt, 0, MAX_TIMESTAMP, d.lastChangeAt),
    };
    if (isLanguage(raw.lang)) prefs.lang = raw.lang;
    return prefs;
  }
}
