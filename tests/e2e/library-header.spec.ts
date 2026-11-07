import { expect, test, type Page } from '@playwright/test';

const WIDTHS = [320, 360, 412];
const LOCALES = { uk: 'uk-UA', ru: 'ru-RU', de: 'de-DE', en: 'en-US' } as const;

/** A sample subject's name, a name of one very long word, and a long name of several words. */
const LONG_WORD = 'Электродинамикасплошныхсред';
const LONG_NAME = 'Дифференциальные уравнения и вариационное исчисление';

async function addSubject(page: Page, name: string): Promise<void> {
  await page.click('#btnAddSubject');
  await page.fill('#subj-name', name);
  await page.click('.sheet__foot .btn--primary');
  await expect(page.locator('.subject__name').last()).toHaveText(name);
}

/** Layout of every subject header: lines of the name, whether it is clipped, and where ⋯ is. */
function subjectHeads(
  page: Page,
): Promise<{ name: string; lines: number; clipped: boolean; moreOnRow: boolean }[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.subject__head')].map((head) => {
      const name = head.querySelector<HTMLElement>('.subject__name');
      const more = head.querySelector<HTMLElement>('.subject__more');
      if (!name || !more) throw new Error('incomplete subject header');
      const lineHeight = parseFloat(getComputedStyle(name).lineHeight);
      const nameBox = name.getBoundingClientRect();
      const moreBox = more.getBoundingClientRect();
      const headBox = head.getBoundingClientRect();
      return {
        name: name.textContent ?? '',
        lines: Math.round(nameBox.height / lineHeight),
        clipped: name.scrollWidth > name.clientWidth,
        // ⋯ shares the row with the name and ends at the right edge of the header
        moreOnRow:
          moreBox.top < nameBox.bottom &&
          moreBox.bottom > nameBox.top &&
          moreBox.right <= headBox.right + 0.5,
      };
    }),
  );
}

/** The top of each header button, and whether any button sticks out of the screen. */
function headerButtons(page: Page): Promise<{ tops: Record<string, number>; outside: string[] }> {
  return page.evaluate(() => {
    const tops: Record<string, number> = {};
    const outside: string[] = [];
    const vw = document.documentElement.clientWidth;
    for (const id of ['btnAddSubject', 'btnAddNb', 'btnLang', 'btnLibMore']) {
      const box = document.getElementById(id)?.getBoundingClientRect();
      if (!box) throw new Error(`no #${id}`);
      tops[id] = Math.round(box.top);
      if (box.left < 0 || box.right > vw) outside.push(id);
    }
    return { tops, outside };
  });
}

for (const [language, locale] of Object.entries(LOCALES)) {
  test.describe(`library header in ${language}`, () => {
    test.use({ locale });

    for (const width of WIDTHS) {
      test(`titles stay whole and the buttons line up at ${width} px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 800 });
        await page.goto('./');
        await page.locator('.subject').first().waitFor();
        await addSubject(page, LONG_WORD);
        await addSubject(page, LONG_NAME);

        for (const head of await subjectHeads(page)) {
          expect(head.lines, `${head.name} is on one line`).toBe(1);
          expect(head.moreOnRow, `⋯ of ${head.name} is on its row`).toBe(true);
          // A name that does not fit is cut with an ellipsis, never broken inside a word.
          if (head.name === LONG_WORD) expect(head.clipped).toBe(true);
        }
        await expect(page.locator('.subject__name').last()).toHaveAttribute('title', LONG_NAME);

        const { tops, outside } = await headerButtons(page);
        expect(outside).toEqual([]);
        // Language and ⋯ together on the brand's row, the two create buttons together below.
        expect(tops.btnLang).toBe(tops.btnLibMore);
        expect(tops.btnAddSubject).toBe(tops.btnAddNb);
        expect(tops.btnAddSubject).toBeGreaterThan(tops.btnLibMore ?? 0);
      });
    }
  });
}

test('a notebook title breaks only between words', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto('./');
  const title = page.locator('.notebook-card__title').first();
  await title.waitFor();
  const style = await title.evaluate((node) => {
    const css = getComputedStyle(node);
    return { wrap: css.overflowWrap, word: css.wordBreak, overflow: css.textOverflow };
  });
  expect(style).toEqual({ wrap: 'normal', word: 'normal', overflow: 'ellipsis' });
});
