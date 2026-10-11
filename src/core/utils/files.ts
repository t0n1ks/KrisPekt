/**
 * Opens the browser file picker and resolves with the chosen file, or null if cancelled.
 * The input is appended off-screen because some browsers ignore clicks on detached inputs.
 */
export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.className = 'file-input';
    let done = false;
    const finish = (file: File | null): void => {
      if (done) return;
      done = true;
      input.remove();
      resolve(file);
    };
    input.addEventListener('change', () => finish(input.files?.[0] ?? null));
    input.addEventListener('cancel', () => finish(null));
    document.body.append(input);
    input.click();
  });
}

/** Encodes a blob as base64 (without the `data:` prefix). */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsDataURL(blob);
  });
}

/** Decodes base64 into a blob. Throws on invalid input. */
export function base64ToBlob(b64: string, type: string): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

/** Number of bytes a base64 string decodes to. */
export function base64DecodedLength(b64: string): number {
  const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - pad;
}

export type SniffedType = 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf';

/** Identifies a file by its first bytes ("magic numbers"), ignoring its name and declared type. */
export function sniffBytes(head: Uint8Array): SniffedType | null {
  const at = (i: number): number => head[i] ?? -1;
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'image/jpeg';
  if ([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => at(i) === b)) return 'image/png';
  const ascii = (from: number, to: number): string => String.fromCharCode(...head.subarray(from, to));
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (ascii(0, 5) === '%PDF-') return 'application/pdf';
  return null;
}

/** Reads the first bytes of a file and sniffs its real type. */
export async function sniffFile(file: Blob): Promise<SniffedType | null> {
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  return sniffBytes(head);
}

/** Resolves a canvas to a blob, rejecting if the browser returns null. */
export function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))), type, quality);
  });
}
