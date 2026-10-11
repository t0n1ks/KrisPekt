import type { Language, Notebook, Preferences } from '../core/types';
import { safeFileName } from '../core/utils/format';
import { uid } from '../core/utils/id';
import { PageSizePolicy } from '../domain/PageSizePolicy';
import { PageSizes } from '../domain/PageSizes';
import { SampleSeeder } from '../domain/SampleSeeder';
import { FileSaver } from '../features/files/FileSaver';
import { ImageEncoder } from '../features/images/ImageEncoder';
import { PdfImporter } from '../features/pdf/PdfImporter';
import { PdfLoader } from '../features/pdf/PdfLoader';
import { I18n } from '../i18n/I18n';
import { LibraryService } from '../services/LibraryService';
import { BackupService } from '../storage/BackupService';
import { BlobRepository } from '../storage/BlobRepository';
import { Database } from '../storage/Database';
import { NotebookRepository } from '../storage/NotebookRepository';
import { PageRepository } from '../storage/PageRepository';
import { PreferencesStore } from '../storage/PreferencesStore';
import { RecordReader } from '../storage/RecordReader';
import { SaveQueue } from '../storage/SaveQueue';
import { SubjectRepository } from '../storage/SubjectRepository';
import { DialogFactory } from '../ui/dialogs/DialogFactory';
import { Menu } from '../ui/dialogs/Menu';
import { NotebookDialog } from '../ui/dialogs/NotebookDialog';
import { StorageInfoDialog } from '../ui/dialogs/StorageInfoDialog';
import { SubjectDialog } from '../ui/dialogs/SubjectDialog';
import { Toast } from '../ui/dialogs/Toast';
import { EditorView } from '../ui/editor/EditorView';
import { BackupFlow } from '../ui/library/BackupFlow';
import { LibraryView } from '../ui/library/LibraryView';
import { ShelfActions } from '../ui/library/ShelfActions';
import { EventBus } from './EventBus';

interface Repositories {
  subjects: SubjectRepository;
  notebooks: NotebookRepository;
  pages: PageRepository;
  blobs: BlobRepository;
}

/**
 * Composition root: creates every service and view, passes dependencies in through
 * constructors, and switches between the shelf and the editor. Nothing else creates
 * long-lived objects or holds global state.
 */
export class App {
  private readonly bus = new EventBus();
  private readonly prefsStore = new PreferencesStore();
  private readonly prefs: Preferences;
  private readonly i18n: I18n;
  private readonly sizes: PageSizes;
  private readonly toast = new Toast();
  private readonly menu: Menu;
  private readonly dialogs: DialogFactory;
  private readonly files: FileSaver;
  private readonly repos: Repositories;
  private readonly library: LibraryService;
  private readonly saveQueue: SaveQueue;
  private readonly imageEncoder = new ImageEncoder();
  private readonly pdfImporter: PdfImporter;
  private readonly subjectDialog: SubjectDialog;
  private readonly notebookDialog: NotebookDialog;
  private readonly editor: EditorView;
  private readonly libraryView: LibraryView;
  private corruptToastPending = false;

  private constructor(private readonly db: Database) {
    this.prefs = this.prefsStore.load();
    this.i18n = new I18n(this.prefs.lang ?? I18n.detectLanguage(navigator.languages ?? [navigator.language]));
    this.sizes = new PageSizes(this.i18n);
    this.menu = new Menu(this.bus);
    this.dialogs = new DialogFactory(this.i18n, this.bus);
    this.files = new FileSaver(this.i18n, (m) => this.toast.show(m));
    const reader = new RecordReader(() => this.reportCorruptRecord());
    this.repos = {
      subjects: new SubjectRepository(db, reader),
      notebooks: new NotebookRepository(db, reader),
      pages: new PageRepository(db, reader),
      blobs: new BlobRepository(db, reader),
    };
    this.library = new LibraryService(this.repos, uid);
    this.saveQueue = new SaveQueue(this.repos.pages, this.repos.notebooks, () => this.storageError());
    this.pdfImporter = new PdfImporter({
      loader: new PdfLoader(),
      blobs: this.repos.blobs,
      i18n: this.i18n,
      makeId: uid,
      notify: (m, ms) => this.toast.show(m, ms),
    });
    this.subjectDialog = this.createSubjectDialog();
    this.notebookDialog = this.createNotebookDialog();
    this.editor = this.createEditor();
    this.libraryView = this.createLibraryView();
  }

  /** Opens storage and starts the app. */
  static async start(): Promise<App> {
    const app = new App(await Database.open());
    await app.boot();
    return app;
  }

  /* ---------- construction ---------- */

  private createSubjectDialog(): SubjectDialog {
    return new SubjectDialog({
      i18n: this.i18n,
      dialogs: this.dialogs,
      library: this.library,
      toast: this.toast,
      onSaved: () => this.libraryView.render(),
      onError: () => this.storageError(),
    });
  }

