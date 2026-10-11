import type { I18n } from '../../i18n/I18n';

const DAY_MS = 864e5;

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** "today, 14:05", "yesterday", or a short localised date (with the year if it differs). */
export function formatDate(ts: number, i18n: I18n, nowDate: Date = new Date()): string {
  if (!ts) return '';
  const d = new Date(ts);
  const diff = Math.round((startOfDay(nowDate) - startOfDay(d)) / DAY_MS);
  const hm = d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0');
  if (diff === 0) return i18n.t('today', { t: hm });
  if (diff === 1) return i18n.t('yesterday');
  const opts: Intl.DateTimeFormatOptions =
    d.getFullYear() !== nowDate.getFullYear()
      ? { day: 'numeric', month: 'short', year: 'numeric' }
      : { day: 'numeric', month: 'short' };
  try {
    return d.toLocaleDateString(i18n.locale, opts);
  } catch {
    return d.toLocaleDateString();
  }
}

/** `krispekt-YYYY-MM-DD.json` style date stamp. */
export function dateStamp(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Makes a string safe as a file name; falls back to `fallback` when nothing is left. */
export function safeFileName(name: string, fallback: string): string {
  return (
    (name || fallback)
      .replace(/[\\/:*?"<>|]+/g, ' ')
      .trim()
      .slice(0, 80) || fallback
  );
}

/**
 * "today", "yesterday", "3 days ago", "2 months ago" in the interface language, counted in
 * calendar days. Uses the browser's Intl data; falls back to a short date if it is missing.
 */
export function formatRelativeDay(ts: number, i18n: I18n, nowDate: Date = new Date()): string {
  // A timestamp from the future (clock changed) reads as "today".
  const days = Math.max(0, Math.round((startOfDay(nowDate) - startOfDay(new Date(ts))) / DAY_MS));
  try {
    const rtf = new Intl.RelativeTimeFormat(i18n.locale, { numeric: 'auto' });
    if (days < 30) return rtf.format(-days, 'day');
    if (days < 365) return rtf.format(-Math.round(days / 30.44), 'month');
    return rtf.format(-Math.round(days / 365.25), 'year');
  } catch {
    return formatDate(ts, i18n, nowDate);
  }
}
