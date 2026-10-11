import { COVER_COLORS } from '../../core/constants';
import type { Notebook, Page } from '../../core/types';
import { el } from '../../core/utils/dom';
import type { PageSizes } from '../../domain/PageSizes';
import type { I18n } from '../../i18n/I18n';
import type { LibraryService, NotebookDraft } from '../../services/LibraryService';
import { BackgroundPicker } from '../widgets/BackgroundPicker';
import { ColorPalette } from '../widgets/ColorPalette';
import { field } from '../widgets/field';
import { SizePicker } from '../widgets/SizePicker';
import type { DialogFactory } from './DialogFactory';
import type { Toast } from './Toast';

/** Pages imported from a user-picked PDF, with the file's name (without extension). */
export interface ImportedPdf {
  pages: Page[];
  name: string;
}

export interface NotebookDialogDeps {
  i18n: I18n;
  sizes: PageSizes;
  dialogs: DialogFactory;
  library: LibraryService;
  toast: Toast;
  /** Lets the user pick a PDF and imports its pages; null if cancelled or failed. */
  importPdf: () => Promise<ImportedPdf | null>;
  /** Opens the editor on a newly created notebook. */
  onCreated: (nb: Notebook) => Promise<void>;
  /** Refreshes views after a notebook changed. */
  onUpdated: (nb: Notebook, baseChanged: boolean) => void;
  /** Asks the user to create a subject first. */
  requestSubject: () => void;
  onError: (error: unknown) => void;
}

/** Creates a notebook (blank or from a PDF) or edits one's title, subject, cover, size and background. */
export class NotebookDialog {
  constructor(private readonly deps: NotebookDialogDeps) {}

  open(nb: Notebook | null, subjectId?: string): void {
    const { i18n, library } = this.deps;
    const subjects = library.sortedSubjects();
    const first = subjects[0];
    if (!nb && !first) {
      this.deps.toast.show(i18n.t('needSubject'));
      this.deps.requestSubject();
      return;
    }
    const draft: NotebookDraft = nb
      ? { title: nb.title, subjectId: nb.subjectId, color: nb.color, base: { ...nb.base }, bg: nb.bg }
      : {
          title: '',
          subjectId: subjectId ?? first?.id ?? '',
          color: library.subject(subjectId ?? first?.id ?? '')?.color ?? COVER_COLORS[0],
          base: { w: 210, h: 297 },
          bg: 'gridm',
        };
    const title = el('input', {
      class: 'input',
      attrs: { type: 'text', id: 'nb-title', value: draft.title, placeholder: i18n.t('nbPh'), maxlength: 80 },
    });
    const collect = (): NotebookDraft => ({ ...draft, title: title.value.trim() || i18n.t('untitled') });
    this.deps.dialogs.sheet({
      title: nb ? i18n.t('nbSettings') : i18n.t('newNbTitle'),
      body: this.body(draft, title),
      actions: nb
        ? [{ label: i18n.t('save'), primary: true, onClick: () => this.update(nb, collect()) }]
        : [
            { label: i18n.t('createFromPdf'), onClick: () => this.createFromPdf(collect()) },
            { label: i18n.t('create'), primary: true, onClick: () => this.create(collect()) },
          ],
      focus: !nb,
    });
  }

  private body(draft: NotebookDraft, title: HTMLInputElement): HTMLElement {
    const { i18n, library, sizes } = this.deps;
    const select = el('select', { class: 'input', attrs: { id: 'nb-subject' } });
    for (const s of library.sortedSubjects()) {
      select.append(el('option', { attrs: { value: s.id, selected: s.id === draft.subjectId } }, s.name));
    }
    select.addEventListener('change', () => (draft.subjectId = select.value));
    const colors = ColorPalette.cover(i18n, draft.color, (c) => (draft.color = c));
    const size = new SizePicker(i18n, sizes, draft.base.w, draft.base.h, (w, h) => (draft.base = { w, h }));
    const bg = new BackgroundPicker(i18n, draft.bg, (b) => (draft.bg = b));
    return el(
      'div',
      { class: 'stack' },
      field(i18n.t('nbName'), title),
      field(i18n.t('subject'), select),
      field(i18n.t('cover'), colors.node),
      field(
        i18n.t('nbSize'),
        el(
          'div',
          { class: 'stack stack--tight' },
          size.node,
          el('p', { class: 'hint' }, i18n.t('nbSizeHint')),
        ),
      ),
      field(i18n.t('newBg'), bg.node),
    );
  }

  private async create(draft: NotebookDraft, pages?: Page[]): Promise<void> {
    try {
      const nb = await this.deps.library.createNotebook(draft, pages);
      await this.deps.onCreated(nb);
    } catch (error) {
      this.deps.onError(error);
    }
  }

  /** Keeps the sheet open when the PDF picker is cancelled or the import fails. */
  private async createFromPdf(draft: NotebookDraft): Promise<boolean> {
    const imported = await this.deps.importPdf();
    if (!imported?.pages.length) return false;
    if (draft.title === this.deps.i18n.t('untitled')) draft.title = imported.name.slice(0, 80);
    await this.create(draft, imported.pages);
    return true;
  }

  private async update(nb: Notebook, draft: NotebookDraft): Promise<void> {
    try {
      const baseChanged = await this.deps.library.updateNotebook(nb, draft);
      this.deps.onUpdated(nb, baseChanged);
    } catch (error) {
      this.deps.onError(error);
    }
  }
}
