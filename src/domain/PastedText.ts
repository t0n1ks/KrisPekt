/** Unicode line and paragraph separators. */
const LINE_SEPARATORS = [0x2028, 0x2029];
const NO_BREAK_SPACE = 0xa0;
const TAB = 0x09;
const NEWLINE = 0x0a;

/** Control characters, and the invisible ones that can reorder or hide text. */
const UNSAFE_RANGES: readonly [number, number][] = [
  [0x00, 0x1f],
  [0x7f, 0x9f],
  [0x200b, 0x200f],
  [0x202a, 0x202e],
  [0x2060, 0x2069],
  [0xfeff, 0xfeff],
];

/** Turns text from the clipboard into plain text for a text box. Pure, so it can be unit tested. */
export class PastedText {
  /** Clean text: "\n" for every line break, tabs as spaces, no control characters. */
  static clean(raw: string): string {
    let out = '';
    for (const char of raw.replace(/\r\n?/g, '\n')) {
      const code = char.codePointAt(0) ?? 0;
      if (code === NEWLINE || LINE_SEPARATORS.includes(code)) out += '\n';
      else if (code === TAB) out += '    ';
      else if (code === NO_BREAK_SPACE) out += ' ';
      else if (!UNSAFE_RANGES.some(([from, to]) => code >= from && code <= to)) out += char;
    }
    return out;
  }

  /** At most `room` characters, without cutting a surrogate pair in half. */
  static limited(text: string, room: number): string {
    if (text.length <= room) return text;
    if (room <= 0) return '';
    const last = text.charCodeAt(room - 1);
    return text.slice(0, last >= 0xd800 && last <= 0xdbff ? room - 1 : room);
  }
}
