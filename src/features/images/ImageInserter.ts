import type { BitmapCache } from '../../canvas/BitmapCache';
import type { Camera } from '../../canvas/Camera';
import type { PageLayout } from '../../canvas/PageLayout';
import { ALLOWED_IMAGE_TYPES, MM } from '../../core/constants';
import type { ImageItem, Page } from '../../core/types';
import { pickFile } from '../../core/utils/files';
import { clamp } from '../../core/utils/math';
import type { BlobRepository } from '../../storage/BlobRepository';
import type { ImageEncoder } from './ImageEncoder';

export interface ImageInserterDeps {
  encoder: ImageEncoder;
  blobs: BlobRepository;
  bitmaps: BitmapCache;
  camera: Camera;
  layout: PageLayout;
  makeId: () => string;
}

/** Lets the user pick a photo and places it in the middle of the visible part of a page. */
export class ImageInserter {
  constructor(private readonly deps: ImageInserterDeps) {}

  /**
   * Picks, validates, re-encodes and stores an image. Returns the new item (not yet added to
   * the page) or null if the picker was cancelled. Throws ImageRejectedError on bad files.
   */
  async pick(page: Page): Promise<ImageItem | null> {
    const file = await pickFile(ALLOWED_IMAGE_TYPES.join(','));
    if (!file) return null;
    const { blob, bitmap } = await this.deps.encoder.encode(file);
    const blobId = this.deps.makeId();
    await this.deps.blobs.save(blobId, blob);
    this.deps.bitmaps.put(blobId, bitmap);
    return this.place(page, blobId, bitmap.width, bitmap.height);
  }

  /** At most 70 % of the page in each direction, centred on the view, kept on the page. */
  private place(page: Page, blobId: string, width: number, height: number): ImageItem {
    const pw = page.w * MM;
    const ph = page.h * MM;
    let w = Math.min(pw * 0.7, width);
    let h = (w * height) / width;
    if (h > ph * 0.7) {
      h = ph * 0.7;
      w = (h * width) / height;
    }
    const { camera, layout } = this.deps;
    const center = layout.toPage(page, camera.toWorld(camera.width / 2, camera.height / 2));
    const cx = clamp(center.x, 0, pw);
    const cy = clamp(center.y, 0, ph);
    return {
      id: this.deps.makeId(),
      x: clamp(cx - w / 2, 0, pw - w),
      y: clamp(cy - h / 2, 0, ph - h),
      w,
      h,
      blob: blobId,
    };
  }
}
