import type { Page } from '@playwright/test';

/** Where the first link-coloured pixels on the visible canvas are. */
export async function firstLinkPixel(page: Page): Promise<{ x: number; y: number }> {
  const shot = await page.locator('#stage').screenshot();
  const stage = await page.locator('#stage').boundingBox();
  if (!stage) throw new Error('no stage');
  const found = await page.evaluate(async (data) => {
    const image = new Image();
    image.src = 'data:image/png;base64,' + data;
    await image.decode();
    const canvas = new OffscreenCanvas(image.width, image.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(image, 0, 0);
    const { data: px, width, height } = ctx.getImageData(0, 0, image.width, image.height);
    const isLink = (x: number, y: number): boolean => {
      const at = (y * width + x) * 4;
      return (px[at] ?? 0) < 70 && (px[at + 1] ?? 0) < 110 && (px[at + 2] ?? 0) > 190;
    };
    const columns = Array.from({ length: width }, (_, x) => x);
    const rows = Array.from({ length: height }, (_, y) => y);
    const top = rows.find((y) => columns.some((x) => isLink(x, y)));
    if (top === undefined) return null;
    // The topmost pixel can be any glyph of the line, even its last (fonts differ by system), and
    // the caller's point moves right from here. So x comes from the left edge of the line.
    const line = rows.slice(top, top + 12);
    const left = columns.find((x) => line.some((y) => isLink(x, y)));
    return left === undefined ? null : { x: left, y: top };
  }, shot.toString('base64'));
  if (!found) throw new Error('no link on screen');
  return { x: stage.x + found.x + 8, y: stage.y + found.y + 2 };
}
