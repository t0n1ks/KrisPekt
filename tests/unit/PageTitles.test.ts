import { describe, expect, it } from 'vitest';
import type { Anchor, InternalLink, Notebook, Page, Subject, TextParagraph } from '../../src/core/types';
import { AnchorMarks } from '../../src/domain/AnchorMarks';
import { History } from '../../src/domain/History';
import { LinkDirectory } from '../../src/domain/LinkDirectory';
import { LinkRules } from '../../src/domain/LinkRules';
import { PdfOutline } from '../../src/domain/PdfOutline';
import { RichTextLayout } from '../../src/domain/RichTextLayout';
import { TableOfContents, type ContentsStyle } from '../../src/domain/TableOfContents';
import { PageRepository } from '../../src/storage/PageRepository';
import { NotebookRepository } from '../../src/storage/NotebookRepository';
import { finishNotebooks } from '../../src/storage/validation/backup';
import { parseNotebook, parsePage } from '../../src/storage/validation/records';

const RECT = { x: 0, y: 0, w: 1, h: 1 };

function anchor(overrides: Partial<Anchor> = {}): Anchor {
  return { id: 'an1', name: 'Theorem', items: ['st1'], rect: RECT, ...overrides };
}

function page(overrides: Partial<Page> = {}): Page {
  return {
    id: 'pg1',
    nbId: 'nb1',
    w: 210,
    h: 297,
    locked: false,
    bg: 'plain',
    bgBlob: null,
    strokes: [],
    texts: [],
    images: [],
    cards: [],
    anchors: [],
    inkLinks: [],
    updatedAt: 1,
    ...overrides,
  };
}

function notebook(overrides: Partial<Notebook> = {}): Notebook {
  return {
    id: 'nb1',
    subjectId: 'su1',
    title: 'Calculus',
    color: '#123456',
    base: { w: 210, h: 297 },
    bg: 'plain',
    pageIds: ['pg1', 'pg2'],
    createdAt: 1,
    updatedAt: 1,
    view: null,
    ...overrides,
  };
}

describe('a page title', () => {
  it('is optional: pages stored before titles existed load as they were', () => {
    const { title: _none, ...old } = page();
    expect('title' in parsePage(old)).toBe(false);
    expect(parsePage({ ...old, title: null }).title).toBeUndefined();
    expect('title' in parsePage({ ...old, title: '   ' })).toBe(false);
  });

  it('is kept when valid and refused when it is not text or too long', () => {
    expect(parsePage(page({ title: 'Lecture 5. Integrals' })).title).toBe('Lecture 5. Integrals');
    expect(() => parsePage({ ...page(), title: 5 })).toThrow();
    expect(() => parsePage({ ...page(), title: 'x'.repeat(121) })).toThrow();
  });

  it('is written to storage only when there is one', () => {
    expect(PageRepository.toRecord(page({ title: 'One' })).title).toBe('One');
    expect('title' in PageRepository.toRecord(page())).toBe(false);
  });

  it('is one undo step like anything else on the page', () => {
    const p = page({ title: 'Before' });
    const snapshot = History.snapshot(p);
    p.title = 'After';
    History.apply(p, snapshot);
    expect(p.title).toBe('Before');

    const untitled = page();
    const blank = History.snapshot(untitled);
    untitled.title = 'After';
    History.apply(untitled, blank);
    expect('title' in untitled).toBe(false);
  });
});

describe('the titles a notebook lists', () => {
  it('follow its pages, in order', () => {
    const titles = AnchorMarks.titles([
      { id: 'a', title: 'First' },
      { id: 'b' },
      { id: 'c', title: 'Third' },
    ]);
    expect(titles).toEqual([
      { pageId: 'a', title: 'First' },
      { pageId: 'c', title: 'Third' },
    ]);
  });

  it('survive storage and are validated', () => {
    const nb = notebook({ pageTitles: [{ pageId: 'pg1', title: 'One' }] });
    expect(parseNotebook(NotebookRepository.toRecord(nb)).pageTitles).toEqual(nb.pageTitles);
    expect(() => parseNotebook({ ...nb, pageTitles: [{ pageId: '../x', title: 'One' }] })).toThrow();
    expect(parseNotebook(notebook()).pageTitles).toBeUndefined();
  });

  it('in a backup come from its pages, whatever the file says', () => {
    const lying = notebook({ pageTitles: [{ pageId: 'pg2', title: 'Made up' }] });
    const [fixed] = finishNotebooks([lying], [page({ title: 'Real' }), page({ id: 'pg2' })]);
    expect(fixed?.pageTitles).toEqual([{ pageId: 'pg1', title: 'Real' }]);
    const [none] = finishNotebooks([lying], [page(), page({ id: 'pg2' })]);
    expect(none && 'pageTitles' in none).toBe(false);
  });
});

