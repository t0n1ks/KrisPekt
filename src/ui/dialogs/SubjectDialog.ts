import { COVER_COLORS } from '../../core/constants';
import type { Subject } from '../../core/types';
import { el } from '../../core/utils/dom';
import type { I18n } from '../../i18n/I18n';
import type { LibraryService } from '../../services/LibraryService';
import { ColorPalette } from '../widgets/ColorPalette';
import { field } from '../widgets/field';
import type { DialogFactory } from './DialogFactory';
import type { Toast } from './Toast';

export interface SubjectDialogDeps {
  i18n: I18n;
  dialogs: DialogFactory;
  library: LibraryService;
  toast: Toast;
  /** Called after a subject was created or changed. */
  onSaved: () => void;
  /** Called when saving failed (storage error). */
  onError: (error: unknown) => void;
}

/** Creates a subject or renames / recolours one. */
export class SubjectDialog {
  constructor(private readonly deps: SubjectDialogDeps) {}

  open(subject: Subject | null): void {
    const { i18n, library } = this.deps;
    let color = subject
      ? subject.color
      : (COVER_COLORS[library.subjects.length % COVER_COLORS.length] ?? COVER_COLORS[0]);
    const name = el('input', {
      class: 'input',
      attrs: {
        type: 'text',
        id: 'subj-name',
        value: subject?.name ?? '',
        placeholder: i18n.t('subjPh'),
        maxlength: 60,
      },
    });
    const colors = ColorPalette.cover(i18n, color, (c) => (color = c));
    this.deps.dialogs.sheet({
      title: subject ? i18n.t('subject') : i18n.t('newSubject'),
      body: el(
        'div',
        { class: 'stack' },
        field(i18n.t('subjName'), name),
        field(i18n.t('color'), colors.node),
      ),
      actions: [
        {
          label: subject ? i18n.t('save') : i18n.t('createSubject'),
          primary: true,
          onClick: () => this.save(subject, name, color),
        },
      ],
      focus: true,
    });
  }

  private async save(subject: Subject | null, input: HTMLInputElement, color: string): Promise<boolean> {
    const { i18n, library } = this.deps;
    const name = input.value.trim();
    if (!name) {
      input.focus();
      this.deps.toast.show(i18n.t('enterSubj'));
      return false;
    }
    try {
      if (subject) await library.updateSubject(subject, name, color);
      else await library.createSubject(name, color);
    } catch (error) {
      this.deps.onError(error);
    }
    this.deps.onSaved();
    return true;
  }
}
