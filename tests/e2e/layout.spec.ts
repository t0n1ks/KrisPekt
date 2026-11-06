import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';

/** Phone, large phone, phone on its side, tablet in both orientations and two desktops. */
const SIZES = [
  { width: 320, height: 568 },
  { width: 360, height: 800 },
  { width: 800, height: 360 },
  { width: 412, height: 915 },
  { width: 800, height: 1280 },
  { width: 1280, height: 800 },
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 },
];

test.use({ actionTimeout: 8000 });

/** Set by hand to keep a screenshot of every surface: `KP_LAYOUT_SHOTS=dir npx playwright test layout`. */
const SHOTS = process.env.KP_LAYOUT_SHOTS;

type Texts = Record<string, unknown>;

function locale(language: string): Texts {
  return JSON.parse(readFileSync(`src/i18n/locales/${language}.json`, 'utf8')) as Texts;
}

/** A small, valid PDF, built by hand so that the test owns every byte of it. */
function onePagePdf(): Buffer {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 280] >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = body.length;
  const entries = offsets.map((at) => String(at).padStart(10, '0') + ' 00000 n \n').join('');
  body += `xref\n0 4\n0000000000 65535 f \n${entries}`;
  body += `trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

/**
 * Everything wrong with what is on screen now: parts of a surface outside the viewport, a page that
 * scrolls sideways, and buttons too small for a finger. Content inside a scrolling area may run past
 * that area, since it can be scrolled to; the area itself must fit.
 */
function problems(page: Page, selector: string): Promise<string[]> {
  return page.evaluate((surface) => {
    const found: string[] = [];
    const root = document.documentElement;
    if (root.scrollWidth > root.clientWidth) found.push(`page scrolls sideways: ${root.scrollWidth}`);
    const vw = root.clientWidth;
    const vh = window.innerHeight;
    const name = (node: Element): string =>
      `${node.tagName.toLowerCase()}.${(node.getAttribute('class') ?? '').split(' ')[0] ?? ''}`;
    const inScroller = (node: Element, box: Element): boolean => {
      if (node === box) return false;
      for (let up = node.parentElement; up && up !== box.parentElement; up = up.parentElement) {
        const { overflowX, overflowY } = getComputedStyle(up);
        if (/auto|scroll|hidden/.test(overflowX + overflowY)) return true;
      }
      return false;
    };
    const hasOwnText = (node: Element): boolean =>
      [...node.childNodes].some((child) => child.nodeType === 3 && child.textContent?.trim());
    for (const box of document.querySelectorAll(surface)) {
      for (const node of [box, ...box.querySelectorAll('*')]) {
        const r = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        if (!r.width || !r.height || style.visibility === 'hidden') continue;
        // The shelf is the one surface that scrolls with the page.
        const outsideDown = !box.matches('.library') && (r.top < -0.5 || r.bottom > vh + 0.5);
        const outside = r.left < -0.5 || r.right > vw + 0.5 || outsideDown;
        if (outside && !inScroller(node, box)) {
          found.push(`${name(node)} outside: ${[r.left, r.top, r.right, r.bottom].map(Math.round).join()}`);
        }
        const clickable = node.matches('button:not(:disabled), select');
        if (clickable && r.height < 43.5) found.push(`${name(node)} short: ${Math.round(r.height)}`);
        if (clickable && r.width < 43.5) found.push(`${name(node)} narrow: ${Math.round(r.width)}`);
        if (parseFloat(style.fontSize) < 8.5 && hasOwnText(node)) found.push(`${name(node)} tiny text`);
      }
    }
    return [...new Set(found)];
  }, selector);
}

/** Back to the plain editor or shelf, whatever is open. */
async function closeAll(page: Page): Promise<void> {
  for (let i = 0; i < 6; i++) {
    const open = await page.evaluate(() => {
      const close = document.querySelector<HTMLElement>(
        '.sheet__head .icon-btn, .pdf-viewer__bar .icon-btn, .toolbar-custom__done',
      );
      if (close) {
        close.click();
        return true;
      }
      const panel = document.querySelector<HTMLElement>('#panel:not([hidden]) #panelClose');
      if (panel) {
        panel.click();
        return true;
      }
      return !!document.querySelector('.menu, .popover');
    });
    if (!open) return;
    await page.keyboard.press('Escape');
    await page.evaluate(() =>
      document.documentElement.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })),
    );
    await page.waitForTimeout(40);
  }
}

async function record(page: Page, tag: string, name: string, selector: string, all: string[]): Promise<void> {
  await expect(page.locator(selector).first(), `${tag} ${name} is open`).toBeVisible();
  await page.waitForTimeout(60);
  for (const problem of await problems(page, selector)) all.push(`${tag} ${name}: ${problem}`);
  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: join(SHOTS, `${tag}-${name}.png`) });
  }
}

async function check(page: Page, tag: string, name: string, selector: string, all: string[]): Promise<void> {
  await record(page, tag, name, selector, all);
  await closeAll(page);
}

/** Opens a tool's options by long press, from the bar or from the bar's overflow. */
async function toolOptions(page: Page, kind: string): Promise<void> {
  const key = { pen: 'p', hl: 'h', eraser: 'e', lasso: 'l', text: 't' }[kind] ?? '';
  await page.keyboard.press(key);
  const direct = page.locator(`#tray [data-tool="${kind}"]`);
  if ((await direct.count()) === 0) await page.locator('.tool-tray__more').click();
  await page.locator(`[data-tool="${kind}"]`).first().dispatchEvent('contextmenu');
}

