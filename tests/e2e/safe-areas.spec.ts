import { expect, test, type Page } from '@playwright/test';

interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * Phones and tablets in both orientations, each with the system insets it reports when the app
 * draws edge to edge: status bar and camera cutout, gesture bar, cutout on the side in landscape.
 */
const DEVICES: { name: string; width: number; height: number; insets: Insets }[] = [
  { name: 'small phone', width: 320, height: 568, insets: { top: 24, right: 0, bottom: 16, left: 0 } },
  { name: 'phone', width: 412, height: 915, insets: { top: 32, right: 0, bottom: 24, left: 0 } },
  {
    name: 'phone on its side',
    width: 915,
    height: 412,
    insets: { top: 24, right: 24, bottom: 20, left: 40 },
  },
  { name: 'tablet', width: 800, height: 1280, insets: { top: 28, right: 0, bottom: 24, left: 0 } },
  {
    name: 'tablet on its side',
    width: 1280,
    height: 800,
    insets: { top: 28, right: 0, bottom: 24, left: 0 },
  },
];

/** Real `env(safe-area-inset-*)` values, set through the DevTools protocol (Chrome 136+). */
async function emulateInsets(page: Page, insets: Insets): Promise<void> {
  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setSafeAreaInsetsOverride', { insets });
}

/** Visible controls matching `selector` that reach into an inset. Scrolling content is left out. */
function underInsets(page: Page, selector: string, insets: Insets): Promise<string[]> {
  return page.evaluate(
    ({ selector, insets }) => {
      const vw = document.documentElement.clientWidth;
      const vh = window.innerHeight;
      const found: string[] = [];
      const clipped = (node: HTMLElement, box: DOMRect): boolean => {
        for (let up = node.parentElement; up; up = up.parentElement) {
          if (!/auto|scroll/.test(getComputedStyle(up).overflowY) || up.scrollHeight <= up.clientHeight)
            continue;
          // Content scrolls through the box's padding too; once scrolled to the end it clears it.
          const area = up.getBoundingClientRect();
          const css = getComputedStyle(up);
          return (
            box.bottom > area.bottom - parseFloat(css.paddingBottom) ||
            box.top < area.top + parseFloat(css.paddingTop)
          );
        }
        return false;
      };
      for (const node of document.querySelectorAll<HTMLElement>(selector)) {
        const box = node.getBoundingClientRect();
        if (!box.width || !box.height || !node.checkVisibility()) continue;
        if (node.closest('.pages-panel__list, #libList')) continue;
        // Scrolled out of its scrolling box: it can be scrolled to, clear of the bars.
        if (clipped(node, box)) continue;
        const name = node.id || node.className || node.tagName;
        if (box.top < insets.top - 0.5) found.push(`${name} under the status bar`);
        if (box.bottom > vh - insets.bottom + 0.5) found.push(`${name} under the gesture bar`);
        if (box.left < insets.left - 0.5) found.push(`${name} under the left edge`);
        if (box.right > vw - insets.right + 0.5) found.push(`${name} under the right edge`);
      }
      return found;
    },
    { selector, insets },
  );
}

/** The element's box, which must reach the given edges of the screen. */
async function edges(page: Page, selector: string): Promise<{ top: number; left: number; right: number }> {
  return page.locator(selector).evaluate((node) => {
    const box = node.getBoundingClientRect();
    return { top: box.top, left: box.left, right: document.documentElement.clientWidth - box.right };
  });
}

const CONTROLS = 'button, input, .search, .library__brand, .pages-panel__title';

for (const device of DEVICES) {
  test.describe(`${device.name} ${device.width}×${device.height}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width: device.width, height: device.height });
      await emulateInsets(page, device.insets);
      await page.goto('./');
      await page.locator('.subject').first().waitFor();
    });

    test('the library keeps its content inside the safe area', async ({ page }) => {
      expect(await underInsets(page, CONTROLS, device.insets)).toEqual([]);
      await page.click('#btnLibMore');
      await page.locator('.menu').waitFor();
      // A long menu scrolls inside: its own box stays clear, or, as a bottom sheet, it runs to the
      // bottom edge and pads its items above the gesture bar.
      const menu = await page.locator('.menu').evaluate((node) => ({
        sheet: node.classList.contains('menu--sheet'),
        padding: parseFloat(getComputedStyle(node).paddingBottom),
      }));
      if (menu.sheet) expect(menu.padding).toBeGreaterThanOrEqual(device.insets.bottom);
      else expect(await underInsets(page, '.menu', device.insets)).toEqual([]);
      await page.keyboard.press('Escape');
      await page.click('#btnAddSubject');
      await page.locator('.sheet').waitFor();
      expect(await underInsets(page, '.sheet button, .sheet input', device.insets)).toEqual([]);
    });

    test('the last notebook can scroll clear of the gesture bar', async ({ page }) => {
      await page.locator('.library').evaluate((node) => node.scrollTo(0, node.scrollHeight));
      const last = await page.locator('.notebook-card').last().boundingBox();
      if (!last) throw new Error('no notebook');
      expect(last.y + last.height).toBeLessThanOrEqual(device.height - device.insets.bottom);
    });

    test('the editor reaches the edges and keeps its controls clear', async ({ page }) => {
      await page.locator('.notebook-card__cover').first().click();
      await page.locator('#tray [data-tool="pen"]').waitFor();
      // The bar's background runs up under the status bar and out to both sides.
      expect(await edges(page, '.top-bar')).toEqual({ top: 0, left: 0, right: 0 });
      expect(await underInsets(page, '#editor button', device.insets)).toEqual([]);

      await page.click('#btnPages');
      await page.locator('#panelClose').waitFor();
      expect(await edges(page, '.pages-panel__head')).toEqual({ top: 0, left: 0, right: 0 });
      expect(await underInsets(page, '#panel button, .pages-panel__title', device.insets)).toEqual([]);
    });
  });
}
