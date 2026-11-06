import { MAX_FILE_NAME } from '../core/constants';

const PDF_EXTENSION = /\.pdf$/i;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i;
/** Characters that do not belong in a name: path separators and what Windows forbids. */
const SEPARATORS = /[\\/:*?"<>|]+/g;

/** Invisible characters, and the ones that reorder text so `exe.pdf` can read as `fdp.exe`. */
function isUnsafe(code: number): boolean {
  return (
    code <= 0x1f ||
    (code >= 0x7f && code <= 0x9f) ||
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069) ||
    code === 0xfeff
  );
}

function withoutUnsafe(text: string): string {
  return Array.from(text)
    .filter((c) => !isUnsafe(c.codePointAt(0) ?? 0))
    .join('');
}

/** Names of attached files and titles of links, cleaned for display and download. Pure. */
export class FileNames {
  /** A label safe to show: no invisible or reordering characters, single spaces, limited length. */
  static label(text: string, max: number): string {
    return withoutUnsafe(text).replace(/\s+/g, ' ').trim().slice(0, max).trim();
  }

  /**
   * A file name safe to show and to save: no path, no forbidden characters, limited length with
   * the extension kept. `fallback` is used when nothing is left.
   */
  static sanitize(name: string, fallback: string): string {
    const clean = withoutUnsafe(name).replace(SEPARATORS, ' ').replace(/\s+/g, ' ').trim();
    const trimmed = clean.replace(/^[.\s]+/, '').replace(/[.\s]+$/, '');
    if (!trimmed) return fallback;
    const safe = WINDOWS_RESERVED.test(trimmed) ? '_' + trimmed : trimmed;
    if (safe.length <= MAX_FILE_NAME) return safe;
    const extension = PDF_EXTENSION.exec(safe)?.[0] ?? '';
    return safe.slice(0, MAX_FILE_NAME - extension.length).trim() + extension;
  }

  /** The name a PDF is saved under: sanitised and ending in `.pdf`. */
  static forPdfDownload(name: string, fallback: string): string {
    const safe = FileNames.sanitize(name, fallback);
    if (PDF_EXTENSION.test(safe)) return safe;
    return safe.slice(0, MAX_FILE_NAME - 4).trim() + '.pdf';
  }
}
