import { describe, expect, it } from 'vitest';
import { CARD_MARGIN } from '../../src/core/constants';
import type { LinkCard, PdfCard } from '../../src/core/types';
import { BackupSize } from '../../src/domain/BackupSize';
import { CardRules } from '../../src/domain/CardRules';
import { ItemTransform } from '../../src/domain/ItemTransform';
import { RichText } from '../../src/domain/RichText';
import { ScratchRegion } from '../../src/domain/ScratchRegion';
import { ScratchTargets, type ScratchPageView } from '../../src/domain/ScratchTargets';
import { PdfAttachments } from '../../src/features/attachments/PdfAttachments';
import { BackupService } from '../../src/storage/BackupService';
import { BlobRepository } from '../../src/storage/BlobRepository';
import { Database } from '../../src/storage/Database';
import { NotebookRepository } from '../../src/storage/NotebookRepository';
import { PageRepository } from '../../src/storage/PageRepository';
import { RecordReader } from '../../src/storage/RecordReader';
import { SubjectRepository } from '../../src/storage/SubjectRepository';
import { backupJson, notebook, page, subject } from './fixtures';

const LINK_CARD: LinkCard = {
  id: 'cardlink',
  kind: 'link',
  x: 10,
  y: 20,
  w: 300,
  h: 68,
  link: { kind: 'url', href: 'https://example.com/a' },
  title: 'Example',
};

const PDF_CARD: PdfCard = {
  id: 'cardpdf',
  kind: 'pdf',
  x: 10,
  y: 100,
  w: 300,
  h: 104,
  blob: 'pdffile',
  thumb: 'pdfthumb',
  name: 'notes.pdf',
  pages: 2,
  bytes: 9,
};