  private createNotebookDialog(): NotebookDialog {
    return new NotebookDialog({
      i18n: this.i18n,
      sizes: this.sizes,
      dialogs: this.dialogs,
      library: this.library,
      toast: this.toast,
      importPdf: () => this.pdfImporter.pickAndImport(),
      onCreated: async (nb) => {
        this.libraryView.render();
        await this.openNotebook(nb);
      },
      onUpdated: (nb, baseChanged) => {
        this.editor.notebookUpdated(nb, baseChanged);
        this.libraryView.render();
      },
      requestSubject: () => this.subjectDialog.open(null),
      onError: () => this.storageError(),
    });
  }

  private createEditor(): EditorView {
    return new EditorView({
      i18n: this.i18n,
      bus: this.bus,
      prefs: this.prefs,
      savePrefs: () => this.prefsStore.save(this.prefs),
      sizes: this.sizes,
      menu: this.menu,
      dialogs: this.dialogs,
      toast: this.toast,
      pages: this.repos.pages,
      blobs: this.repos.blobs,
      saveQueue: this.saveQueue,
      imageEncoder: this.imageEncoder,
      pdfImporter: this.pdfImporter,
      makeId: uid,
      onStorageError: () => this.storageError(),
      actions: {
        closed: () => this.libraryView.show(),
        editNotebook: (nb) => this.notebookDialog.open(nb),
        exportPdf: (nb) => void this.exportPdf(nb),
        setLanguage: (l) => this.setLanguage(l),
        subjectName: (id) => this.library.subject(id)?.name ?? '',
      },
    });
  }

  private createLibraryView(): LibraryView {
    const rerender = (): void => this.libraryView.render();
    const backup = new BackupFlow({
      i18n: this.i18n,
      backup: new BackupService(this.db, this.repos, (blob) => this.imageEncoder.reencode(blob)),
      library: this.library,
      files: this.files,
      dialogs: this.dialogs,
      toast: this.toast,
      flush: () => this.saveQueue.flush(),
      onRestored: rerender,
    });
    const actions = new ShelfActions({
      i18n: this.i18n,
      library: this.library,
      dialogs: this.dialogs,
      toast: this.toast,
      subjectDialog: this.subjectDialog,
      notebookDialog: this.notebookDialog,
      storageInfo: new StorageInfoDialog(this.i18n, this.dialogs),
      backup,
      persistent: () => this.db.persistent,
      openNotebook: (nb) => void this.openNotebook(nb),
      exportPdf: (nb) => void this.exportPdf(nb),
      setLanguage: (l) => this.setLanguage(l),
      rerender,
      onError: () => this.storageError(),
    });
    return new LibraryView({ i18n: this.i18n, library: this.library, menu: this.menu, actions });
  }

  /* ---------- lifecycle ---------- */

  private async boot(): Promise<void> {
    this.applyLanguage();
    try {
      await this.library.load();
    } catch {
      this.library.subjects = [];
      this.library.notebooks = [];
    }
    // Seed once; without persistent storage the sample is shown on every visit.
    if (this.library.isEmpty && (!this.prefs.seeded || !this.db.persistent)) {
      try {
        await this.library.seed(new SampleSeeder(this.i18n, uid));
        this.prefs.seeded = true;
        this.prefsStore.save(this.prefs);
      } catch {
        /* the shelf stays empty */
      }
    }
    this.libraryView.show();
    this.watchLifecycle();
  }

  /** Saves pending edits whenever the page may be closed or frozen. */
  private watchLifecycle(): void {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void this.saveQueue.flush(true);
    });
    window.addEventListener('pagehide', () => void this.saveQueue.flush(true));
  }

  private async openNotebook(nb: Notebook): Promise<void> {
    this.menu.close();
    this.libraryView.hide();
    if (!(await this.editor.open(nb))) this.libraryView.show();
  }

  /** Exports a notebook (open or closed) to PDF and saves it. */
  private async exportPdf(nb: Notebook): Promise<void> {
    await this.saveQueue.flush(true);
    let pages = this.editor.pagesOf(nb);
    if (!pages) {
      try {
        pages = await this.library.loadPages(nb);
      } catch {
        this.storageError();
        return;
      }
      for (const p of pages) PageSizePolicy.enforceLock(p, nb.base);
    }
    const blob = await this.editor.renderPdf(pages);
    if (blob) await this.files.save(safeFileName(nb.title, this.i18n.t('defName')) + '.pdf', blob);
  }

  /* ---------- language and errors ---------- */

  private setLanguage(language: Language): void {
    if (!this.i18n.setLanguage(language)) return;
    this.prefs.lang = language;
    this.prefsStore.save(this.prefs);
    this.applyLanguage();
    this.libraryView.render();
    this.bus.emit('language-changed', language);
  }

  private applyLanguage(): void {
    document.documentElement.lang = this.i18n.language;
    document.title = 'KrisPekt';
    this.libraryView.applyLanguage(!this.db.persistent);
    this.editor.applyLanguage();
  }

  private storageError(): void {
    this.toast.show(this.i18n.t('saveFail'));
  }

  /** Shows one toast for any number of damaged records found in one go. */
  private reportCorruptRecord(): void {
    if (this.corruptToastPending) return;
    this.corruptToastPending = true;
    setTimeout(() => {
      this.corruptToastPending = false;
      this.toast.show(this.i18n.t('badRecords'), 4000);
    }, 0);
  }
}
