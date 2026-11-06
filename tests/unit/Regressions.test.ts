// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../../src/app/EventBus';
import type { Page } from '../../src/core/types';
import { PageOperations } from '../../src/editor/PageOperations';
import { I18n } from '../../src/i18n/I18n';
import { Sheet } from '../../src/ui/dialogs/Sheet';
import { el } from '../../src/core/utils/dom';
import { page } from './fixtures';

describe('duplicating a page', () => {
  it('gives the copy items of its own, so that moving one onto the other cannot merge them', () => {
    const original = page({
      id: 'a',
      images: [{ id: 'im1', x: 0, y: 0, w: 1, h: 1, blob: 'b' }],
    });
    let added: Page[] = [];
    let next = 0;
    const ops = new PageOperations({
      session: { nb: { base: { w: 210, h: 297 } }, insert: (_a: Page, pages: Page[]) => (added = pages) },
      viewport: { relayout: vi.fn(), scrollTo: vi.fn() },
      saveQueue: { flush: vi.fn() },
      makeId: () => 'new' + next++,
      settle: vi.fn(),
      onPagesChanged: vi.fn(),
    } as never);
    ops.duplicate(original);
    const copy = added[0] as Page;
    const idsOf = (p: Page): string[] =>
      [...p.strokes, ...p.texts, ...p.images, ...p.cards].map((item) => item.id);
    expect(idsOf(copy)).toHaveLength(idsOf(original).length);
    for (const id of idsOf(copy)) expect(idsOf(original)).not.toContain(id);
  });
});

describe('a sheet and the on-screen keyboard', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.textContent = '';
  });

  it('stays inside what the keyboard leaves of the screen', () => {
    const listeners = new Map<string, () => void>();
    const view = {
      offsetTop: 0,
      height: 800,
      addEventListener: (type: string, fn: () => void) => listeners.set(type, fn),
      removeEventListener: (type: string) => listeners.delete(type),
    };
    vi.stubGlobal('visualViewport', view);
    const sheet = new Sheet(new I18n('en'), new EventBus(), { title: 'T', body: el('div') }).open();
    const scrim = document.querySelector<HTMLElement>('.scrim');
    expect(scrim?.style.getPropertyValue('--view-height')).toBe('800px');
    view.height = 400;
    listeners.get('resize')?.();
    expect(scrim?.style.getPropertyValue('--view-height')).toBe('400px');
    sheet.close();
    expect(listeners.size).toBe(0);
  });
});