describe('finding a titled page', () => {
  const subject = { id: 'su1', name: 'Math' } as Subject;
  const directory = (nb: Notebook): LinkDirectory =>
    new LinkDirectory({
      notebook: (id) => (id === nb.id ? nb : undefined),
      subject: () => subject,
      sortedSubjects: () => [subject],
      notebooksOf: () => [nb],
    });
  const titled = notebook({ pageTitles: [{ pageId: 'pg2', title: 'Ёлочные интегралы' }] });

  it('search reaches it, ignoring case and accents', () => {
    const found = directory(titled).search('елочные');
    expect(found.map((entry) => entry.target)).toEqual([{ kind: 'page', nb: 'nb1', id: 'pg2' }]);
    expect(found[0]?.name).toBe('Ёлочные интегралы');
    expect(found[0]?.pageNumber).toBe(2);
  });

  it('a page no longer in the notebook is not found', () => {
    const gone = { ...titled, pageIds: ['pg1'] };
    expect(directory(gone).search('елочные')).toEqual([]);
  });

  it('a link to it describes it by its title, and by nothing without one', () => {
    const link: InternalLink = { kind: 'page', nb: 'nb1', id: 'pg2' };
    expect(directory(titled).describe(link)?.name).toBe('Ёлочные интегралы');
    expect(directory(notebook()).describe(link)?.name).toBe('');
  });
});

describe('contents with titles', () => {
  it('lists titled pages above their bookmarks', () => {
    const entries = TableOfContents.entries('nb', [
      { id: 'a', title: 'Lecture', anchors: [anchor({ id: 'one', name: 'Inside' })] },
      { id: 'b', anchors: [] },
    ]);
    expect(entries.map((e) => [e.name, e.page, e.target.kind])).toEqual([
      ['Lecture', 1, 'page'],
      ['Inside', 1, 'anchor'],
    ]);
  });

  it('does not repeat a whole-page bookmark named like the page', () => {
    const entries = TableOfContents.entries('nb', [
      { id: 'a', title: 'Same', anchors: [anchor({ id: 'one', name: 'Same', items: [] })] },
    ]);
    expect(entries.map((e) => e.target.kind)).toEqual(['anchor']);
  });
});

describe('the outline of a PDF', () => {
  it('has titled pages with their bookmarks under them, and other bookmarks on their own', () => {
    const entries = PdfOutline.entries([
      { title: 'Lecture', anchors: [anchor({ name: 'Inside' })] },
      { anchors: [anchor({ name: 'Loose' })] },
      { anchors: [] },
      { title: 'Last', anchors: [] },
    ]);
    expect(entries).toEqual([
      { title: 'Lecture', pageNumber: 1, children: [{ title: 'Inside', pageNumber: 1, children: [] }] },
      { title: 'Loose', pageNumber: 2, children: [] },
      { title: 'Last', pageNumber: 4, children: [] },
    ]);
  });

  it('leaves out a whole-page bookmark that only repeats the title', () => {
    const entries = PdfOutline.entries([{ title: 'Same', anchors: [anchor({ name: 'Same', items: [] })] }]);
    expect(entries[0]?.children).toEqual([]);
  });

  it('writes titles in UTF-16, so any language survives, and nothing can break out of the string', () => {
    expect(PdfOutline.encodedTitle('Aя')).toBe('<FEFF0041044F>');
    expect(PdfOutline.encodedTitle(')>/')).toBe('<FEFF0029003E002F>');
  });
});

