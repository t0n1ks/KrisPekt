import {
  ALLOWED_IMAGE_TYPES,
  IMAGE_JPEG_QUALITY,
  IMAGE_MAX_EDGE,
  MAX_IMAGE_BYTES,
  PAPER,
} from '../../core/constants';
import { context2d } from '../../core/utils/dom';
import { canvasToBlob, sniffFile } from '../../core/utils/files';

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
 * Turns an untrusted image file into a clean JPEG. Only JPEG, PNG and WebP are accepted,
 * checked by their magic bytes (not the name or declared type), up to 25 MB. The image is
 * decoded and redrawn on a white canvas (max 2200 px edge), which drops all metadata such
 * as EXIF and GPS location. SVG is never accepted.
 */
export class ImageEncoder {
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
      const blob = await this.toJpeg(source);
      return { blob, bitmap: await createImageBitmap(blob) };
    } finally {
      source.close();
    }
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
    const k = Math.min(1, IMAGE_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
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
