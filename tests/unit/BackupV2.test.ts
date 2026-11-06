import { unzipSync, zipSync } from 'fflate';
import { describe, expect, it, vi } from 'vitest';
import type { Page } from '../../src/core/types';
import { sha256Hex } from '../../src/core/utils/files';
import { Sha256 } from '../../src/core/utils/Sha256';
import { BackupSize } from '../../src/domain/BackupSize';
import { StorageBreakdown } from '../../src/domain/StorageBreakdown';
import { STROKE_COORD_SCALE, StrokeCodec } from '../../src/domain/StrokeCodec';
import { BackupService } from '../../src/storage/BackupService';
import { ZipReader } from '../../src/storage/backup/ZipReader';
import {
  EMPTY_DATA,
  encode,
  fakeJpeg,
  forgeBackup,
  handwrittenPage,
  legacyBackup,
  randomFrom,
  sha256,
  shelf,
} from './backupHelpers';
import { notebook, page, subject } from './fixtures';

const JPEG = fakeJpeg(600, randomFrom(1));
const JPEG_NAME = `${sha256(JPEG)}.jpg`;

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** Rejected, for this reason, and (when `because` is given) because of the very check meant. */
async function expectRejected(file: Blob, reason: string, because?: RegExp): Promise<void> {
  const error: unknown = await shelf()
    .service.readFile(file)
    .then(
      () => null,
      (e: unknown) => e,
    );
  expect(error).toMatchObject({ name: 'BackupError', reason });
  if (because) expect(String((error as Error).cause)).toMatch(because);
}

/** A shelf holding a subject, a notebook and a page with a photo. */
async function filled() {
  const target = shelf();
  await target.repos.subjects.save(subject());
  await target.repos.notebooks.save(notebook());
  await target.repos.pages.save(page({ images: [{ id: 'im1', x: 1, y: 2, w: 30, h: 40, blob: 'photo' }] }));
  await target.repos.blobs.save('photo', new Blob([JPEG], { type: 'image/jpeg' }));
  return target;
}

async function bytesOf(blob: Blob | null): Promise<Uint8Array> {
  return new Uint8Array((await blob?.arrayBuffer()) ?? new ArrayBuffer(0));
}

