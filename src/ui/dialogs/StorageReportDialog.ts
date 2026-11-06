import type { Notebook } from '../../core/types';
import { el, replaceChildren } from '../../core/utils/dom';
import { formatSize } from '../../core/utils/format';
import type {
  FileKind,
  FileUsage,
  NotebookUsage,
  StorageReport,
  SubjectUsage,
} from '../../domain/StorageBreakdown';
import type { I18n, TextKey } from '../../i18n/I18n';
import type { DialogFactory } from './DialogFactory';
import type { Sheet } from './Sheet';

export interface StorageReportDeps {
  i18n: I18n;
  dialogs: DialogFactory;
  /** What is stored now; rejects if that cannot be read. */
  measure: () => Promise<StorageReport>;
  /** What the browser says about its storage; null when it does not say. */
  browserFigures: () => Promise<{ quota?: number; usage?: number } | null>;
  openNotebook: (nb: Notebook) => void;
}

const KIND_LABELS: Record<FileKind, TextKey> = {
  photo: 'storagePhoto',
  pdf: 'storagePdfFile',
  pdfPage: 'storagePdfPage',
};

/** The size of a type as a person reads it: `image/webp` is WEBP. */
function typeLabel(type: string): string {
  return (type.split('/')[1] ?? type).toUpperCase();
}

/** Library ⋯ → Storage: what takes the space, and what could be done about it. */
export class StorageReportDialog {
  private sheet: Sheet | null = null;

  constructor(private readonly deps: StorageReportDeps) {}

  /** Opens the report; the sheet is up at once, and the figures follow. */
  open(): void {
    const { i18n, dialogs } = this.deps;
    const body = el('div', { class: 'storage' }, el('p', { class: 'hint' }, i18n.t('storageLoading')));
    this.sheet = dialogs.sheet({
      title: i18n.t('storageReport'),
      body,
      onClose: () => (this.sheet = null),
    });
    void this.fill(body);
  }

  private async fill(body: HTMLElement): Promise<void> {
    const { i18n } = this.deps;
    try {
      const [report, browser] = await Promise.all([this.deps.measure(), this.deps.browserFigures()]);
      if (this.sheet) replaceChildren(body, ...this.content(report, browser));
    } catch {
      replaceChildren(body, el('p', { class: 'hint' }, i18n.t('storageFail')));
    }
  }

  private content(report: StorageReport, browser: { quota?: number; usage?: number } | null): HTMLElement[] {
    const { i18n } = this.deps;
    return [
      this.summary(report, browser),
      this.section(
        i18n.t('storageBySubject'),
        report.subjects.map((row) => this.subjectBlock(row)),
      ),
      this.section(
        i18n.t('storageLargest'),
        report.largest.map((file) => this.fileRow(file)),
      ),
      ...this.savingsNote(report),
    ];
  }

  private summary(report: StorageReport, browser: { quota?: number; usage?: number } | null): HTMLElement {
    const { i18n } = this.deps;
    const size = (bytes: number): string => formatSize(bytes, i18n);
    const used = browser?.usage;
    const quota = browser?.quota;
    return el(
      'dl',
      { class: 'storage__figures' },
      ...this.figure(
        i18n.t('storageTotal'),
        size(used ?? report.total) + (quota ? ' ' + i18n.t('storageOutOf', { quota: size(quota) }) : ''),
      ),
      ...this.figure(i18n.t('storageHandwriting'), size(report.overall.handwriting + report.overall.text)),
      ...this.figure(i18n.t('storagePhotos'), size(report.overall.photos)),
      ...this.figure(i18n.t('storagePdfs'), size(report.overall.pdfs)),
      ...this.figure(i18n.t('storageTrash'), size(report.trash)),
    );
  }

  private figure(label: string, value: string): HTMLElement[] {
    return [el('dt', { class: 'storage__label' }, label), el('dd', { class: 'storage__value' }, value)];
  }

  private section(title: string, rows: readonly HTMLElement[]): HTMLElement {
    return el(
      'section',
      { class: 'storage__section' },
      el('h3', { class: 'storage__heading' }, title),
      ...(rows.length ? rows : [el('p', { class: 'hint' }, this.deps.i18n.t('storageNothing'))]),
    );
  }

  private subjectBlock(row: SubjectUsage): HTMLElement {
    const { i18n } = this.deps;
    return el(
      'div',
      { class: 'storage__subject' },
      el(
        'div',
        { class: 'storage__row storage__row--strong' },
        el('span', { class: 'storage__name' }, row.subject?.name ?? ''),
        el('span', { class: 'storage__size' }, formatSize(row.total, i18n)),
      ),
      ...row.notebooks.map((usage) => this.notebookRow(usage)),
    );
  }

  private notebookRow(usage: NotebookUsage): HTMLElement {
    const { i18n } = this.deps;
    const size = (bytes: number): string => formatSize(bytes, i18n);
    return el(
      'div',
      { class: 'storage__row' },
      el(
        'div',
        { class: 'storage__text' },
        el('span', { class: 'storage__name' }, usage.notebook.title),
        el(
          'span',
          { class: 'storage__facts' },
          i18n.t('storageSplit', {
            ink: size(usage.handwriting + usage.text),
            photos: size(usage.photos),
            pdfs: size(usage.pdfs),
          }),
        ),
      ),
      el('span', { class: 'storage__size' }, size(usage.total)),
    );
  }

  private fileRow(file: FileUsage): HTMLElement {
    const { i18n } = this.deps;
    const trashed = file.notebook.deletedAt !== undefined;
    const name = file.name || i18n.t(KIND_LABELS[file.kind]);
    return el(
      'div',
      { class: 'storage__row' },
      el(
        'div',
        { class: 'storage__text' },
        el('span', { class: 'storage__name' }, name),
        el(
          'span',
          { class: 'storage__facts' },
          [
            typeLabel(file.type),
            file.notebook.title + (trashed ? ' · ' + i18n.t('storageInTrash') : ''),
          ].join(' · '),
        ),
      ),
      el('span', { class: 'storage__size' }, formatSize(file.bytes, i18n)),
      trashed
        ? null
        : el(
            'button',
            {
              class: 'btn storage__open',
              attrs: { type: 'button' },
              on: { click: () => this.openNotebook(file.notebook) },
            },
            i18n.t('storageOpen'),
          ),
    );
  }

  private openNotebook(nb: Notebook): void {
    this.sheet?.close();
    this.deps.openNotebook(nb);
  }

  /** Only ever a figure: photos already stored are left as they are. */
  private savingsNote(report: StorageReport): HTMLElement[] {
    const { i18n } = this.deps;
    if (report.photoSavings <= 0) return [];
    const size = formatSize(report.photoSavings, i18n);
    return [el('p', { class: 'hint' }, i18n.t('storageSavings', { size }))];
  }
}
