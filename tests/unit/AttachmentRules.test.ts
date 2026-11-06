import { describe, expect, it } from 'vitest';
import { AttachmentRules } from '../../src/domain/AttachmentRules';
import { FileNames } from '../../src/domain/FileNames';
import { SafeUrl } from '../../src/domain/SafeUrl';

describe('SafeUrl', () => {
  it('adds https and normalises', () => {
    expect(SafeUrl.fromInput('  example.com/a ')).toBe('https://example.com/a');
    expect(SafeUrl.fromInput('example.com:8080')).toBe('https://example.com:8080/');
    expect(SafeUrl.fromInput('HTTP://Example.COM')).toBe('http://example.com/');
  });

  it.each([
    'java' + 'script:alert(1)',
    'java\tscript:alert(1)',
    'data:text/html,x',
    'file:///c',
    'intent://x',
    'blob:https://a.b/c',
    'https://bank.com@evil.com',
    'word',
    '',
  ])('refuses %j', (raw) => {
    expect(SafeUrl.fromInput(raw)).toBeNull();
  });

  it('limits the length', () => {
    expect(SafeUrl.strict('https://a.com/' + 'x'.repeat(2048))).toBeNull();
  });
});

describe('FileNames', () => {
  it('strips paths and reordering characters and keeps the extension', () => {
    expect(FileNames.sanitize('..\\..\\evil‮fdp.pdf', 'd.pdf')).toBe('evilfdp.pdf');
    expect(FileNames.sanitize('...', 'd.pdf')).toBe('d.pdf');
    expect(FileNames.sanitize('a'.repeat(300) + '.pdf', 'd.pdf').endsWith('.pdf')).toBe(true);
    expect(FileNames.forPdfDownload('notes', 'd.pdf')).toBe('notes.pdf');
  });
});

describe('AttachmentRules', () => {
  const pdf = new TextEncoder().encode('%PDF-1.7');

  it('trusts only the bytes and the size', () => {
    expect(AttachmentRules.reject(10, pdf)).toBeNull();
    expect(AttachmentRules.reject(10, new TextEncoder().encode('<html>'))).toBe('wrong-type');
    expect(AttachmentRules.reject(51 * 1024 * 1024, pdf)).toBe('too-large');
  });

  it('checks room only when the quota is known', () => {
    expect(AttachmentRules.hasRoom(null, 100)).toBe(true);
    expect(AttachmentRules.hasRoom({ quota: 100, usage: 95 }, 10)).toBe(false);
  });
});