describe('SHA-256 in pieces', () => {
  it('matches the published test vectors', () => {
    expect(new Sha256().update(encode('')).hex()).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(new Sha256().update(encode('abc')).hex()).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it("gives the browser's digest, however the bytes are cut", async () => {
    const bytes = fakeJpeg(10_000, randomFrom(5));
    const expected = await sha256Hex(bytes);
    for (const step of [1, 7, 63, 64, 65, 1000]) {
      const hash = new Sha256();
      for (let at = 0; at < bytes.length; at += step) hash.update(bytes.subarray(at, at + step));
      expect(hash.hex()).toBe(expected);
    }
  });
});

describe('compact strokes', () => {
  it('moves no point further than half a step, and never adds up an error', () => {
    const p = handwrittenPage(randomFrom(2), 'pg1', 'nb1', 20).strokes.flatMap((s) => [...s.p]);
    const back = StrokeCodec.decode(StrokeCodec.encode(p)) as number[];
    expect(back).toHaveLength(p.length);
    p.forEach((value, i) => {
      const limit = i % 3 === 2 ? 0.005 : 0.5 / STROKE_COORD_SCALE;
      expect(Math.abs((back[i] as number) - value)).toBeLessThanOrEqual(limit + 1e-5);
    });
  });

  it('reads a coordinate to within 0.16 of a device pixel at the highest zoom on a 2× screen', () => {
    expect((0.5 / STROKE_COORD_SCALE) * 8 * 2).toBeLessThanOrEqual(0.16);
  });

  it('rejects anything but a whole number of points in whole numbers', () => {
    expect(StrokeCodec.decode([1, 2])).toBeNull();
    expect(StrokeCodec.decode([1, 2, 0.5])).toBeNull();
    expect(StrokeCodec.decode([1, 2, '3'])).toBeNull();
    expect(StrokeCodec.decode([1, 2, Number.MAX_VALUE])).toBeNull();
  });
});

describe('writing a ZIP backup', () => {
  it('has the agreed entries, raw files and a manifest with sizes and hashes', async () => {
    const { service } = await filled();
    const { file, skipped } = await service.createBackup();
    expect(skipped).toBe(0);
    expect(file.type).toBe('application/zip');
    const unzipped = unzipSync(new Uint8Array(await file.arrayBuffer()));
    expect(Object.keys(unzipped).sort()).toEqual(['data.json', `files/${JPEG_NAME}`, 'manifest.json']);
    expect(unzipped[`files/${JPEG_NAME}`]).toEqual(JPEG);
    const manifest = JSON.parse(new TextDecoder().decode(unzipped['manifest.json']));
    expect(manifest).toMatchObject({
      app: 'krispekt',
      format: 2,
      counts: { subjects: 1, notebooks: 1, pages: 1, files: 1, trash: 0 },
    });
    expect(Date.parse(manifest.createdAt)).not.toBeNaN();
    expect(manifest.entries).toContainEqual({ name: `files/${JPEG_NAME}`, size: 600, sha256: sha256(JPEG) });
    const data = unzipped['data.json'] as Uint8Array;
    expect(manifest.entries).toContainEqual({ name: 'data.json', size: data.length, sha256: sha256(data) });
  });

  it('writes data.json as valid JSON, one page per line, with compact strokes', async () => {
    const { repos, service } = await filled();
    await repos.pages.save(page({ id: 'pg2' }));
    const { file } = await service.createBackup();
    const text = new TextDecoder().decode(
      unzipSync(new Uint8Array(await file.arrayBuffer()))['data.json'] as Uint8Array,
    );
    expect(text.split('\n')).toHaveLength(4);
    const data = JSON.parse(text);
    expect(data.pages).toHaveLength(2);
    expect(data.pages[0].strokes[0].p).toBeUndefined();
    expect(data.pages[0].strokes[0].d).toEqual(StrokeCodec.encode([10.123, 20.456, 0.5, 30, 40, 0.6]));
    expect(data.blobs).toEqual([{ id: 'photo', file: JPEG_NAME }]);
  });

  it('stores identical files once, and each id gets it back', async () => {
    const { repos, service } = await filled();
    await repos.blobs.save('copy', new Blob([JPEG], { type: 'image/jpeg' }));
    const { file } = await service.createBackup();
    const entries = (await ZipReader.open(file)).entries.map((entry) => entry.name);
    expect(entries.filter((name) => name.startsWith('files/'))).toHaveLength(1);

    const fresh = shelf();
    await fresh.service.restore(await fresh.service.readFile(file));
    expect(await bytesOf(await fresh.repos.blobs.get('copy'))).toEqual(JPEG);
    expect(await bytesOf(await fresh.repos.blobs.get('photo'))).toEqual(JPEG);
  });

  it('stores images as they are, and packs a PDF only when that helps', async () => {
    const { repos, service } = shelf();
    const wordy = encode('%PDF-1.3\n' + 'stream of plain text '.repeat(5000));
    const dense = new Uint8Array(fakeJpeg(50_000, randomFrom(3)));
    dense.set(encode('%PDF-1.7'));
    await repos.blobs.save('wordy', new Blob([wordy], { type: 'application/pdf' }));
    await repos.blobs.save('dense', new Blob([dense], { type: 'application/pdf' }));
    await repos.blobs.save('photo', new Blob([JPEG], { type: 'image/jpeg' }));
    const { entries } = await ZipReader.open((await service.createBackup()).file);
    const method = (bytes: Uint8Array): number | undefined =>
      entries.find((entry) => entry.name.includes(sha256(bytes)))?.method;
    expect(method(wordy)).toBe(8);
    expect(method(dense)).toBe(0);
    expect(method(JPEG)).toBe(0);
  });

  it('names a file by what it really is, and says what it had to leave out', async () => {
    const { repos, service } = shelf();
    await repos.blobs.save('mislabelled', new Blob([JPEG], { type: 'image/png' }));
    await repos.blobs.save('garbage', new Blob(['nothing recognisable'], { type: 'image/jpeg' }));
    const { file, skipped } = await service.createBackup();
    expect(skipped).toBe(1);
    expect(
      Object.keys(unzipSync(new Uint8Array(await file.arrayBuffer()))).filter((n) => n.startsWith('files/')),
    ).toEqual([`files/${JPEG_NAME}`]);
    const fresh = shelf();
    await fresh.service.restore(await fresh.service.readFile(file));
    expect((await fresh.repos.blobs.get('mislabelled'))?.type).toBe('image/jpeg');
  });

  it('converts a file of a type it may not hold', async () => {
    const { db, repos } = shelf();
    await repos.blobs.save('gif', new Blob(['GIF89a'], { type: 'image/gif' }));
    const service = new BackupService(db, repos, () =>
      Promise.resolve(new Blob([JPEG], { type: 'image/jpeg' })),
    );
    const { file, skipped } = await service.createBackup();
    expect(skipped).toBe(0);
    expect(Object.keys(unzipSync(new Uint8Array(await file.arrayBuffer())))).toContain(`files/${JPEG_NAME}`);
  });

  it('reports progress up to the end', async () => {
    const { service } = await filled();
    const seen: number[] = [];
    await service.createBackup((done) => seen.push(done));
    expect(seen.at(-1)).toBe(1);
    expect([...seen].sort((a, b) => a - b)).toEqual(seen);
  });
});

describe('restoring a ZIP backup', () => {
  it('brings everything back: strokes, text, anchors, links, trash and files', async () => {
    const source = await filled();
    const link = { kind: 'anchor', nb: 'nb1', id: 'an1' } as const;
    const full = page({
      id: 'pg1',
      texts: [
        {
          id: 'tx1',
          x: 75,
          y: 58,
          w: 600,
          t: 'y = x²',
          fs: 20,
          c: '#1E40AF',
          paras: [{ runs: [{ t: 'y = x²', link, b: true }] }],
        },
      ],
      images: [{ id: 'im1', x: 1, y: 2, w: 30, h: 40, blob: 'photo' }],
      anchors: [{ id: 'an1', name: 'Тема', items: ['tx1'], rect: { x: 1, y: 2, w: 3, h: 4 } }],
      inkLinks: [{ id: 'il1', items: ['st1'], rect: { x: 1, y: 2, w: 3, h: 4 }, link }],
    });
    await source.repos.pages.save(full);
    await source.repos.subjects.save(subject({ id: 'gone', deletedAt: 1700000000500 }));
    await source.repos.notebooks.save(
      notebook({ id: 'nbgone', subjectId: 'gone', deletedAt: 1700000000500, deletedWithSubject: true }),
    );

    const target = shelf();
    const backup = await target.service.readFile((await source.service.createBackup()).file);
    await target.service.restore(backup);

    expect(await target.repos.subjects.all()).toEqual(await source.repos.subjects.all());
    const notebooks = await target.repos.notebooks.all();
    expect(notebooks.find((n) => n.id === 'nbgone')).toMatchObject({
      deletedAt: 1700000000500,
      deletedWithSubject: true,
    });
    const [restored] = await target.repos.pages.all();
    const { strokes, ...rest } = restored as Page;
    const { strokes: _ink, ...expected } = full;
    expect(rest).toEqual({ ...expected, updatedAt: rest.updatedAt });
    expect(strokes[0]?.p).toBeInstanceOf(Float32Array);
    expect(strokes[0]?.p[0]).toBeCloseTo(10.12, 1);
    expect(strokes[0]?.p[2]).toBeCloseTo(0.5, 4);
    expect(notebooks.find((n) => n.id === 'nb1')?.marks).toEqual([
      { id: 'an1', pageId: 'pg1', name: 'Тема' },
    ]);
    expect(await bytesOf(await target.repos.blobs.get('photo'))).toEqual(JPEG);
  });

  it('merges as before: what the backup has replaces, the rest stays', async () => {
    const source = await filled();
    const file = (await source.service.createBackup()).file;
    const target = shelf();
    await target.repos.subjects.save(subject({ name: 'Старое имя' }), subject({ id: 'mine', name: 'Моё' }));
    await target.service.restore(await target.service.readFile(file));
    const names = (await target.repos.subjects.all()).map((s) => s.name).sort();
    expect(names).toEqual(['Математика', 'Моё']);
  });

  it('tells the file by its first bytes, not its name', async () => {
    const { file } = await (await filled()).service.createBackup();
    const misnamed = new File([file], 'backup.json', { type: 'application/json' });
    expect(await shelf().service.readFile(misnamed)).toMatchObject({ kind: 'zip' });
    const json = new File([await legacyBackup((await filled()).repos)], 'copy.zip', {
      type: 'application/zip',
    });
    expect(await shelf().service.readFile(json)).toMatchObject({ blobs: [{ id: 'photo' }] });
  });

  it('accepts old JSON backups of both app names and restores them', async () => {
    for (const app of ['krispekt', 'konspektnik']) {
      const source = await filled();
      const raw = JSON.parse(await legacyBackup(source.repos));
      const target = shelf();
      await target.service.restore(
        await target.service.readFile(new Blob([JSON.stringify({ ...raw, app })])),
      );
      expect((await target.repos.notebooks.all())[0]?.id).toBe('nb1');
      expect(await bytesOf(await target.repos.blobs.get('photo'))).toEqual(JPEG);
    }
  });

  it('never overwrites a different file with the same id', async () => {
    const source = await filled();
    const target = shelf({ makeId: () => 'renamed' });
    const mine = new Blob([fakeJpeg(700, randomFrom(9))], { type: 'image/jpeg' });
    await target.repos.blobs.save('photo', mine);
    await target.repos.pages.save(
      page({ id: 'other', images: [{ id: 'im9', x: 0, y: 0, w: 1, h: 1, blob: 'photo' }] }),
    );
    await target.service.restore(await target.service.readFile((await source.service.createBackup()).file));
    expect((await target.repos.blobs.get('photo'))?.size).toBe(700);
    expect(await bytesOf(await target.repos.blobs.get('renamed'))).toEqual(JPEG);
    const pages = await target.repos.pages.all();
    expect(pages.find((p) => p.id === 'pg1')?.images[0]?.blob).toBe('renamed');
    expect(pages.find((p) => p.id === 'other')?.images[0]?.blob).toBe('photo');
  });

  it('does not store a file again when the same one is already there', async () => {
    const source = await filled();
    const file = (await source.service.createBackup()).file;
    const save = vi.spyOn(source.repos.blobs, 'save');
    await source.service.restore(await source.service.readFile(file));
    expect(save).not.toHaveBeenCalled();
  });
});

describe('a backup that was damaged or forged', () => {
  const zip = (entries: Record<string, Uint8Array>): Blob =>
    new Blob([zipSync(entries) as Uint8Array<ArrayBuffer>]);

  it('accepts the forged file when nothing is wrong with it, so the tests below mean something', async () => {
    expect(await shelf().service.readFile(forgeBackup())).toMatchObject({ kind: 'zip', pages: [] });
  });

  it.each([
    ['path traversal', '../evil.json'],
    ['a deeper path traversal', 'files/../../evil.jpg'],
    ['an absolute path', '/etc/passwd'],
    ['a Windows path', 'files\\evil.jpg'],
    ['an unknown entry', 'readme.txt'],
    ['a file with a bad hash name', 'files/abc.jpg'],
    ['a file with an unknown extension', `files/${'a'.repeat(64)}.exe`],
    ['a directory', 'files/'],
  ])('rejects %s', async (_case, name) => {
    await expectRejected(forgeBackup({ extra: { [name]: encode('x') } }), 'damaged', /unknown entry/);
  });

  it('rejects two entries with one name', async () => {
    // A ZIP writer refuses two entries with one name, so one is renamed to it afterwards.
    const twin = new Uint8Array(await forgeBackup({ extra: { 'data.jso_': encode('x') } }).arrayBuffer());
    let renamed = 0;
    for (let at = 0; at + 9 <= twin.length; at++) {
      if (String.fromCharCode(...twin.subarray(at, at + 9)) === 'data.jso_') {
        twin[at + 8] = 'n'.charCodeAt(0);
        renamed++;
      }
    }
    expect(renamed).toBe(2);
    await expectRejected(new Blob([twin]), 'damaged', /duplicate entry/);
  });

  it('rejects a backup without a manifest or without data', async () => {
    await expectRejected(zip({ 'data.json': encode(EMPTY_DATA) }), 'invalid');
    const noData = forgeBackup({
      manifest: () => ({ app: 'krispekt', format: 2, createdAt: 'x', entries: [] }),
    });
    await expectRejected(new Blob([noData]), 'damaged');
  });

  it('rejects another app, and tells a later format apart', async () => {
    await expectRejected(
      forgeBackup({ manifest: (entries) => ({ app: 'other', format: 2, createdAt: 'x', entries }) }),
      'invalid',
    );
    await expectRejected(
      forgeBackup({ manifest: (entries) => ({ app: 'krispekt', format: 1, createdAt: 'x', entries }) }),
      'invalid',
    );
    await expectRejected(
      forgeBackup({ manifest: (entries) => ({ app: 'krispekt', format: 3, createdAt: 'x', entries }) }),
      'newer',
    );
  });

  it('rejects data that differs from its hash', async () => {
    const forged = forgeBackup({
      manifest: (entries) => ({
        app: 'krispekt',
        format: 2,
        createdAt: 'x',
        entries: entries.map((entry) => ({ ...entry, sha256: 'b'.repeat(64) })),
      }),
    });
    await expectRejected(forged, 'damaged');
  });

  it('rejects an entry missing from the manifest, or one the manifest invents', async () => {
    const path = `files/${JPEG_NAME}`;
    await expectRejected(forgeBackup({ extra: { [path]: JPEG } }), 'damaged');
    const invented = forgeBackup({
      manifest: (entries) => ({
        app: 'krispekt',
        format: 2,
        createdAt: 'x',
        entries: [...entries, { name: path, size: 1, sha256: sha256(JPEG) }],
      }),
    });
    await expectRejected(invented, 'damaged');
  });

  it('rejects data of the wrong shape, as any backup', async () => {
    const data = (head: string, lines: string[] = []): Blob =>
      forgeBackup({ data: [head, ...lines, ']}'].join('\n') });
    const head = '{"subjects":[],"notebooks":[],"blobs":[],"pages":[';
    await expectRejected(data('{"pages":['), 'invalid');
    await expectRejected(data(head, ['{"id":"pg1"}']), 'invalid');
    await expectRejected(data('not json,"pages":['), 'invalid');
    const line = JSON.stringify({
      ...page(),
      strokes: [{ id: 'st1', k: 'pen', c: '#000000', s: 2, d: [1e12, 0, 0] }],
    });
    await expectRejected(data(head, [line]), 'invalid');
  });

  it('rejects data laid out in any other way', async () => {
    const good = JSON.stringify({ ...page(), strokes: [] });
    const head = '{"subjects":[],"notebooks":[],"blobs":[],"pages":[';
    const layouts = [
      `${head}\n${good},\n${good}\n`, // cut off before the end
      `${head}\n${good},\n]}`, // a comma with nothing after it
      `${head}\n${good}\n${{ ...JSON.parse(good) }}\n]}`, // no comma
      `${head}\n${good},\n${good}\n]}\nmore`, // something after the end
    ];
    for (const data of layouts) {
      await expect(shelf().service.readFile(forgeBackup({ data }))).rejects.toMatchObject({
        name: 'BackupError',
      });
    }
    await expectRejected(
      forgeBackup({ data: `${head}\n${good},\n${good}\n]}` }),
      'invalid', // two pages with one id
    );
  });

  it('rejects a table that promises a file the archive lacks, or leaves one unused', async () => {
    const row = `{"id":"bl1","file":"${JPEG_NAME}"}`;
    const data = `{"subjects":[],"notebooks":[],"blobs":[${row}],"pages":[\n]}`;
    await expectRejected(forgeBackup({ data }), 'damaged');
    await expectRejected(forgeBackup({ files: { [`files/${JPEG_NAME}`]: JPEG } }), 'damaged');
  });

  /** Changes a number in the directory record of the entry whose name starts so, in a forged backup. */
  async function patched(
    change: (data: DataView, at: number) => void,
    forged: Blob = forgeBackup(),
    prefix = 'data',
  ): Promise<Blob> {
    const bytes = new Uint8Array(await forged.arrayBuffer());
    const data = view(bytes);
    let at = data.getUint32(bytes.length - 22 + 16, true);
    while (
      !new TextDecoder()
        .decode(bytes.subarray(at + 46, at + 46 + data.getUint16(at + 28, true)))
        .startsWith(prefix)
    ) {
      at +=
        46 + data.getUint16(at + 28, true) + data.getUint16(at + 30, true) + data.getUint16(at + 32, true);
    }
    change(data, at);
    return new Blob([bytes]);
  }

  it('stops an entry that unpacks to more than it declares (a zip bomb lying about its size)', async () => {
    const blob = await patched((data, at) => data.setUint32(at + 24, 3, true));
    await expectRejected(blob, 'damaged', /entries differ|longer than declared/);
  });

  it('stops an entry that unpacks to less than it declares', async () => {
    const blob = await patched((data, at) =>
      data.setUint32(at + 24, data.getUint32(at + 24, true) + 5, true),
    );
    await expectRejected(blob, 'damaged');
  });

  it('refuses a compression ratio beyond the limit before unpacking anything', async () => {
    const blob = await patched((data, at) => data.setUint32(at + 24, 3_000_000_000, true));
    await expectRejected(blob, 'damaged', /ratio/);
    const huge = new Uint8Array(40 * 1024 * 1024);
    const real = forgeBackup({ data: EMPTY_DATA, extra: { [`files/${'c'.repeat(64)}.pdf`]: huge } });
    await expectRejected(real, 'damaged', /ratio/);
  });

  it('refuses entries over the size limit before unpacking anything', async () => {
    const read = vi.spyOn(ZipReader.prototype, 'read');
    // Over the limit for one file, yet with a believable ratio: 1 MB that says it unpacks to 300 MB.
    const name = `files/${'c'.repeat(64)}.pdf`;
    const forged = forgeBackup({ extra: { [name]: [new Uint8Array(1024 * 1024), { level: 0 }] } });
    const blob = await patched(
      (data, at) => {
        data.setUint16(at + 10, 8, true);
        data.setUint32(at + 24, 300 * 1024 * 1024, true);
      },
      forged,
      'files/',
    );
    await expectRejected(blob, 'damaged', /too large/);
    expect(read).not.toHaveBeenCalled();
    read.mockRestore();
  });

  it('refuses entries that overlap, an encrypted entry, or an unknown method', async () => {
    await expectRejected(await patched((data, at) => data.setUint32(at + 42, 0, true)), 'damaged', /overlap/);
    await expectRejected(
      await patched((data, at) => data.setUint16(at + 8, 1, true)),
      'damaged',
      /encrypted/,
    );
    await expectRejected(
      await patched((data, at) => data.setUint16(at + 10, 12, true)),
      'damaged',
      /unknown compression/,
    );
  });

  it('refuses more entries than the limit, and archives cut short', async () => {
    const bytes = new Uint8Array(await forgeBackup().arrayBuffer());
    const many = bytes.slice();
    view(many).setUint16(many.length - 22 + 8, 65_000, true);
    view(many).setUint16(many.length - 22 + 10, 65_000, true);
    await expectRejected(new Blob([many]), 'damaged', /too many entries/);
    await expectRejected(new Blob([bytes.subarray(0, bytes.length - 30)]), 'damaged');
    await expectRejected(new Blob([bytes.subarray(0, 40)]), 'damaged');
  });

  it('rejects compressed data that is corrupt', async () => {
    const bytes = new Uint8Array(await forgeBackup({ data: EMPTY_DATA.repeat(1) }).arrayBuffer());
    const reader = await ZipReader.open(new Blob([bytes]));
    const entry = reader.entries.find((e) => e.name === 'data.json');
    if (!entry) throw new Error('no entry');
    bytes.fill(
      0xff,
      entry.headerOffset + 30 + entry.name.length,
      entry.headerOffset + 30 + entry.name.length + entry.compressedSize,
    );
    await expectRejected(new Blob([bytes]), 'damaged');
  });
});

describe('a restore that fails leaves everything as it was', () => {
  /** A backup with a good file and a second file whose content does not match its name. */
  async function brokenLastFile(signature: Uint8Array): Promise<Blob> {
    const good = page({ images: [{ id: 'im1', x: 0, y: 0, w: 1, h: 1, blob: 'first' }] });
    const line = JSON.stringify({
      ...good,
      strokes: [{ id: 'st1', k: 'pen', c: '#000000', s: 2, d: StrokeCodec.encode([1, 2, 0.5]) }],
    });
    const other = fakeJpeg(300, randomFrom(4));
    const otherName = `${sha256(signature)}.jpg`;
    const head = JSON.stringify({
      subjects: [subject({ name: 'Из копии' })],
      notebooks: [notebook({ title: 'Из копии' })],
      blobs: [
        { id: 'first', file: `${sha256(other)}.jpg` },
        { id: 'second', file: otherName },
      ],
    });
    const data = `${head.slice(0, -1)},"pages":[\n${line}\n]}`;
    return forgeBackup({
      data,
      files: { [`files/${sha256(other)}.jpg`]: other, [`files/${otherName}`]: signature },
    });
  }

  async function shelfBefore() {
    const target = await filled();
    return {
      target,
      subjects: await target.repos.subjects.all(),
      notebooks: await target.repos.notebooks.all(),
      pages: await target.repos.pages.all(),
      blobs: (await target.repos.blobs.all()).map((b) => b.id),
    };
  }

  async function expectUntouched(before: Awaited<ReturnType<typeof shelfBefore>>): Promise<void> {
    const { repos } = before.target;
    expect(await repos.subjects.all()).toEqual(before.subjects);
    expect(await repos.notebooks.all()).toEqual(before.notebooks);
    expect(await repos.pages.all()).toEqual(before.pages);
    expect((await repos.blobs.all()).map((b) => b.id)).toEqual(before.blobs);
  }

  it('on a file with a bad signature', async () => {
    const before = await shelfBefore();
    const file = await brokenLastFile(encode('this is not an image'));
    const backup = await before.target.service.readFile(file);
    await expect(before.target.service.restore(backup)).rejects.toMatchObject({ reason: 'damaged' });
    await expectUntouched(before);
  });

  it('on a file whose content was changed after hashing', async () => {
    const before = await shelfBefore();
    const signed = new Uint8Array(await (await brokenLastFile(fakeJpeg(800, randomFrom(6)))).arrayBuffer());
    // Flip a byte inside the stored data of the larger file.
    const reader = await ZipReader.open(new Blob([signed]));
    const entry = reader.entries.find((e) => e.size === 800);
    if (!entry) throw new Error('no entry');
    const at = entry.headerOffset + 30 + entry.name.length + 400;
    signed[at] = (signed[at] ?? 0) ^ 0xff;
    // zipSync deflates by default, so a flipped byte may also fail as corrupt data: damaged either way.
    let error: unknown;
    try {
      await before.target.service.restore(await before.target.service.readFile(new Blob([signed])));
    } catch (e) {
      error = e;
    }
    expect(error).toMatchObject({ reason: 'damaged' });
    await expectUntouched(before);
  });

  it('when the final write fails, and what was stored ahead of it goes away', async () => {
    const before = await shelfBefore();
    const source = await filled();
    await source.repos.blobs.save('extra', new Blob([fakeJpeg(100, randomFrom(8))], { type: 'image/jpeg' }));
    const backup = await before.target.service.readFile((await source.service.createBackup()).file);
    const write = vi
      .spyOn(before.target.db, 'writeAcross')
      .mockRejectedValueOnce(new DOMException('full', 'QuotaExceededError'));
    await expect(before.target.service.restore(backup)).rejects.toMatchObject({ reason: 'no-space' });
    write.mockRestore();
    await expectUntouched(before);
  });

  it('asks for a cleanup first, so a restore killed half way leaves no orphans for long', async () => {
    const source = await filled();
    const onFilesWritten = vi.fn();
    const target = shelf({ onFilesWritten });
    const save = vi.spyOn(target.repos.blobs, 'save');
    const backup = await target.service.readFile((await source.service.createBackup()).file);
    await target.service.restore(backup);
    expect(onFilesWritten.mock.invocationCallOrder[0]).toBeLessThan(
      save.mock.invocationCallOrder[0] as number,
    );
  });
});

describe('what a backup is made of', () => {
  it('counts each kind of content, the base64 overhead included', async () => {
    const report = StorageBreakdown.measure({
      subjects: [subject()],
      notebooks: [notebook()],
      pages: [
        page({
          bgBlob: 'bg',
          images: [{ id: 'im1', x: 0, y: 0, w: 1, h: 1, blob: 'photo' }],
          cards: [
            {
              id: 'cd1',
              kind: 'pdf',
              x: 0,
              y: 0,
              w: 1,
              h: 1,
              blob: 'doc',
              thumb: 'th',
              name: 'lecture.pdf',
              pages: 3,
              bytes: 3000,
            },
          ],
          anchors: [{ id: 'a1', name: 'Тема', items: [], rect: { x: 0, y: 0, w: 0, h: 0 } }],
        }),
      ],
      blobs: [
        { id: 'photo', size: 1000, type: 'image/jpeg' },
        { id: 'bg', size: 2000, type: 'image/jpeg' },
        { id: 'doc', size: 3000, type: 'application/pdf' },
        { id: 'th', size: 100, type: 'image/jpeg' },
        { id: 'lost', size: 77, type: 'image/jpeg' },
      ],
    });
    expect(report.overall.photos).toBe(1000);
    expect(report.overall.pdfs).toBe(5100);
    expect(report.overall.handwriting).toBeGreaterThan(0);
    expect(report.overall.text).toBeGreaterThan(0);
    expect(report.unused).toBe(77);
    expect(report.jsonBackup).toMatchObject({ photos: 1000, pdfFiles: 3100, pdfPages: 2000 });
    expect(report.jsonBackup.links).toBeGreaterThan(0);
    expect(report.jsonBackup.base64).toBeCloseTo(6100 / 3, 3);
    expect(report.largest.map((f) => [f.kind, f.name, f.bytes])).toEqual([
      ['pdf', 'lecture.pdf', 3000],
      ['pdfPage', '', 2000],
      ['photo', '', 1000],
      ['pdf', '', 100],
    ]);
    expect(report.photoSavings).toBe(300);
  });

  it('counts a shared file once, for the shelf rather than the Trash', () => {
    const shared = { id: 'photo', size: 1000, type: 'image/webp' };
    const image = { id: 'im', x: 0, y: 0, w: 1, h: 1, blob: 'photo' };
    const report = StorageBreakdown.measure({
      subjects: [subject()],
      notebooks: [notebook({ id: 'old', deletedAt: 5 }), notebook({ id: 'live' })],
      pages: [
        page({ id: 'a', nbId: 'old', images: [image], strokes: [], texts: [] }),
        page({ id: 'b', nbId: 'live', images: [image], strokes: [], texts: [] }),
      ],
      blobs: [shared],
    });
    const row = report.subjects[0]?.notebooks[0];
    expect(row?.notebook.id).toBe('live');
    expect(row?.photos).toBe(1000);
    expect(report.overall.photos).toBe(1000);
    expect(report.trash).toBeLessThan(1000);
    expect(report.photoSavings).toBe(0);
  });

  it('on a realistic week of notes: the real figures, old format against new', async () => {
    const random = randomFrom(2026);
    const { repos, service } = shelf();
    await repos.subjects.save(subject());
    const pages = Array.from({ length: 80 }, (_, i) => handwrittenPage(random, `pg${i}`, 'nb1', 260));
    const photos = Array.from({ length: 8 }, () => fakeJpeg(600_000, random));
    const backgrounds = Array.from({ length: 12 }, () => fakeJpeg(250_000, random));
    const pdf = encode('%PDF-1.3\n' + 'stream text of a lecture handout '.repeat(30_000));
    for (const [i, bytes] of photos.entries()) {
      await repos.blobs.save(`photo${i}`, new Blob([bytes], { type: 'image/jpeg' }));
      pages[i]?.images.push({ id: `im${i}`, x: 0, y: 0, w: 9, h: 9, blob: `photo${i}` });
    }
    for (const [i, bytes] of backgrounds.entries()) {
      await repos.blobs.save(`bg${i}`, new Blob([bytes], { type: 'image/jpeg' }));
      const owner = pages[20 + i];
      if (owner) owner.bgBlob = `bg${i}`;
    }
    await repos.blobs.save('doc', new Blob([pdf], { type: 'application/pdf' }));
    pages[50]?.cards.push({
      id: 'cd1',
      kind: 'pdf',
      x: 0,
      y: 0,
      w: 9,
      h: 9,
      blob: 'doc',
      thumb: null,
      name: 'handout.pdf',
      pages: 12,
      bytes: pdf.length,
    });
    await repos.notebooks.save(notebook({ pageIds: pages.map((p) => p.id) }));
    await repos.pages.save(...pages);

    const stored = await repos.blobs.all();
    const report = StorageBreakdown.measure({
      subjects: [subject()],
      notebooks: await repos.notebooks.all(),
      pages,
      blobs: stored.map(({ id, blob }) => ({ id, size: blob.size, type: blob.type })),
    });
    const legacy = new Blob([await legacyBackup(repos)]).size;
    const { file } = await service.createBackup();
    const estimate = await service.estimateBytes();
    const packed = (await ZipReader.open(file)).entries.find((entry) => entry.name === 'data.json');
    const mb = (n: number): string => (n / 1048576).toFixed(2) + ' MB';
    const parts = report.jsonBackup;

    console.log(
      `[size] old JSON ${mb(legacy)}: strokes ${mb(parts.strokes)}, text ${mb(parts.text)}, ` +
        `links ${mb(parts.links)}, photos ${mb(parts.photos)}, PDF files ${mb(parts.pdfFiles)}, ` +
        `PDF pages ${mb(parts.pdfPages)}, base64 overhead ${mb(parts.base64)}. ` +
        `New ZIP ${mb(file.size)} (data.json ${mb(packed?.compressedSize ?? 0)}), estimate ${mb(estimate)}.`,
    );
    // The estimate of the old format is close to what the old format really took.
    expect(Math.abs(parts.total - legacy) / legacy).toBeLessThan(0.1);
    expect(file.size).toBeLessThan(legacy * 0.55);
    // The shelf shows this figure next to the backup settings.
    expect(Math.abs(estimate - file.size) / file.size).toBeLessThan(0.2);
    expect(BackupSize.overLimit(file.size)).toBe(false);

    const restored = shelf();
    await restored.service.restore(await restored.service.readFile(file));
    const back = (await restored.repos.pages.all()).find((p) => p.id === 'pg7');
    const before = pages[7];
    expect(back?.strokes.length).toBe(before?.strokes.length);
    expect(back?.strokes[0]?.p.length).toBe(before?.strokes[0]?.p.length);
  }, 120_000);
});
