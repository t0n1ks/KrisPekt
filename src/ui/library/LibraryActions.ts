import type { Language, Notebook, Subject } from '../../core/types';

/** What the shelf can ask the app to do. Implemented by ShelfActions. */
export interface LibraryActions {
  openNotebook(nb: Notebook): void;
  exportPdf(nb: Notebook): void;
  newSubject(): void;
  editSubject(subject: Subject): void;
  deleteSubject(subject: Subject): void;
  newNotebook(subjectId?: string): void;
  editNotebook(nb: Notebook): void;
  deleteNotebook(nb: Notebook): void;
  saveBackup(): void;
  restoreBackup(): void;
  showStorageInfo(): void;
  setLanguage(language: Language): void;
}
