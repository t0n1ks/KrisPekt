import type { Background, Notebook, Page, PageSize, Subject } from '../core/types';
import type { SampleSeeder } from '../domain/SampleSeeder';
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
  subjects: Subject[] = [];
  notebooks: Notebook[] = [];

  constructor(
    private readonly repos: LibraryRepositories,
    private readonly makeId: () => string,
  ) {}

  /** (Re)loads subjects and notebooks from storage. */
  async load(): Promise<void> {
    [this.subjects, this.notebooks] = await Promise.all([
      this.repos.subjects.all(),
      this.repos.notebooks.all(),
    ]);
  }

  get isEmpty(): boolean {
    return !this.subjects.length && !this.notebooks.length;
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

  /** Notebooks of a subject, oldest first. */
  notebooksOf(subjectId: string): Notebook[] {
    return this.notebooks.filter((n) => n.subjectId === subjectId).sort((a, b) => a.createdAt - b.createdAt);
  }

  async createSubject(name: string, color: string): Promise<Subject> {
    const order = this.subjects.reduce((m, s) => Math.max(m, s.order), -1) + 1;
    const subject: Subject = { id: this.makeId(), name, color, order, createdAt: Date.now() };
    this.subjects.push(subject);
    await this.repos.subjects.save(subject);
    return subject;
  }

  async updateSubject(subject: Subject, name: string, color: string): Promise<void> {
    subject.name = name;
    subject.color = color;
    await this.repos.subjects.save(subject);
  }

  /** Deletes a subject with all its notebooks, pages and images. */
  async deleteSubject(subject: Subject): Promise<void> {
    for (const nb of this.notebooks.filter((n) => n.subjectId === subject.id)) await this.deleteNotebook(nb);
    this.subjects = this.subjects.filter((s) => s !== subject);
    await this.repos.subjects.delete(subject.id);
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
    const pages = firstPages?.length ? firstPages : [this.blankPage(nb)];
    for (const p of pages) p.nbId = nb.id;
    nb.pageIds = pages.map((p) => p.id);
    await this.repos.pages.save(...pages);
    await this.repos.notebooks.save(nb);
    this.notebooks.push(nb);
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
      updatedAt: Date.now(),
    };
  }

  /** Applies dialog changes. Returns true if the base size changed. */
  async updateNotebook(nb: Notebook, draft: NotebookDraft): Promise<boolean> {
    const baseChanged =
      Math.abs(nb.base.w - draft.base.w) > 0.01 || Math.abs(nb.base.h - draft.base.h) > 0.01;
    Object.assign(nb, { ...draft, base: { ...draft.base }, updatedAt: Date.now() });
    await this.repos.notebooks.save(nb);
    return baseChanged;
  }

  /** Deletes a notebook with its pages and every image they use. */
  async deleteNotebook(nb: Notebook): Promise<void> {
    const pages = await this.repos.pages.ofNotebook(nb.id);
    await this.repos.pages.deleteMany(pages.map((p) => p.id));
    await this.repos.blobs.deleteMany([...PageRepository.blobIds(pages)]);
    await this.repos.notebooks.delete(nb.id);
    this.notebooks = this.notebooks.filter((n) => n !== nb);
  }

  /** Pages of a notebook in order (for export of a closed notebook). */
  loadPages(nb: Notebook): Promise<Page[]> {
    return this.repos.pages.loadOrdered(nb);
  }
}
