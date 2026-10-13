import type { AutoBackupInterval, Language, Notebook, Subject } from '../../core/types';

/** What the shelf can ask the app to do. Implemented by ShelfActions. */
export interface LibraryActions {
  openNotebook(nb: Notebook): void;
  exportNotebook(nb: Notebook): void;
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
  /** Moves a subject one place up (-1) or down (+1). */
  moveSubject(subject: Subject, delta: -1 | 1): void;
  /** Stores a subject order from a drag (ids top to bottom). */
  reorderSubjects(ids: readonly string[]): void;
  /** Moves a notebook one place within its subject. */
  moveNotebook(nb: Notebook, delta: -1 | 1): void;
  setAutoBackup(interval: AutoBackupInterval): void;
}