/** The menu item with exactly this label; some labels are followed by " · value". */
function menuByLabel(page: Page, label: unknown): Locator {
  const exact = String(label).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return page.locator('.menu__item', { hasText: new RegExp(`^${exact}( · .*)?$`) }).first();
}

async function checkLibrary(page: Page, tag: string, t: Texts, all: string[]): Promise<void> {
  await record(page, tag, 'shelf', '.library', all);
  await page.click('#btnLang');
  await check(page, tag, 'lib-language', '.menu', all);
  await page.click('#btnLibMore');
  await check(page, tag, 'lib-more', '.menu', all);
  await page.locator('.subject__more').first().click();
  await check(page, tag, 'subject-menu', '.menu', all);
  await page.locator('.notebook-card__more').first().click();
  await check(page, tag, 'notebook-menu', '.menu', all);
  await page.click('#btnAddSubject');
  await check(page, tag, 'subject-dialog', '.sheet', all);
  await page.click('#btnAddNb');
  await check(page, tag, 'notebook-dialog', '.sheet', all);
  for (const [name, key] of [
    ['trash', 'trash'],
    ['storage', 'storageReport'],
    ['storage-info', 'whereStored'],
  ] as const) {
    await page.click('#btnLibMore');
    await menuByLabel(page, t[key]).click();
    await check(page, tag, name, '.sheet', all);
  }
}

async function checkTools(page: Page, tag: string, all: string[]): Promise<void> {
  for (const kind of ['pen', 'hl', 'eraser', 'text']) {
    await toolOptions(page, kind);
    await check(page, tag, 'options-' + kind, '.popover', all);
  }
  await toolOptions(page, 'lasso');
  await check(page, tag, 'lasso-or-hand', '.menu', all);
  await page.keyboard.press('p');
  await page.locator('.tool-tray__more').click();
  await check(page, tag, 'toolbar-more', '.menu', all);
  await page.click('#btnEdMore');
  await check(page, tag, 'editor-more', '.menu', all);
}

async function checkEditorSheets(page: Page, tag: string, t: Texts, all: string[]): Promise<void> {
  await page.click('#btnEdMore');
  await menuByLabel(page, t.customizeToolbar).click();
  await check(page, tag, 'customize', '.toolbar-custom__card', all);
  await page.click('#btnEdMore');
  await menuByLabel(page, t.bookmarks).click();
  await check(page, tag, 'bookmarks', '.sheet', all);
  await page.click('#btnEdMore');
  await menuByLabel(page, t.exportMenu).click();
  await check(page, tag, 'export', '.sheet', all);
  await page.click('#btnEdMore');
  await menuByLabel(page, t.pageSizeBg).click();
  await check(page, tag, 'page-settings', '.sheet', all);
  await page.click('#btnPages');
  await record(page, tag, 'organizer', '#panel', all);
  await page.locator('.page-item').first().click({ button: 'right' });
  await check(page, tag, 'organizer-menu', '.menu', all);
}

