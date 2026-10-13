import { describe, expect, it } from 'vitest';
import { DEFAULT_EXPORT } from '../../src/core/constants';
import type { Page } from '../../src/core/types';
import { ExportSizing } from '../../src/domain/ExportSizing';
import { PageRange } from '../../src/domain/PageRange';
import { ExportController } from '../../src/features/export/ExportController';
import type { PageRasterizer, RasterOptions } from '../../src/features/export/PageRasterizer';
import { PngExporter } from '../../src/features/export/PngExporter';
import { I18n } from '../../src/i18n/I18n';
import { PreferencesStore } from '../../src/storage/PreferencesStore';
import { page } from './fixtures';

describe('PageRange', () => {
  it('accepts a range inside the notebook', () => {
    expect(PageRange.parse('2', '4', 5)).toEqual({ ok: true, indices: [1, 2, 3] });
    expect(PageRange.parse(' 3 ', '3', 3)).toEqual({ ok: true, indices: [2] });
  });

  it('rejects anything that is not a whole page number inside the notebook', () => {
    for (const [from, to] of [
      ['0', '2'],
      ['2', '6'],
      ['4', '2'],
      ['', '2'],
      ['1.5', '2'],
      ['-1', '2'],
      ['1e1', '20'],
      ['два', '3'],
      ['1', '9999999'],
    ] as const) {
      expect(PageRange.parse(from, to, 5)).toEqual({ ok: false });
    }
  });

  it('selects the current page, all pages or the typed range', () => {
    const typed = { from: '2', to: '3' };
    expect(PageRange.select('current', 4, 2, typed)).toEqual({ ok: true, indices: [2] });
    expect(PageRange.select('current', 4, 9, typed)).toEqual({ ok: true, indices: [3] });
    expect(PageRange.select('all', 3, 0, typed)).toEqual({ ok: true, indices: [0, 1, 2] });
    expect(PageRange.select('range', 4, 0, typed)).toEqual({ ok: true, indices: [1, 2] });
    expect(PageRange.select('all', 0, 0, typed)).toEqual({ ok: false });
  });
});

describe('ExportSizing', () => {
  const a4 = { w: 210, h: 297 };

  it('gives PNG sizes of 2×, 4× and 6× the page at 96 dpi', () => {
    expect(ExportSizing.pixelSize(a4, 2)).toEqual({ w: 1587, h: 2245 });
    expect(ExportSizing.pixelSize(a4, 4)).toEqual({ w: 3175, h: 4490 });
    expect(ExportSizing.pixelSize(a4, 6)).toEqual({ w: 4762, h: 6735 });
    // Landscape pages keep their orientation.
    expect(ExportSizing.pixelSize({ w: 297, h: 210 }, 4)).toEqual({ w: 4490, h: 3175 });
  });

  it('turns dpi into a canvas scale', () => {
    expect(ExportSizing.pixelSize(a4, ExportSizing.scaleForDpi(300))).toEqual({ w: 2480, h: 3508 });
    expect(ExportSizing.pixelSize(a4, ExportSizing.scaleForDpi(600))).toEqual({ w: 4961, h: 7016 });
  });

  it('keeps the asked resolution while a page fits, and lowers it for huge pages', () => {
    const a4at600 = ExportSizing.plan(a4, ExportSizing.scaleForDpi(600));
    expect(a4at600.lowered).toBe(false);
    const poster = ExportSizing.plan({ w: 1200, h: 1200 }, ExportSizing.scaleForDpi(600));
    expect(poster.lowered).toBe(true);
    expect(poster.size.w * poster.size.h).toBeLessThanOrEqual(40e6);
    expect(poster.size.w * poster.size.h).toBeGreaterThan(39e6);
    expect(ExportSizing.dpiOf(poster)).toBeLessThan(600);
    expect(ExportSizing.dpiOf(poster)).toBeGreaterThan(130);
  });

  it('only allows the offered dpi and PNG scales', () => {
    expect(ExportSizing.clampDpi(600)).toBe(600);
    expect(ExportSizing.clampDpi(1200)).toBe(300);
    expect(ExportSizing.clampDpi('600')).toBe(300);
    expect(ExportSizing.clampScale(6)).toBe(6);
    expect(ExportSizing.clampScale(100)).toBe(4);
  });
});

describe('PngExporter', () => {
  it('renders each page at the chosen scale and names files <notebook>-p<N>.png', async () => {
    const calls: RasterOptions[] = [];
    const rasterizer = {
      png: (_page: Page, options: RasterOptions) => {
        calls.push(options);
        return Promise.resolve(new Blob(['png']));
      },
    } as unknown as PageRasterizer;
    const png = new PngExporter(rasterizer, new I18n('ru'), () => undefined);
    const landscape = page({ w: 297, h: 210 });
    const result = await png.export(
      [
        { page: page(), number: 2 },
        { page: landscape, number: 5 },
      ],
      6,
      true,
      'Лекции',
    );
    expect(result.files.map((f) => f.name)).toEqual(['Лекции-p2.png', 'Лекции-p5.png']);
    expect(calls.map((c) => c.size)).toEqual([
      { w: 4762, h: 6735 },
      { w: 6735, h: 4762 },
    ]);
    expect(calls.every((c) => c.scale === 6 && !c.paper)).toBe(true);
    expect(result.lowered).toEqual([]);
  });
});

describe('export file names', () => {
  const numbered = (...numbers: number[]) => numbers.map((number) => ({ page: page(), number }));

  it('marks part of a notebook with its page numbers', () => {
    expect(ExportController.suffix(numbered(1, 2, 3), 3)).toBe('');
    expect(ExportController.suffix(numbered(2), 3)).toBe('-p2');
    expect(ExportController.suffix(numbered(2, 3), 5)).toBe('-p2-3');
  });
});

describe('export preferences', () => {
  it('remembers valid choices and falls back to defaults for anything else', () => {
    const kept = PreferencesStore.sanitize({
      exp: { format: 'png', dpi: 600, scale: 6, transparent: true, pages: 'range' },
    });
    expect(kept.exp).toEqual({ format: 'png', dpi: 600, scale: 6, transparent: true, pages: 'range' });
    const junk = PreferencesStore.sanitize({
      exp: { format: 'svg', dpi: 72, scale: '4', transparent: 'yes', pages: 'odd' },
    });
    expect(junk.exp).toEqual(DEFAULT_EXPORT);
    expect(PreferencesStore.sanitize({}).exp).toEqual({
      format: 'pdf',
      dpi: 300,
      scale: 4,
      transparent: false,
      pages: 'all',
    });
  });
});
