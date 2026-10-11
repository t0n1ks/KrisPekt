import { describe, expect, it } from 'vitest';
import { uid } from '../../src/core/utils/id';
import { History } from '../../src/domain/History';
import { PageSizes } from '../../src/domain/PageSizes';
import { SampleSeeder } from '../../src/domain/SampleSeeder';
import { I18n } from '../../src/i18n/I18n';
import { parseNotebook, parsePage, parseSubject } from '../../src/storage/validation/records';
import { page } from './fixtures';

describe('PageSizes', () => {
  const ru = new PageSizes(new I18n('ru'));

  it('matches presets in both orientations with tolerance', () => {
    expect(PageSizes.match(210, 297)).toEqual({ k: 'A4', land: false, sq: false });
    expect(PageSizes.match(297.4, 209.6)).toEqual({ k: 'A4', land: true, sq: false });
    expect(PageSizes.match(215.9, 279.4)).toEqual({ k: 'Letter', land: false, sq: false });
    expect(PageSizes.match(210, 210)).toEqual({ k: 'square', land: false, sq: true });
    expect(PageSizes.match(200, 300)).toBeNull();
  });

  it('builds labels', () => {
    expect(ru.label(210, 297)).toBe('A4, книжная');
    expect(ru.label(297, 210)).toBe('A4, альбомная');
    expect(ru.label(210, 210)).toBe('Квадрат');
    expect(ru.label(200.4, 300.6)).toBe('200×301 мм');
    expect(ru.short(297, 210)).toBe('A4 ↔');
    expect(ru.short(180, 288)).toBe('16:10');
    expect(ru.short(210, 210)).toBe('Кв.');
    expect(new PageSizes(new I18n('en')).label(180, 288)).toBe('Screen 16:10, portrait');
  });
});

describe('History', () => {
  it('undoes and redoes page changes', () => {
    const p = page({ strokes: [] });
    const history = new History();
    history.record(p);
    p.strokes = [{ id: 's1', k: 'pen', c: '#000000', s: 1, p: new Float32Array(3) }];
    const find = (id: string) => (id === p.id ? p : undefined);
    expect(history.undo(find)?.page).toBe(p);
    expect(p.strokes).toEqual([]);
    expect(history.canRedo).toBe(true);
    history.redo(find);
    expect(p.strokes).toHaveLength(1);
  });

  it('reports a resize and skips deleted pages', () => {
    const a = page({ id: 'a', locked: false, w: 210, h: 297 });
    const history = new History();
    history.record(page({ id: 'gone' }));
    history.record(a);
    a.w = 148;
    const pages = new Map([['a', a]]);
    expect(history.undo((id) => pages.get(id))?.resized).toBe(true);
    expect(history.undo((id) => pages.get(id))).toBeNull();
    expect(history.canUndo).toBe(false);
  });

  it('a new change clears redo and the stack is limited', () => {
    const p = page();
    const history = new History(3);
    for (let i = 0; i < 5; i++) history.record(p);
    let steps = 0;
    while (history.undo(() => p)) steps++;
    expect(steps).toBe(3);
    history.record(p);
    expect(history.canRedo).toBe(false);
  });

  it('drops entries of a deleted page', () => {
    const p = page();
    const history = new History();
    history.record(p);
    history.dropPage(p.id);
    expect(history.canUndo).toBe(false);
  });
});

describe('SampleSeeder', () => {
  it('builds valid sample data in the current language', () => {
    const data = new SampleSeeder(new I18n('de'), uid).build(1700000000000);
    expect(data.subjects.map((s) => s.name)).toEqual(['Analysis', 'Geschichte']);
    expect(data.notebooks.map((n) => n.pageIds.length)).toEqual([2, 1]);
    data.subjects.forEach((s) => parseSubject(s));
    data.notebooks.forEach((n) => parseNotebook(n));
    data.pages.forEach((p) => parsePage(p));
    expect(data.pages[0]?.strokes).toHaveLength(10);
  });
});
