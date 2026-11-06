import type { Background, Notebook, Page, PageSize, Subject } from '../core/types';
import { StorageBreakdown, type StorageReport } from '../domain/StorageBreakdown';
import type { SampleSeeder } from '../domain/SampleSeeder';
import { ShelfOrder } from '../domain/ShelfOrder';
import { TrashRules, type TrashListing } from '../domain/TrashRules';
import type { BlobRepository } from '../storage/BlobRepository';
import type { NotebookRepository } from '../storage/NotebookRepository';
import { PageRepository } from '../storage/PageRepository';
import type { SubjectRepository } from '../storage/SubjectRepository';

/** Fields edited in the notebook dialog. */
export interface NotebookDraft {
  title: string;
  subjectId: string;
  color: string;
  base: PageSize;
  bg: Background;
}

export interface LibraryRepositories {
  subjects: SubjectRepository;
  notebooks: NotebookRepository;
  pages: PageRepository;
  blobs: BlobRepository;
}

/**
 * The shelf: subjects and notebooks in memory, kept in sync with storage. Views read from
 * here and call its methods; they never touch the repositories directly.
 */
export class LibraryService {
  /** What is on the shelf. Everything that lists, searches or links reads only these. */
  subjects: Subject[] = [];
  notebooks: Notebook[] = [];
  private trashedSubjects: Subject[] = [];
  private trashedNotebooks: Notebook[] = [];

  constructor(
    private readonly repos: LibraryRepositories,
    private readonly makeId: () => string,
    /** Content was written (used to decide whether an automatic backup is needed). */
    private readonly onChange: () => void = () => undefined,
    /** Blobs that stored pages may not reference but the app still needs (the lasso's clipboard). */
    private readonly blobsInUse: () => ReadonlySet<string> = () => new Set(),
    /** Blobs were left for a later cleanup. */
    private readonly onBlobsSpared: () => void = () => undefined,
    private readonly clock: () => number = () => Date.now(),
  ) {}

  /** (Re)loads subjects and notebooks from storage. */
  async load(): Promise<void> {
    const [subjects, notebooks] = await Promise.all([this.repos.subjects.all(), this.repos.notebooks.all()]);
    const shelf = TrashRules.partition(subjects, notebooks);
    this.subjects = shelf.subjects;
    this.notebooks = shelf.notebooks;
    this.trashedSubjects = shelf.trashedSubjects;
    this.trashedNotebooks = shelf.trashedNotebooks;
    for (const subject of shelf.revived) delete subject.deletedAt;
    if (shelf.revived.length) await this.repos.subjects.save(...shelf.revived);
  }

  /** Nothing anywhere, not even in the Trash: only then does a first start add the sample. */
  get isEmpty(): boolean {
    return !this.subjects.length && !this.notebooks.length && !this.trashCount;
  }

  /** Stores the first-run sample shelf. */
  async seed(seeder: SampleSeeder): Promise<void> {
    const data = seeder.build();
    await this.repos.subjects.save(...data.subjects);
    await this.repos.notebooks.save(...data.notebooks);
    await this.repos.pages.save(...data.pages);
    this.subjects.push(...data.subjects);
    this.notebooks.push(...data.notebooks);
  }

  /** Subjects in shelf order. */
  sortedSubjects(): Subject[] {
    return [...this.subjects].sort((a, b) => a.order - b.order);
  }

  subject(id: string): Subject | undefined {
    return this.subjects.find((s) => s.id === id);
  }

  notebook(id: string): Notebook | undefined {
    return this.notebooks.find((n) => n.id === id);
  }

  /**
   * Notebooks of a subject in shelf order: by `order` once the user has arranged them,
   * otherwise (older notebooks) oldest first.
   */
  notebooksOf(subjectId: string): Notebook[] {
    const key = (n: Notebook): number => n.order ?? Number.MAX_SAFE_INTEGER;
    return this.notebooks
      .filter((n) => n.subjectId === subjectId)
      .sort((a, b) => key(a) - key(b) || a.createdAt - b.createdAt);
  }

  /** Moves a subject one place up or down. */
  async moveSubject(subject: Subject, delta: -1 | 1): Promise<void> {
    await this.reorderSubjects(ShelfOrder.step(this.sortedSubjects(), subject, delta).map((s) => s.id));
  }

  /**
   * Stores a new subject order (ids top to bottom). Orders are renumbered 0..n-1 and all
   * subjects are written in one transaction.
   */
  async reorderSubjects(ids: readonly string[]): Promise<void> {
    const rank = (s: Subject): number => {
      const i = ids.indexOf(s.id);
      return i < 0 ? ids.length + s.order : i;
    };
    const ordered = this.sortedSubjects().sort((a, b) => rank(a) - rank(b));
    ShelfOrder.renumber(ordered);
    await this.repos.subjects.save(...ordered);
    this.onChange();
  }

  /** Moves a notebook one place up or down within its subject (numbering all of them). */
  async moveNotebook(nb: Notebook, delta: -1 | 1): Promise<void> {
    const ordered = ShelfOrder.step(this.notebooksOf(nb.subjectId), nb, delta);
    ShelfOrder.renumber(ordered);
    await this.repos.notebooks.save(...ordered);
    this.onChange();
  }