describe('recent targets', () => {
  const one: InternalLink = { kind: 'page', nb: 'nb1', id: 'a' };
  const two: InternalLink = { kind: 'anchor', nb: 'nb1', id: 'b' };

  it('can lose one entry', () => {
    expect(LinkRules.withoutRecent([one, two], { ...one })).toEqual([two]);
    expect(LinkRules.withoutRecent([two], one)).toEqual([two]);
  });
});

describe('updating a table of contents', () => {
  const style: ContentsStyle = {
    width: 400,
    pageLabel: (n) => `p. ${n}`,
    measure: (text, look) => text.length * (look?.fs ?? 10),
  };
  const target = (id: string): InternalLink => ({ kind: 'anchor', nb: 'nb', id });
  const entry = (id: string, page = 1) => ({ name: id, page, target: target(id) });
  const styled: TextParagraph[] = [
    {
      align: 'center',
      runs: [{ t: 'a ... p. 1', b: true, i: true, c: '#aa0000', fs: 20, link: target('a') }],
    },
    { runs: [{ t: 'b ... p. 2', c: '#00aa00', link: target('b') }] },
  ];

  it('keeps each line’s look, wherever the line went', () => {
    const paras = TableOfContents.paragraphs([entry('b', 9), entry('a', 8)], style, styled);
    expect(paras[0]?.runs[0]).toMatchObject({ c: '#00aa00', link: target('b') });
    expect(paras[0]?.runs[0]?.t).toMatch(/p\. 9$/);
    expect(paras[0]?.align).toBeUndefined();
    expect(paras[1]?.align).toBe('center');
    expect(paras[1]?.runs[0]).toMatchObject({ b: true, i: true, c: '#aa0000', fs: 20 });
  });

  it('gives a new line the look of the nearest line', () => {
    const paras = TableOfContents.paragraphs([entry('a'), entry('new'), entry('b')], style, styled);
    expect(paras[1]?.align).toBe('center');
    expect(paras[1]?.runs[0]).toMatchObject({ b: true, c: '#aa0000', link: target('new') });
    const first = TableOfContents.paragraphs([entry('new'), entry('b')], style, styled);
    expect(first[0]?.runs[0]?.c).toBe('#00aa00');
  });

  it('with no line left to go by, takes the first one there was', () => {
    const paras = TableOfContents.paragraphs([entry('new')], style, styled);
    expect(paras[0]?.runs[0]).toMatchObject({ b: true, c: '#aa0000', link: target('new') });
  });

  it('fits a line to the width at its own font size', () => {
    const [line] = TableOfContents.paragraphs([entry('a')], style, styled);
    const text = line?.runs[0]?.t ?? '';
    expect(text.length * 20).toBeLessThanOrEqual(400);
    expect(text.length * 20).toBeGreaterThan(360);
  });

  it('never carries an old link or text over', () => {
    const [line] = TableOfContents.paragraphs([entry('new')], style, styled);
    expect(line?.runs).toHaveLength(1);
    expect(line?.runs[0]?.link).toEqual(target('new'));
    expect(line?.runs[0]?.t).toMatch(/^new/);
  });

  it('written the first time has no look of its own', () => {
    const [line] = TableOfContents.paragraphs([entry('a')], style);
    expect(Object.keys(line?.runs[0] ?? {}).sort()).toEqual(['link', 't']);
    expect(Object.keys(line ?? {})).toEqual(['runs']);
  });
});

describe('the colour of a link', () => {
  const link = target();
  function target(): InternalLink {
    return { kind: 'page', nb: 'n', id: 'p' };
  }
  const box = { fs: 14, c: '#111111' };

  it('is always the link colour in ordinary text', () => {
    expect(RichTextLayout.runColor({ c: '#aa0000', link }, box)).not.toBe('#aa0000');
    expect(RichTextLayout.runColor({ c: '#aa0000' }, box)).toBe('#aa0000');
    expect(RichTextLayout.runColor({}, box)).toBe('#111111');
  });

  it('in a table of contents is the one chosen, and the link colour until then', () => {
    const contents = { ...box, toc: true };
    expect(RichTextLayout.runColor({ c: '#aa0000', link }, contents)).toBe('#aa0000');
    expect(RichTextLayout.runColor({ link }, contents)).toBe(RichTextLayout.runColor({ link }, box));
  });
});
