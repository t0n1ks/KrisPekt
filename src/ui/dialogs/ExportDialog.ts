import { PNG_SCALES, RASTER_DPIS } from '../../core/constants';
import type { ExportFormat, ExportPrefs, ExportScope, PageSize, Preferences } from '../../core/types';
import { el } from '../../core/utils/dom';
import { ExportSizing } from '../../domain/ExportSizing';
import { PageRange } from '../../domain/PageRange';
import type { I18n } from '../../i18n/I18n';
import { ChoiceList } from '../widgets/ChoiceList';
import { field } from '../widgets/field';
import { Segmented } from '../widgets/Segmented';
import type { DialogFactory } from './DialogFactory';

export interface ExportDialogDeps {
  i18n: I18n;
  dialogs: DialogFactory;
  prefs: Preferences;
  savePrefs: () => void;
}

export interface ExportDialogOptions {
  pageCount: number;
  /** The open page (0-based) in the editor; null on the shelf, where "current" is not offered. */
  current: number | null;
  /** The page whose pixel sizes the PNG options show. */
  pageSize: PageSize;
  /** Called with the chosen settings and the pages (0-based indices) to export. */
  onExport: (settings: ExportPrefs, indices: number[]) => void;
}

/** Typed range inputs and the error line under them. */
interface RangeControls {
  row: HTMLDivElement;
  from: HTMLInputElement;
  to: HTMLInputElement;
  error: HTMLParagraphElement;
}

/**
 * The export sheet: format (vector PDF, raster PDF at 300/600 dpi, PNG at 2×/4×/6×), which
 * pages (current, all, or a validated range), then Export. The last choices are remembered.
 */
export class ExportDialog {
  constructor(private readonly deps: ExportDialogDeps) {}

  open(options: ExportDialogOptions): void {
    const { i18n } = this.deps;
    const settings: ExportPrefs = { ...this.deps.prefs.exp };
    if (options.current === null && settings.pages === 'current') settings.pages = 'all';
    const raster = field(i18n.t('exportDpi'), this.dpiPicker(settings));
    const png = this.pngOptions(settings, options.pageSize);
    const showFormat = (): void => {
      raster.hidden = settings.format !== 'pdfRaster';
      png.hidden = settings.format !== 'png';
    };
    const formats = this.formatPicker(settings, showFormat);
    showFormat();
    const range = this.rangeControls(options.pageCount, options.current);
    const pages = this.scopePicker(settings, options.current !== null, range);
    this.deps.dialogs.sheet({
      title: i18n.t('exportTitle'),
      body: el(
        'div',
        { class: 'stack' },
        field(i18n.t('exportFormat'), formats),
        raster,
        png,
        field(
          i18n.t('exportPages'),
          el('div', { class: 'stack stack--tight' }, pages, range.row, range.error),
        ),
      ),
      actions: [
        { label: i18n.t('cancel') },
        { label: i18n.t('exportGo'), primary: true, onClick: () => this.submit(settings, options, range) },
      ],
    });
  }

  /** Validates, remembers the choice and starts the export; false keeps the sheet open. */
  private submit(settings: ExportPrefs, options: ExportDialogOptions, range: RangeControls): boolean {
    const typed = { from: range.from.value, to: range.to.value };
    const result = PageRange.select(settings.pages, options.pageCount, options.current ?? 0, typed);
    range.error.hidden = result.ok;
    if (!result.ok) {
      range.error.scrollIntoView({ block: 'nearest' });
      return false;
    }
    settings.dpi = ExportSizing.clampDpi(settings.dpi);
    settings.scale = ExportSizing.clampScale(settings.scale);
    this.deps.prefs.exp = { ...settings };
    this.deps.savePrefs();
    options.onExport(settings, result.indices);
    return true;
  }

  private formatPicker(settings: ExportPrefs, changed: () => void): HTMLElement {
    const { i18n } = this.deps;
    const choices: { v: ExportFormat; label: string; hint: string }[] = [
      { v: 'pdf', label: i18n.t('fmtPdf'), hint: i18n.t('fmtPdfHint') },
      { v: 'pdfRaster', label: i18n.t('fmtPdfRaster'), hint: i18n.t('fmtPdfRasterHint') },
      { v: 'png', label: i18n.t('fmtPng'), hint: i18n.t('fmtPngHint') },
    ];
    const list = new ChoiceList(
      choices,
      settings.format,
      (v) => {
        settings.format = v;
        changed();
      },
      i18n.t('exportFormat'),
    );
    return list.node;
  }

  private dpiPicker(settings: ExportPrefs): HTMLElement {
    const options = RASTER_DPIS.map((dpi) => ({
      v: String(dpi),
      label: this.deps.i18n.t('dpiValue', { n: dpi }),
    }));
    return new Segmented(options, String(settings.dpi), (v) => {
      settings.dpi = ExportSizing.clampDpi(Number(v));
    }).node;
  }

  /** PNG size choices with the resulting pixel size, and the transparent-background switch. */
  private pngOptions(settings: ExportPrefs, pageSize: PageSize): HTMLElement {
    const { i18n } = this.deps;
    const choices = PNG_SCALES.map((scale) => {
      const size = ExportSizing.pixelSize(pageSize, scale);
      return { v: String(scale), label: `${scale}×`, hint: i18n.t('pngSizeValue', { w: size.w, h: size.h }) };
    });
    const sizes = new ChoiceList(
      choices,
      String(settings.scale),
      (v) => {
        settings.scale = ExportSizing.clampScale(Number(v));
      },
      i18n.t('pngSize'),
    );
    const box = el('input', { class: 'check-row__box', attrs: { type: 'checkbox' } });
    box.checked = settings.transparent;
    box.addEventListener('change', () => {
      settings.transparent = box.checked;
    });
    const transparent = el('label', { class: 'check-row' }, box, el('span', null, i18n.t('pngTransparent')));
    return el('div', { class: 'stack stack--tight' }, field(i18n.t('pngSize'), sizes.node), transparent);
  }

  private scopePicker(settings: ExportPrefs, inEditor: boolean, range: RangeControls): HTMLElement {
    const { i18n } = this.deps;
    const options: { v: ExportScope; label: string }[] = [
      ...(inEditor ? [{ v: 'current' as const, label: i18n.t('pagesCurrent') }] : []),
      { v: 'all', label: i18n.t('pagesAll') },
      { v: 'range', label: i18n.t('pagesRange') },
    ];
    const show = (): void => {
      range.row.hidden = settings.pages !== 'range';
      range.error.hidden = true;
    };
    const picker = new Segmented(options, settings.pages, (v) => {
      settings.pages = v;
      show();
    });
    show();
    return picker.node;
  }

  /** "from [ ] to [ ]", prefilled with the current page (editor) or the whole notebook. */
  private rangeControls(count: number, current: number | null): RangeControls {
    const { i18n } = this.deps;
    const input = (value: number, label: string): HTMLInputElement =>
      el('input', {
        class: 'input range-row__input',
        attrs: {
          type: 'text',
          inputmode: 'numeric',
          maxlength: '6',
          'aria-label': label,
          value: String(value),
        },
      });
    const from = input(current === null ? 1 : current + 1, i18n.t('rangeFrom'));
    const to = input(current === null ? count : current + 1, i18n.t('rangeTo'));
    const row = el(
      'div',
      { class: 'range-row' },
      el('span', null, i18n.t('rangeFrom')),
      from,
      el('span', null, i18n.t('rangeTo')),
      to,
    );
    const error = el('p', { class: 'hint range-row__error' }, i18n.t('rangeInvalid', { n: count }));
    error.hidden = true;
    return { row, from, to, error };
  }
}
