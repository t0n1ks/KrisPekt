import { afterEach, describe, expect, it, vi } from 'vitest';
import { ImageEncoder } from '../../src/features/images/ImageEncoder';

interface FakeOptions {
  /** Pixels are this opaque. */
  alpha?: number;
  /** Sizes each format comes out at; a missing one means the browser cannot write it. */
  sizes?: Record<string, number>;
  /** Canvases wider than this cannot be encoded. */
  maxWidth?: number;
  /** Told each format asked for. */
  asked?: string[];
}

const JPEG_HEAD = [0xff, 0xd8, 0xff, 0xe1];
const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** A stand-in canvas: what it encodes comes only from what was drawn, never from the source file. */
function installCanvas({ alpha = 255, sizes = {}, maxWidth = Infinity, asked = [] }: FakeOptions): {
  canvases: HTMLCanvasElement[];
} {
  const canvases: HTMLCanvasElement[] = [];
  const context = {
    drawImage: vi.fn(),
    fillRect: vi.fn(),
    getImageData: () => ({ data: new Uint8ClampedArray([1, 2, 3, alpha]) }),
  };
  const realCreate = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
    if (tag !== 'canvas') return realCreate(tag);
    const canvas = realCreate('canvas');
    canvas.getContext = (() => context) as unknown as HTMLCanvasElement['getContext'];
    canvas.toBlob = (done: BlobCallback, type?: string) => {
      asked.push(type ?? '');
      if (canvas.width > maxWidth) {
        done(null);
        return;
      }
      const size = sizes[type ?? ''];
      // As a browser does, a format it cannot write comes back as PNG.
      done(
        size === undefined
          ? new Blob(['p'.repeat(sizes['image/png'] ?? 1)], { type: 'image/png' })
          : new Blob(['x'.repeat(size)], { type }),
      );
    };
    canvases.push(canvas);
    return canvas;
  });
  return { canvases };
}

function installBitmap(width: number, height: number): void {
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(() => Promise.resolve({ width, height, close: vi.fn() })),
  );
}

function photoFile(): Blob {
  // JPEG with an EXIF marker and a GPS note, as a phone camera writes.
  return new Blob([new Uint8Array(JPEG_HEAD), 'Exif\0\0GPSLatitude secret'], { type: 'image/jpeg' });
}

function pngFile(): Blob {
  return new Blob([new Uint8Array(PNG_HEAD)], { type: 'image/png' });
}