  /** Order for a notebook added to a subject: last, if that subject's notebooks are arranged. */
  private nextNotebookOrder(subjectId: string, except?: Notebook): number | undefined {
    const orders = this.notebooks
      .filter((n) => n.subjectId === subjectId && n !== except && n.order !== undefined)
      .map((n) => n.order ?? 0);
    return orders.length ? Math.max(...orders) + 1 : undefined;
  }

  async createSubject(name: string, color: string): Promise<Subject> {
    const order = this.subjects.reduce((m, s) => Math.max(m, s.order), -1) + 1;
    const subject: Subject = { id: this.makeId(), name, color, order, createdAt: Date.now() };
    this.subjects.push(subject);
    await this.repos.subjects.save(subject);
    this.onChange();
    return subject;
  }

  async updateSubject(subject: Subject, name: string, color: string): Promise<void> {
    subject.name = name;
    subject.color = color;
    await this.repos.subjects.save(subject);
    this.onChange();
  }

  /** Moves a subject and its notebooks to the Trash; nothing is removed from storage. */
  async deleteSubject(subject: Subject): Promise<void> {
    const deletedAt = this.clock();
    const notebooks = this.notebooks.filter((n) => n.subjectId === subject.id);
    subject.deletedAt = deletedAt;
    for (const nb of notebooks) {
      nb.deletedAt = deletedAt;
      nb.deletedWithSubject = true;
    }
    await this.repos.notebooks.saveWithSubject(subject, notebooks);
    this.subjects = this.subjects.filter((s) => s !== subject);
    this.notebooks = this.notebooks.filter((n) => !notebooks.includes(n));
    this.trashedSubjects.push(subject);
    this.trashedNotebooks.push(...notebooks);
    this.onChange();
  }

  /**
   * Creates a notebook. Without `firstPages` it gets one locked page of the base size;
   * with them (from a PDF) those pages are used.
   */
  async createNotebook(draft: NotebookDraft, firstPages?: Page[]): Promise<Notebook> {
    const now = Date.now();
    const nb: Notebook = {
      id: this.makeId(),
      ...draft,
      base: { ...draft.base },
      pageIds: [],
      createdAt: now,
      updatedAt: now,
      view: null,
    };
    const order = this.nextNotebookOrder(draft.subjectId);
    if (order !== undefined) nb.order = order;
    const pages = firstPages?.length ? firstPages : [this.blankPage(nb)];
    for (const p of pages) p.nbId = nb.id;
    nb.pageIds = pages.map((p) => p.id);
    await this.repos.pages.save(...pages);
    await this.repos.notebooks.save(nb);
    this.notebooks.push(nb);
    this.onChange();
    return nb;
  }

  /** A locked page of the notebook's base size and background. */
  blankPage(nb: Notebook): Page {
    return {
      id: this.makeId(),
      nbId: nb.id,
      w: nb.base.w,
      h: nb.base.h,
      locked: true,
      bg: nb.bg,
      bgBlob: null,
      strokes: [],
      texts: [],
      images: [],
      cards: [],
      anchors: [],
      inkLinks: [],
      updatedAt: Date.now(),
    };
  }

  /** Applies dialog changes. Returns true if the base size changed. */
  async updateNotebook(nb: Notebook, draft: NotebookDraft): Promise<boolean> {
    const baseChanged =
      Math.abs(nb.base.w - draft.base.w) > 0.01 || Math.abs(nb.base.h - draft.base.h) > 0.01;
    if (draft.subjectId !== nb.subjectId) {
      // Moved to another subject: it goes last there.
      const order = this.nextNotebookOrder(draft.subjectId, nb);
      if (order === undefined) delete nb.order;
      else nb.order = order;
    }
    Object.assign(nb, { ...draft, base: { ...draft.base }, updatedAt: Date.now() });
    await this.repos.notebooks.save(nb);
    this.onChange();
    return baseChanged;
  }

  /** Moves a notebook to the Trash; its pages and files stay stored. */
  async deleteNotebook(nb: Notebook): Promise<void> {
    nb.deletedAt = this.clock();
    await this.repos.notebooks.save(nb);
    this.notebooks = this.notebooks.filter((n) => n !== nb);
    this.trashedNotebooks.push(nb);
    this.onChange();
  }

  /* ---------- the Trash ---------- */

  /** What the Trash shows. */
  trash(): TrashListing {
    return TrashRules.listing(this.trashedSubjects, this.trashedNotebooks);
  }

  /** How many items the Trash holds, however they are listed. */
  get trashCount(): number {
    return this.trashedSubjects.length + this.trashedNotebooks.length;
  }

  /** A subject's notebooks that went to the Trash with it. */
  deletedWith(subject: Subject): Notebook[] {
    return this.trashedNotebooks.filter((n) => n.subjectId === subject.id && n.deletedWithSubject);
  }

