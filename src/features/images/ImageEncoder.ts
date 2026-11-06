import {
  ALLOWED_IMAGE_TYPES,
  IMAGE_ALPHA_SAMPLE_EDGE,
  IMAGE_JPEG_QUALITY,
  IMAGE_LEGACY_MAX_EDGE,
  IMAGE_MAX_EDGE,
  IMAGE_ORIGINAL_QUALITY,
  IMAGE_QUALITY,
  MAX_IMAGE_BYTES,
  PAPER,
} from '../../core/constants';
import { context2d } from '../../core/utils/dom';
import { canvasToBlob, sniffFile, type SniffedType } from '../../core/utils/files';

/** Why an image was refused. */
export type ImageRejection = 'too-large' | 'wrong-type' | 'undecodable';

export class ImageRejectedError extends Error {
  constructor(readonly reason: ImageRejection) {
    super('Image rejected: ' + reason);
    this.name = 'ImageRejectedError';
  }
}

export interface EncodedImage {
  blob: Blob;
  bitmap: ImageBitmap;
}

/**
 * Turns an untrusted image file into a clean, compact one. Only JPEG, PNG and WebP are accepted,
 * checked by their magic bytes (not the name or declared type), up to 25 MB. The image is decoded
 * and redrawn on a canvas, so all metadata such as EXIF and GPS location is dropped, in every mode.
 * SVG is never accepted.
 *
 * Photos become WebP, or JPEG where the browser cannot write WebP, at most 2560 px on the longer
 * side. An image that may be a graphic (a PNG, or anything transparent) stays PNG if that is smaller.
 * "Keep original quality" keeps the full resolution and a high quality, but it still re-encodes:
 * the original bytes would carry the metadata along.
 */
export class ImageEncoder {
  constructor(private readonly keepOriginal: () => boolean = () => false) {}

  /** Checks and encodes an image. Throws {@link ImageRejectedError}. */
  async encode(file: Blob): Promise<EncodedImage> {
    if (file.size > MAX_IMAGE_BYTES) throw new ImageRejectedError('too-large');
    const type = await sniffFile(file);
    if (!type || !(ALLOWED_IMAGE_TYPES as readonly string[]).includes(type))
      throw new ImageRejectedError('wrong-type');
    let source: ImageBitmap;
    try {
      source = await createImageBitmap(file);
    } catch {
      throw new ImageRejectedError('undecodable');
    }
    try {
      const blob = await this.compress(source, type);
      return { blob, bitmap: await createImageBitmap(blob) };
    } finally {
      source.close();
    }
  }

  private async compress(source: ImageBitmap, type: SniffedType): Promise<Blob> {
    if (!this.keepOriginal()) return this.toCompact(source, type, IMAGE_MAX_EDGE, IMAGE_QUALITY);
    try {
      return await this.toCompact(source, type, Infinity, IMAGE_ORIGINAL_QUALITY);
    } catch {
      // Too large for this device's canvas: better a smaller image than none.
      return this.toCompact(source, type, IMAGE_MAX_EDGE, IMAGE_QUALITY);
    }
  }

  private async toCompact(
    source: ImageBitmap,
    type: SniffedType,
    maxEdge: number,
    quality: number,
  ): Promise<Blob> {
    const canvas = this.drawn(source, maxEdge);
    const transparent = type !== 'image/jpeg' && this.isTransparent(source);
    let best = await canvasToBlob(canvas, 'image/webp', quality);
    // A browser that cannot write WebP silently hands back a PNG instead.
    if (best.type !== 'image/webp') {
      if (transparent) return best;
      best = await canvasToBlob(canvas, 'image/jpeg', quality);
    }
    if (type === 'image/png' || transparent) {
      const png = await canvasToBlob(canvas, 'image/png', 1);
      if (png.size < best.size) return png;
    }
    return best;
  }

  /** The image at its final size, on a clear canvas, so transparency survives. */
  private drawn(source: ImageBitmap, maxEdge: number): HTMLCanvasElement {
    const k = Math.min(1, maxEdge / Math.max(source.width, source.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(source.width * k));
    canvas.height = Math.max(1, Math.round(source.height * k));
    context2d(canvas).drawImage(source, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  /** Looks at a small copy, which is enough: a smaller image keeps any part that shows through. */
  private isTransparent(source: ImageBitmap): boolean {
    const sample = this.drawn(source, IMAGE_ALPHA_SAMPLE_EDGE);
    const { data } = context2d(sample).getImageData(0, 0, sample.width, sample.height);
    for (let i = 3; i < data.length; i += 4) if ((data[i] ?? 255) < 255) return true;
    return false;
  }

  /** Re-encodes any decodable blob (used to normalise legacy blobs for backups). */
  async reencode(blob: Blob): Promise<Blob | null> {
    try {
      const bitmap = await createImageBitmap(blob);
      try {
        return await this.toJpeg(bitmap);
      } finally {
        bitmap.close();
      }
    } catch {
      return null;
    }
  }

  private toJpeg(bitmap: ImageBitmap): Promise<Blob> {
    const k = Math.min(1, IMAGE_LEGACY_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * k));
    canvas.height = Math.max(1, Math.round(bitmap.height * k));
    const ctx = context2d(canvas);
    ctx.fillStyle = PAPER.white;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvasToBlob(canvas, 'image/jpeg', IMAGE_JPEG_QUALITY);
  }
}