const WEBP_ONLY = { 'image/webp': 100, 'image/jpeg': 150, 'image/png': 900 };

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('new photos', () => {
  it('are at most 2560 px on the longer side', async () => {
    const { canvases } = installCanvas({ sizes: WEBP_ONLY });
    installBitmap(5000, 2500);
    await new ImageEncoder().encode(photoFile());
    expect(canvases[0]).toMatchObject({ width: 2560, height: 1280 });
  });

  it('keep their size when they are smaller, and never grow', async () => {
    const { canvases } = installCanvas({ sizes: WEBP_ONLY });
    installBitmap(1000, 2000);
    await new ImageEncoder().encode(photoFile());
    expect(canvases[0]).toMatchObject({ width: 1000, height: 2000 });
  });

  it('become WebP at quality 0.85', async () => {
    installCanvas({ sizes: WEBP_ONLY });
    installBitmap(4000, 3000);
    const { blob } = await new ImageEncoder().encode(photoFile());
    expect(blob.type).toBe('image/webp');
  });

  it('fall back to JPEG where the browser cannot write WebP', async () => {
    installCanvas({ sizes: { 'image/jpeg': 150, 'image/png': 900 } });
    installBitmap(4000, 3000);
    expect((await new ImageEncoder().encode(photoFile())).blob.type).toBe('image/jpeg');
  });

  it('lose their EXIF and location: only what the canvas encodes is kept', async () => {
    installCanvas({ sizes: WEBP_ONLY });
    installBitmap(10, 10);
    const { blob } = await new ImageEncoder().encode(photoFile());
    expect(await blob.text()).not.toMatch(/Exif|GPS/);
  });

  it('keep a PNG when a graphic is smaller that way', async () => {
    installCanvas({ sizes: { 'image/webp': 100, 'image/png': 40 } });
    installBitmap(800, 600);
    expect((await new ImageEncoder().encode(pngFile())).blob.type).toBe('image/png');
  });

  it('use WebP for a PNG that comes out smaller as WebP', async () => {
    installCanvas({ sizes: { 'image/webp': 100, 'image/png': 900 } });
    installBitmap(800, 600);
    expect((await new ImageEncoder().encode(pngFile())).blob.type).toBe('image/webp');
  });

  it('never compare a JPEG photo against PNG, which is only slower', async () => {
    const asked: string[] = [];
    installCanvas({ sizes: WEBP_ONLY, asked });
    installBitmap(800, 600);
    await new ImageEncoder().encode(photoFile());
    expect(asked).toEqual(['image/webp']);
  });

  it('keep transparency: not painted over, and never JPEG', async () => {
    const { canvases } = installCanvas({ alpha: 0, sizes: { 'image/png': 900 } });
    installBitmap(800, 600);
    const { blob } = await new ImageEncoder().encode(pngFile());
    expect(blob.type).toBe('image/png');
    const context = canvases[0]?.getContext('2d') as unknown as { fillRect: ReturnType<typeof vi.fn> };
    expect(context.fillRect).not.toHaveBeenCalled();
  });

  it('with transparency may still be WebP, which can hold it, when that is smaller', async () => {
    installCanvas({ alpha: 10, sizes: { 'image/webp': 100, 'image/png': 900 } });
    installBitmap(800, 600);
    expect((await new ImageEncoder().encode(pngFile())).blob.type).toBe('image/webp');
  });
});

describe('Keep original photo quality', () => {
  it('keeps the full size, at a higher quality', async () => {
    const { canvases } = installCanvas({ sizes: WEBP_ONLY });
    installBitmap(6000, 4000);
    await new ImageEncoder(() => true).encode(photoFile());
    expect(canvases[0]).toMatchObject({ width: 6000, height: 4000 });
  });

  it('still drops the metadata', async () => {
    installCanvas({ sizes: WEBP_ONLY });
    installBitmap(10, 10);
    const { blob } = await new ImageEncoder(() => true).encode(photoFile());
    expect(await blob.text()).not.toMatch(/Exif|GPS/);
  });

  it('is off unless asked for', async () => {
    const { canvases } = installCanvas({ sizes: WEBP_ONLY });
    installBitmap(6000, 4000);
    await new ImageEncoder(() => false).encode(photoFile());
    expect(canvases[0]?.width).toBe(2560);
  });

  it('falls back to the smaller size when the device cannot make a canvas that large', async () => {
    const { canvases } = installCanvas({ sizes: WEBP_ONLY, maxWidth: 2560 });
    installBitmap(30000, 20000);
    const { blob } = await new ImageEncoder(() => true).encode(photoFile());
    expect(blob.type).toBe('image/webp');
    expect(canvases.at(-1)?.width).toBe(2560);
  });
});

describe('images that are refused', () => {
  it('as ever: too large, wrong type, undecodable', async () => {
    const encoder = new ImageEncoder();
    const huge = { size: 26 * 1024 * 1024 } as Blob;
    await expect(encoder.encode(huge)).rejects.toMatchObject({ reason: 'too-large' });
    await expect(encoder.encode(new Blob(['<svg></svg>']))).rejects.toMatchObject({ reason: 'wrong-type' });
    vi.stubGlobal('createImageBitmap', () => Promise.reject(new Error('bad')));
    await expect(encoder.encode(photoFile())).rejects.toMatchObject({ reason: 'undecodable' });
  });
});