const bytesOf = (text: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(text);

/** A backup whose only page has these extra fields. */
function backupWithPage(fields: Record<string, unknown>): Record<string, unknown> {
  const raw = backupJson();
  const pages = raw.pages as Record<string, unknown>[];
  pages[0] = { ...pages[0], ...fields };
  return raw;
}

describe('attachment cards', () => {
  it('a new card spans the content width and stays on the page', () => {
    const place = CardRules.place('link', 800, 1100, 5000);
    expect(place.w).toBe(800 - CARD_MARGIN * 2);
    expect(place.x).toBe(CARD_MARGIN);
    expect(place.y + place.h).toBeLessThanOrEqual(1100);
    expect(CardRules.clampWidth(1, 800)).toBeGreaterThan(1);
    expect(CardRules.clampWidth(5000, 800)).toBe(800);
  });

  it('names its stored files, and the ⋮ zone is at its right end', () => {
    expect(CardRules.blobIds(PDF_CARD)).toEqual(['pdffile', 'pdfthumb']);
    expect(CardRules.blobIds(LINK_CARD)).toEqual([]);
    expect(CardRules.inMenuZone(LINK_CARD, 309, 30)).toBe(true);
    expect(CardRules.inMenuZone(LINK_CARD, 20, 30)).toBe(false);
  });

  it('a scribble over a card takes nothing, because cards are not among its targets', () => {
    const onPage = page({ strokes: [], texts: [], cards: [LINK_CARD] });
    const region = ScratchRegion.around([0, 0, 1, 900, 0, 1, 900, 900, 1, 0, 900, 1], 2);
    const view = onPage as unknown as ScratchPageView;
    expect(ScratchTargets.isEmpty(ScratchTargets.plan(view, region, 0.1))).toBe(true);
    expect(onPage.cards).toEqual([LINK_CARD]);
  });

  it('moving keeps a card with its items, and a width change leaves its height', () => {
    const items = { strokes: [], texts: [], images: [], cards: [LINK_CARD] };
    const mapping = { ox: 10, oy: 20, k: 2, dx: 5, dy: 7, cardKy: 1 };
    expect(ItemTransform.map(items, mapping).cards[0]).toMatchObject({ x: 15, y: 27, w: 600, h: 68 });
  });
});

describe('links on text', () => {
  const link = { kind: 'url', href: 'https://example.com/' } as const;
  const plain = [{ runs: [{ t: 'one two' }] }];

  it('a range carries a link, can be found from inside, and can be removed', () => {
    const linked = RichText.applyStyle(plain, 0, 3, { link });
    expect(linked[0]?.runs[0]).toMatchObject({ t: 'one', link });
    expect(RichText.linkRangeAt(linked, 1)).toMatchObject({ start: 0, end: 3, link });
    expect(RichText.linkRangeAt(linked, 5)).toBeNull();
    expect(RichText.applyStyle(linked, 0, 3, { link: null })[0]?.runs).toEqual([{ t: 'one two' }]);
  });

  it('a stored link with a dangerous address does not get in', () => {
    const bad = { kind: 'url', href: 'java' + 'script:alert(1)' };
    const text = { id: 't1', x: 0, y: 0, c: '#000000', fs: 16, t: 'x', paras: [{ runs: [{ t: 'x', link: bad }] }] };
    expect(() => BackupService.parse(backupWithPage({ texts: [text] }))).toThrow();
  });
});

describe('attached files', () => {
  const attachments = (blobs: BlobRepository, room: number | null = null) =>
    new PdfAttachments({
      blobs,
      inspect: () => Promise.resolve({ pages: 2, thumb: new Blob(['t'], { type: 'image/jpeg' }) }),
      storage: () => Promise.resolve(room === null ? null : { quota: room, usage: 0 }),
      makeId: () => 'fallback',
    });
  const pdfFile = (text: string) => new Blob([bytesOf('%PDF-1.7 ' + text)]);
  const blobRepo = () => new BlobRepository(Database.inMemory(), new RecordReader(() => undefined));

  it('stores identical files once, and nothing before the card is placed', async () => {
    const blobs = blobRepo();
    const tool = attachments(blobs);
    const a = await tool.prepare(pdfFile('same'), 'a.pdf');
    const b = await tool.prepare(pdfFile('same'), 'b.pdf');
    const other = await tool.prepare(pdfFile('other'), 'c.pdf');
    expect(a.fields.blob).toBe(b.fields.blob);
    expect(a.fields.blob).not.toBe(other.fields.blob);
    expect(await blobs.get(a.fields.blob)).toBeNull();
    await tool.store(a);
    await tool.store(b);
    expect(await blobs.get(a.fields.blob)).not.toBeNull();
    expect(await blobs.all()).toHaveLength(2);
  });

  it('rejects by content and by room, not by what the file calls itself', async () => {
    const blobs = blobRepo();
    const html = new Blob(['<html>'], { type: 'application/pdf' });
    await expect(attachments(blobs).prepare(html, 'x.pdf')).rejects.toMatchObject({ reason: 'wrong-type' });
    await expect(attachments(blobs, 1).prepare(pdfFile('big'), 'x.pdf')).rejects.toMatchObject({
      reason: 'no-space',
    });
  });

  it('a file stays while a page or an undo step uses it, and goes after the last one', async () => {
    const db = Database.inMemory();
    const blobs = new BlobRepository(db, new RecordReader(() => undefined));
    await db.put('blobs', { id: 'pdffile', blob: new Blob(['x']) } as { id: string });
    await db.put('blobs', { id: 'pdfthumb', blob: new Blob(['x']) } as { id: string });
    await db.put('pages', page({ id: 'pa', cards: [PDF_CARD] }));
    await db.put('pages', page({ id: 'pb', cards: [PDF_CARD] }));

    await blobs.sweep(new Set());
    expect(await blobs.get('pdffile')).not.toBeNull();
    await db.delete('pages', 'pa');
    await db.delete('pages', 'pb');
    await blobs.sweep(new Set(['pdffile', 'pdfthumb']));
    expect(await blobs.get('pdffile')).not.toBeNull();
    await blobs.sweep(new Set());
    expect(await blobs.get('pdffile')).toBeNull();
    expect(await blobs.get('pdfthumb')).toBeNull();
  });
});

describe('backups with attachments', () => {
  const service = () => {
    const db = Database.inMemory();
    const reader = new RecordReader(() => undefined);
    const repos = {
      subjects: new SubjectRepository(db, reader),
      notebooks: new NotebookRepository(db, reader),
      pages: new PageRepository(db, reader),
      blobs: new BlobRepository(db, reader),
    };
    return { repos, backup: new BackupService(db, repos, () => Promise.resolve(null)) };
  };
  const withBlob = (type: string, text: string) =>
    backupJson({ blobs: [{ id: 'pdffile', type, data: btoa(text) }] });

  it('a PDF card and its file come back as they were', async () => {
    const { repos, backup } = service();
    const cards = [{ ...PDF_CARD, thumb: null }, LINK_CARD];
    await repos.subjects.save(subject());
    await repos.notebooks.save(notebook());
    await repos.pages.save(page({ cards }));
    await repos.blobs.save('pdffile', new Blob([bytesOf('%PDF-1.7 hello')], { type: 'application/pdf' }));

    const doc = BackupService.parse(JSON.parse(await (await backup.createBackup()).text()));
    const fresh = service();
    await fresh.backup.restore(doc);
    expect((await fresh.repos.pages.all())[0]?.cards).toEqual(cards);
    const file = await fresh.repos.blobs.get('pdffile');
    expect(file && (await file.text())).toBe('%PDF-1.7 hello');
  });

  it('estimates the size of what it would write', async () => {
    const { repos, backup } = service();
    await repos.blobs.save('big', new Blob([new Uint8Array(300_000)], { type: 'image/png' }));
    expect(await backup.estimateBytes()).toBeGreaterThan(400_000);
    expect(BackupSize.overLimit(301 * 1024 * 1024)).toBe(true);
  });

  it('an old backup without cards still loads', () => {
    expect(BackupService.parse(backupJson()).pages[0]?.cards).toEqual([]);
  });

  it('refuses a PDF that is not one, and a card with a dangerous address', () => {
    expect(BackupService.parse(withBlob('application/pdf', '%PDF-1.7 x')).blobs).toHaveLength(1);
    expect(() => BackupService.parse(withBlob('application/pdf', '<script>'))).toThrow();
    expect(() => BackupService.parse(withBlob('text/html', 'x'))).toThrow();
    const card = { ...LINK_CARD, link: { kind: 'url', href: 'file:///etc/passwd' } };
    expect(() => BackupService.parse(backupWithPage({ cards: [card] }))).toThrow();
  });
});
