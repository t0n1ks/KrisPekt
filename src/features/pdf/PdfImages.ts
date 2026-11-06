import { PDF_WEBP_JPEG_QUALITY } from '../../core/constants';
import type { Page } from '../../core/types';
import type { BlobRepository } from '../../storage/BlobRepository';
import type { PdfImage } from './PdfVectorBackend';

/**
 * The stored images of a page as bytes for jsPDF: photos and PDF page backgrounds keep their
 * stored resolution and encoding (JPEG stays JPEG, PNG stays PNG). The type is taken from the
 * magic bytes, not the blob's declared type. PDF cannot hold WebP, so a WebP is converted: to JPEG
 * at high quality, as a photo in PNG would take many times the space, or to PNG if it has transparency.
 */
export class PdfImages {
  private readonly cache = new Map<string, Promise<PdfImage | null>>();

  constructor(private readonly blobs: BlobRepository) {}

  /** Images used on a page by blob id; null for one that is missing or unreadable. */
  async forPage(page: Page): Promise<Map<string, PdfImage | null>> {
    const ids = [...(page.bgBlob ? [page.bgBlob] : []), ...page.images.map((im) => im.blob)];
    for (const card of page.cards) if (card.kind === 'pdf' && card.thumb) ids.push(card.thumb);
    const out = new Map<string, PdfImage | null>();
    for (const id of ids) out.set(id, await this.get(id));
    return out;
  }

  /** Forgets loaded bytes (after an export finished). */
  clear(): void {
    this.cache.clear();
  }

  /** The image format of some bytes, by their signature. */
  static sniff(bytes: Uint8Array): PdfImage['format'] | null {
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'JPEG';
    const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    if (png.every((b, i) => bytes[i] === b)) return 'PNG';
    return null;
  }

  private get(id: string): Promise<PdfImage | null> {
    let pending = this.cache.get(id);
    if (!pending) {
      pending = this.read(id).catch(() => null);
      this.cache.set(id, pending);
    }
    return pending;
  }

  private async read(id: string): Promise<PdfImage | null> {
    const blob = await this.blobs.get(id);
    if (!blob) return null;
    const data = new Uint8Array(await blob.arrayBuffer());
    const format = PdfImages.sniff(data);
    if (format) return { data, format };
    return PdfImages.convert(blob);
  }

  private static async convert(blob: Blob): Promise<PdfImage> {
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no canvas');
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const format = PdfImages.isOpaque(ctx, canvas) ? 'JPEG' : 'PNG';
    const encoded = await new Promise<Blob | null>((resolve) =>
      format === 'JPEG'
        ? canvas.toBlob(resolve, 'image/jpeg', PDF_WEBP_JPEG_QUALITY)
        : canvas.toBlob(resolve, 'image/png'),
    );
    canvas.width = 0;
    if (!encoded) throw new Error('image encoding failed');
    return { data: new Uint8Array(await encoded.arrayBuffer()), format };
  }

  private static isOpaque(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): boolean {
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 3; i < data.length; i += 4) if ((data[i] ?? 255) < 255) return false;
    return true;
  }
}