/** A stroke to select, then the selection bar, its menu and the link dialog. */
async function checkSelection(page: Page, tag: string, all: string[]): Promise<void> {
  const box = await page.locator('#stage').boundingBox();
  if (!box) throw new Error('no stage');
  const x = box.x + box.width * 0.4;
  const y = box.y + box.height * 0.4;
  await page.keyboard.press('p');
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 50, y + 3, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.press('l');
  await page.mouse.move(x - 25, y - 25);
  await page.mouse.down();
  for (const [px, py] of [
    [x + 75, y - 25],
    [x + 75, y + 25],
    [x - 25, y + 25],
    [x - 25, y - 23],
  ]) {
    await page.mouse.move(px ?? 0, py ?? 0, { steps: 5 });
  }
  await page.mouse.up();
  await record(page, tag, 'selection-bar', '#selbar', all);
  await page.locator('#selbar button').nth(1).click();
  await record(page, tag, 'selection-menu', '.menu', all);
  await page.locator('.menu__item').first().click();
  await check(page, tag, 'link-dialog', '.sheet', all);
  await page.keyboard.press('p');
}

async function checkViewer(page: Page, tag: string, t: Texts, all: string[]): Promise<void> {
  await page.click('#btnEdMore');
  await menuByLabel(page, t.insertMenu).click();
  const chooser = page.waitForEvent('filechooser');
  await menuByLabel(page, t.insertPdfFile).click();
  await (await chooser).setFiles({ name: 'a.pdf', mimeType: 'application/pdf', buffer: onePagePdf() });
  const box = await page.locator('#stage').boundingBox();
  if (!box) throw new Error('no stage');
  await page.waitForTimeout(600);
  const x = box.x + box.width * 0.5;
  const y = box.y + box.height * 0.6;
  await page.mouse.click(x, y);
  await page.waitForTimeout(600);
  await page.keyboard.press('g');
  await page.mouse.click(x, y);
  await check(page, tag, 'viewer', '.pdf-viewer', all);
}

async function run(page: Page, tag: string, language: string): Promise<string[]> {
  const t = locale(language);
  const all: string[] = [];
  await page.goto('./');
  await page.locator('.subject').first().locator('.shelf__add').waitFor();
  await checkLibrary(page, tag, t, all);
  await page.locator('.subject').first().locator('.shelf__add').click();
  await page.fill('#nb-title', 'Layout');
  await page.click('.sheet__foot .btn--primary');
  await expect(page.locator('#editor')).toBeVisible();
  await page.locator('#tray').waitFor();
  await page.waitForTimeout(300);
  await checkTools(page, tag, all);
  await checkEditorSheets(page, tag, t, all);
  await checkSelection(page, tag, all);
  await checkViewer(page, tag, t, all);
  return all;
}

for (const size of SIZES) {
  test(`every surface fits at ${size.width}×${size.height}`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(size);
    expect(await run(page, `${size.width}x${size.height}`, 'ru')).toEqual([]);
  });
}

test.describe('the longest words', () => {
  test.use({ locale: 'de-DE' });

  test('German fits on the smallest phone', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 320, height: 568 });
    expect(await run(page, 'de-320x568', 'de')).toEqual([]);
  });
});

for (const size of SIZES) {
  test(`the page chip stays clear of the toolbar at ${size.width}×${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.goto('./');
    await page.locator('.subject').first().locator('.shelf__add').click();
    await page.fill('#nb-title', 'Chip');
    await page.click('.sheet__foot .btn--primary');
    await page.locator('#tray [data-tool="pen"]').waitFor();
    const chip = page.locator('#pageChip');
    await chip.click();
    await page.fill('#pageTitle', 'A long title for a page that cannot fit on one line of any phone');
    await page.click('.sheet__foot .btn--primary');
    await expect(page.locator('#pageTitle')).toBeHidden();
    const box = await chip.boundingBox();
    const others = await Promise.all(['#tray', '#fab'].map((id) => page.locator(id).boundingBox()));
    if (!box) throw new Error('no chip');
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.x + box.width).toBeLessThanOrEqual(size.width);
    expect(box.y + box.height).toBeLessThanOrEqual(size.height);
    for (const other of others) {
      if (!other) throw new Error('no toolbar');
      const apart =
        box.x + box.width <= other.x ||
        other.x + other.width <= box.x ||
        box.y + box.height <= other.y ||
        other.y + other.height <= box.y;
      expect(apart).toBe(true);
    }
  });
}