  /** Brings back a subject with the notebooks deleted along with it. */
  async restoreSubject(subject: Subject): Promise<void> {
    const notebooks = this.deletedWith(subject);
    delete subject.deletedAt;
    for (const nb of notebooks) LibraryService.clearDeletion(nb);
    await this.repos.notebooks.saveWithSubject(subject, notebooks);
    this.trashedSubjects = this.trashedSubjects.filter((s) => s !== subject);
    this.trashedNotebooks = this.trashedNotebooks.filter((n) => !notebooks.includes(n));
    this.subjects.push(subject);
    this.notebooks.push(...notebooks);
    this.onChange();
  }

  /**
   * Brings back one notebook. A notebook needs its subject, so a subject in the Trash comes back
   * too, and is returned so the user can be told. The notebooks deleted along with that subject
   * stay in the Trash, each on its own: the user asked for this one. A subject that is gone for
   * good is replaced by a new one called `fallbackName`.
   */
  async restoreNotebook(nb: Notebook, fallbackName: string): Promise<Subject | null> {
    LibraryService.clearDeletion(nb);
    const trashed = this.trashedSubjects.find((s) => s.id === nb.subjectId);
    if (trashed) {
      const siblings = this.deletedWith(trashed);
      delete trashed.deletedAt;
      for (const sibling of siblings) delete sibling.deletedWithSubject;
      await this.repos.notebooks.saveWithSubject(trashed, [nb, ...siblings]);
      this.trashedSubjects = this.trashedSubjects.filter((s) => s !== trashed);
      this.subjects.push(trashed);
    } else if (!this.subject(nb.subjectId)) {
      const replacement = await this.createSubject(fallbackName, nb.color);
      nb.subjectId = replacement.id;
      await this.repos.notebooks.save(nb);
    } else await this.repos.notebooks.save(nb);
    this.trashedNotebooks = this.trashedNotebooks.filter((n) => n !== nb);
    this.notebooks.push(nb);
    this.onChange();
    return trashed ?? null;
  }

  /** Removes a notebook from the Trash for good, with every file nothing else uses. */
  async deleteNotebookForever(nb: Notebook): Promise<void> {
    await this.removeStored([nb]);
    this.trashedNotebooks = this.trashedNotebooks.filter((n) => n !== nb);
    this.onChange();
  }

  /**
   * Removes a subject from the Trash for good, with all its notebooks in the Trash: a notebook
   * deleted earlier on its own would otherwise lose its subject.
   */
  async deleteSubjectForever(subject: Subject): Promise<void> {
    const notebooks = this.trashedNotebooks.filter((n) => n.subjectId === subject.id);
    await this.removeStored(notebooks);
    await this.repos.subjects.delete(subject.id);
    this.trashedNotebooks = this.trashedNotebooks.filter((n) => !notebooks.includes(n));
    this.trashedSubjects = this.trashedSubjects.filter((s) => s !== subject);
    this.onChange();
  }

  /** Removes everything in the Trash for good. */
  async emptyTrash(): Promise<void> {
    for (const subject of [...this.trashedSubjects]) await this.deleteSubjectForever(subject);
    for (const nb of [...this.trashedNotebooks]) await this.deleteNotebookForever(nb);
  }

  /** Removes what has been in the Trash for 30 days. Returns how many items went. */
  async purgeExpired(now: number): Promise<number> {
    const count = this.trashCount;
    const expired = (item: { deletedAt?: number }): boolean =>
      item.deletedAt !== undefined && TrashRules.isExpired(item.deletedAt, now);
    for (const nb of this.trashedNotebooks.filter(expired)) await this.deleteNotebookForever(nb);
    for (const subject of this.trashedSubjects.filter(expired)) await this.deleteSubjectForever(subject);
    return count - this.trashCount;
  }

  private static clearDeletion(nb: Notebook): void {
    delete nb.deletedAt;
    delete nb.deletedWithSubject;
  }

  /** Removes notebooks from storage. Files go only when no remaining page uses them. */
  private async removeStored(notebooks: readonly Notebook[]): Promise<void> {
    for (const nb of notebooks) {
      const pages = await this.repos.pages.ofNotebook(nb.id);
      await this.repos.pages.deleteMany(pages.map((p) => p.id));
      const spared = await this.repos.blobs.deleteUnreferenced(
        PageRepository.blobIds(pages),
        this.blobsInUse(),
      );
      if (spared) this.onBlobsSpared();
      await this.repos.notebooks.delete(nb.id);
    }
  }

  /** What everything takes in storage, the Trash included. */
  async measureStorage(): Promise<StorageReport> {
    const [pages, blobs] = await Promise.all([this.repos.pages.all(), this.repos.blobs.all()]);
    return StorageBreakdown.measure({
      subjects: [...this.subjects, ...this.trashedSubjects],
      notebooks: [...this.notebooks, ...this.trashedNotebooks],
      pages,
      blobs: blobs.map(({ id, blob }) => ({ id, size: blob.size, type: blob.type })),
    });
  }

  /** Pages of a notebook in order (for export of a closed notebook). */
  loadPages(nb: Notebook): Promise<Page[]> {
    return this.repos.pages.loadOrdered(nb);
  }
}
