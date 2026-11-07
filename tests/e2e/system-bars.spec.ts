import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { DesignTokens, type ColorScheme } from '../../src/domain/DesignTokens';

const TOKENS = readFileSync('src/styles/tokens.css', 'utf8');

/** `#fff` and `#FFFFFF` alike as `#ffffff`: the CSS minifier shortens colours. */
function hex(color: string): string {
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(color.trim());
  return (
    short ? `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}` : color.trim()
  ).toLowerCase();
}

function token(scheme: ColorScheme, name: string): string {
  const value = DesignTokens.read(TOKENS, scheme, name);
  if (!value) throw new Error(`no ${name} in tokens.css`);
  return hex(value);
}

/** The content of every theme-color meta, in document order. */
function themeColors(page: Page): Promise<string[]> {
  return page
    .evaluate(() =>
      [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')].map((meta) => meta.content),
    )
    .then((colors) => colors.map(hex));
}

/** What the browser would paint the bars with: the first meta whose media query matches. */
function activeThemeColor(page: Page): Promise<string | undefined> {
  return page
    .evaluate(() => {
      const metas = [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')];
      return metas.find((meta) => !meta.media || matchMedia(meta.media).matches)?.content;
    })
    .then((color) => (color === undefined ? undefined : hex(color)));
}

async function openNotebook(page: Page): Promise<void> {
  await page.locator('.notebook-card__cover').first().click();
  await page.locator('#tray [data-tool="pen"]').waitFor();
}

test('index.html carries one theme colour per scheme, equal to the background token', async ({ request }) => {
  const html = await (await request.get('./')).text();
  const metas = [...html.matchAll(/<meta[^>]*name="theme-color"[^>]*>/g)].map((m) => m[0]);
  expect(metas).toHaveLength(2);
  for (const scheme of ['light', 'dark'] as const) {
    const meta = metas.find((m) => m.includes(`(prefers-color-scheme: ${scheme})`));
    expect(meta?.toLowerCase(), scheme).toContain(`content="${token(scheme, '--desk')}"`);
  }
  expect(html).not.toMatch(/#2343b0/i);
});

test('the manifest paints the splash screen and the bars in the background colour', async ({ request }) => {
  const manifest = (await (await request.get('manifest.webmanifest')).json()) as Record<string, unknown>;
  expect(String(manifest.background_color).toLowerCase()).toBe(token('light', '--desk'));
  expect(String(manifest.theme_color).toLowerCase()).toBe(token('light', '--desk'));
  expect(manifest.display).toBe('standalone');
});

for (const scheme of ['light', 'dark'] as const) {
  test(`the bars follow the visible screen in the ${scheme} scheme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto('./');
    await page.locator('.subject').first().waitFor();
    expect(await activeThemeColor(page)).toBe(token(scheme, '--desk'));

    await openNotebook(page);
    // The editor starts with its top bar: the status bar continues it.
    expect(await activeThemeColor(page)).toBe(token(scheme, '--surface'));

    await page.click('#btnBack');
    await page.locator('.subject').first().waitFor();
    expect(await activeThemeColor(page)).toBe(token(scheme, '--desk'));
  });
}

test('the bars change with the system scheme while the app is open', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('./');
  await page.locator('.subject').first().waitFor();
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(() => activeThemeColor(page)).toBe(token('dark', '--desk'));
  await openNotebook(page);
  await page.emulateMedia({ colorScheme: 'light' });
  await expect.poll(() => activeThemeColor(page)).toBe(token('light', '--surface'));
});

test('a forced theme on the root element repaints the bars', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('./');
  await page.locator('.subject').first().waitFor();
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  // Whichever meta matches, every one shows the colour on screen.
  await expect.poll(() => themeColors(page)).toEqual([token('dark', '--desk'), token('dark', '--desk')]);
});
