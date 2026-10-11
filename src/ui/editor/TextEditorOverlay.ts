import type { Camera } from '../../canvas/Camera';
import type { PageLayout } from '../../canvas/PageLayout';
import { MM, TEXT_LINE_HEIGHT } from '../../core/constants';
import type { Page, TextItem, TextPrefs } from '../../core/types';
import { byId } from '../../core/utils/dom';
import { clamp } from '../../core/utils/math';
import type { EditorSession } from '../../editor/EditorSession';
import { MAX_LEN } from '../../storage/validation/guards';

interface Editing {
  page: Page;
  /** The text being changed, or null for a new text box. */
  original: TextItem | null;
  item: TextItem;
}

export interface TextEditorDeps {
  camera: Camera;
  layout: PageLayout;
  session: EditorSession;
  prefs: () => TextPrefs;
  makeId: () => string;
  recordUndo: (page: Page) => void;
}

/**
 * A textarea laid exactly over a text box while it is edited. The original text is hidden
 * from the page bitmap meanwhile. Blur or Escape commits; an emptied box is deleted.
 */
export class TextEditorOverlay {
  private readonly textarea = byId<HTMLTextAreaElement>('textEd');
  private editing: Editing | null = null;

  constructor(private readonly deps: TextEditorDeps) {
    this.textarea.maxLength = MAX_LEN.text;
    this.textarea.addEventListener('input', () => this.position());
    this.textarea.addEventListener('blur', () => this.commit());
    this.textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.textarea.blur();
      }
    });
  }

  get active(): boolean {
    return this.editing !== null;
  }

  /** Id of the text hidden from a page's bitmap while it is being edited. */
  hiddenOn(page: Page): string | null {
    return this.editing?.page === page && this.editing.original ? this.editing.original.id : null;
  }

  /** Starts editing an existing text, or a new one at page point (x, y). */
  start(page: Page, original: TextItem | null, x: number, y: number): void {
    const prefs = this.deps.prefs();
    const pageWidth = page.w * MM;
    let item: TextItem;
    if (original) item = { ...original };
    else {
      const left = clamp(x, 4, pageWidth - 140);
      item = {
        id: this.deps.makeId(),
        x: left,
        y: y - prefs.fs * 0.7,
        w: Math.min(420, pageWidth - left - 12),
        t: '',
        fs: prefs.fs,
        c: prefs.c,
      };
    }
    this.editing = { page, original, item };
    this.textarea.value = item.t;
    this.textarea.hidden = false;
    this.deps.session.bump(page);
    this.position();
    this.textarea.focus();
  }

  /** Keeps the textarea over the text box at the current zoom and scroll. */
  position(): void {
    const e = this.editing;
    if (!e) return;
    const { camera, layout } = this.deps;
    const z = camera.z;
    const pos = layout.pos(e.page);
    const ta = this.textarea;
    const screen = camera.toScreen(pos.x + e.item.x, pos.y + e.item.y);
    ta.style.left = screen.x + 'px';
    ta.style.top = screen.y + 'px';
    ta.style.width = e.item.w * z + 'px';
    ta.style.fontSize = e.item.fs * z + 'px';
    ta.style.setProperty('--text-color', e.item.c);
    ta.style.height = 'auto';
    ta.style.height = Math.max(e.item.fs * z * TEXT_LINE_HEIGHT, ta.scrollHeight) + 'px';
  }

  /** Saves the edit (one undo step) and hides the textarea. */
  commit(): void {
    const e = this.editing;
    if (!e) return;
    this.editing = null;
    this.textarea.hidden = true;
    const value = this.textarea.value.replace(/\s+$/, '');
    const { session } = this.deps;
    const page = e.page;
    if (e.original) {
      if (value === e.original.t) {
        session.bump(page);
        return;
      }
      this.deps.recordUndo(page);
      const i = page.texts.findIndex((x) => x.id === e.original?.id);
      if (i >= 0) {
        if (!value) page.texts.splice(i, 1);
        else page.texts[i] = { ...e.original, t: value };
      }
    } else {
      if (!value) {
        session.bump(page);
        return;
      }
      this.deps.recordUndo(page);
      page.texts.push({ ...e.item, t: value });
    }
    session.touch(page);
  }

  /** Commits through blur so the on-screen keyboard closes too. */
  blur(): void {
    this.textarea.blur();
  }

  applyLabel(label: string): void {
    this.textarea.setAttribute('aria-label', label);
  }
}
