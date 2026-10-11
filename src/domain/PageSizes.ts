import type { I18n } from '../i18n/I18n';

export type PresetKey = 'A4' | 'A5' | 'B5' | 'A3' | 'Letter' | 'screen' | 'square';

export interface SizePreset {
  k: PresetKey;
  /** Portrait width in mm. */
  w: number;
  /** Portrait height in mm. */
  h: number;
}

export interface PresetMatch {
  k: PresetKey;
  /** True when the page is the preset turned sideways. */
  land: boolean;
  /** True for square presets, which have no orientation. */
  sq: boolean;
}

/** Page sizes offered in the size picker. */
export const SIZE_PRESETS: readonly SizePreset[] = [
  { k: 'A4', w: 210, h: 297 },
  { k: 'A5', w: 148, h: 210 },
  { k: 'B5', w: 176, h: 250 },
  { k: 'A3', w: 297, h: 420 },
  { k: 'Letter', w: 216, h: 279 },
  { k: 'screen', w: 180, h: 288 },
  { k: 'square', w: 210, h: 210 },
];

/** Sizes within this many mm of a preset count as that preset (PDF pages are not exact). */
const TOLERANCE_MM = 1.5;

/** Preset lookup and human-readable labels for page sizes. */
export class PageSizes {
  constructor(private readonly i18n: I18n) {}

  /** Finds the preset a size matches, in portrait or landscape. */
  static match(w: number, h: number): PresetMatch | null {
    for (const s of SIZE_PRESETS) {
      if (Math.abs(s.w - w) < TOLERANCE_MM && Math.abs(s.h - h) < TOLERANCE_MM) {
        return { k: s.k, land: false, sq: s.w === s.h };
      }
      if (Math.abs(s.h - w) < TOLERANCE_MM && Math.abs(s.w - h) < TOLERANCE_MM) {
        return { k: s.k, land: true, sq: false };
      }
    }
    return null;
  }

  /** Display name of a preset ("A4", "Экран 16:10", "Квадрат"). */
  name(k: PresetKey): string {
    if (k === 'screen') return this.i18n.t('size_screen');
    if (k === 'square') return this.i18n.t('size_square');
    return k;
  }

  /** Long label: "A4, книжная", "Квадрат", or "200×300 мм". */
  label(w: number, h: number): string {
    const m = PageSizes.match(w, h);
    if (m) {
      if (m.sq) return this.name(m.k);
      return this.name(m.k) + ', ' + this.i18n.t(m.land ? 'landscape' : 'portrait');
    }
    return Math.round(w) + '×' + Math.round(h) + ' ' + this.i18n.t('mm');
  }

  /** Short label for pills: "A4", "A4 ↔", "16:10", "Кв.", or "200×300". */
  short(w: number, h: number): string {
    const m = PageSizes.match(w, h);
    if (m) {
      if (m.sq) return this.i18n.t('sqShort');
      return (m.k === 'screen' ? '16:10' : m.k) + (m.land ? ' ↔' : '');
    }
    return Math.round(w) + '×' + Math.round(h);
  }
}
