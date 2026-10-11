import { DEFAULT_PREFS, PREFS_KEY } from '../core/constants';
import type { EraserMode, Preferences } from '../core/types';
import { toClampedNumber } from '../core/utils/math';
import { isLanguage } from '../i18n/I18n';
import { COLOR_PATTERN, isRecord, type UnknownRecord } from './validation/guards';

/** Value ranges for tool settings (match the sliders and text presets). */
export const PREF_RANGES = {
  pen: [0.6, 8],
  hl: [6, 40],
  eraser: [6, 60],
  textSize: [6, 200],
} as const;

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
    const pen = section(raw, 'pen');
    const hl = section(raw, 'hl');
    const er = section(raw, 'er');
    const txt = section(raw, 'txt');
    const favs = Array.isArray(raw.favs)
      ? raw.favs.filter((c) => typeof c === 'string' && COLOR_PATTERN.test(c))
      : null;
    const prefs: Preferences = {
      pen: { c: color(pen.c, d.pen.c), s: toClampedNumber(pen.s, ...PREF_RANGES.pen, d.pen.s) },
      hl: { c: color(hl.c, d.hl.c), s: toClampedNumber(hl.s, ...PREF_RANGES.hl, d.hl.s) },
      er: {
        mode: er.mode === 'whole' || er.mode === 'part' ? (er.mode as EraserMode) : d.er.mode,
        r: toClampedNumber(er.r, ...PREF_RANGES.eraser, d.er.r),
      },
      txt: { fs: toClampedNumber(txt.fs, ...PREF_RANGES.textSize, d.txt.fs), c: color(txt.c, d.txt.c) },
      favs: favs ? (favs as string[]).slice(0, 3) : [...d.favs],
      fingerDraw: bool(raw.fingerDraw, d.fingerDraw),
      fingerSet: bool(raw.fingerSet, d.fingerSet),
      straighten: bool(raw.straighten, d.straighten),
      seeded: bool(raw.seeded, d.seeded),
    };
    if (isLanguage(raw.lang)) prefs.lang = raw.lang;
    return prefs;
  }
}
