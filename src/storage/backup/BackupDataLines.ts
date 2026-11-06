import { MAX_BACKUP_LINE_BYTES } from '../../core/constants';
import type { Page } from '../../core/types';
import { assertUniqueIds, parseCompactPage, parseDataHead, type DataHead } from '../validation/backup';
import { ValidationError } from '../validation/guards';
import { BackupDamagedError } from './BackupDamagedError';

const LAST_LINE = ']}';
const HEAD_END = ',"pages":[';

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new ValidationError('data', 'not JSON');
  }
}

/**
 * Takes `data.json` apart: a head line ending in `"pages":[`, one page per line, then `]}`. Each
 * line is parsed and checked on arrival and only the result is kept, where a stroke takes far less
 * memory than its JSON numbers would. A file not laid out exactly so is rejected, whatever a general
 * JSON parser would make of it.
 */
export class BackupDataLines {
  private buffer = '';
  private head: DataHead | null = null;
  private readonly pages: Page[] = [];
  private commaOpen = false;

  /** Takes the next piece of text. */
  add(text: string): void {
    this.buffer += text;
    // Only a piece with a line break can complete a line; searching a long line each time is slow.
    if (text.includes('\n')) {
      let end = this.buffer.indexOf('\n');
      while (end >= 0) {
        this.line(this.buffer.slice(0, end));
        this.buffer = this.buffer.slice(end + 1);
        end = this.buffer.indexOf('\n');
      }
    }
    if (this.buffer.length > MAX_BACKUP_LINE_BYTES) throw new BackupDamagedError('line too long');
  }

  /** Everything read; throws if the text stopped anywhere but at its proper end. */
  finish(): { head: DataHead; pages: Page[] } {
    if (this.buffer !== LAST_LINE || !this.head || this.commaOpen) {
      throw new BackupDamagedError('data cut short');
    }
    assertUniqueIds(this.pages, 'pages');
    return { head: this.head, pages: this.pages };
  }

  private line(text: string): void {
    if (!this.head) {
      if (!text.endsWith(HEAD_END)) throw new ValidationError('data', 'bad head');
      this.head = parseDataHead(parseJson(text.slice(0, -HEAD_END.length) + '}'));
      return;
    }
    if (this.pages.length && !this.commaOpen) throw new ValidationError('data', 'missing comma');
    this.commaOpen = text.endsWith(',');
    const raw = parseJson(this.commaOpen ? text.slice(0, -1) : text);
    this.pages.push(parseCompactPage(raw, `pages[${this.pages.length}]`));
  }
}
