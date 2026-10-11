import { describe, expect, it } from 'vitest';
import { I18n } from '../../src/i18n/I18n';
import de from '../../src/i18n/locales/de.json';
import en from '../../src/i18n/locales/en.json';
import ru from '../../src/i18n/locales/ru.json';
import uk from '../../src/i18n/locales/uk.json';

const locales: Record<string, Record<string, unknown>> = { uk, ru, de, en };

describe('locale files', () => {
  const reference = Object.keys(ru).sort();

  it.each(Object.keys(locales))('%s has exactly the same keys as ru', (lang) => {
    expect(Object.keys(locales[lang] ?? {}).sort()).toEqual(reference);
  });

  it.each(Object.keys(locales))('%s values have the same shape as ru', (lang) => {
    const dict = locales[lang] ?? {};
    for (const key of reference) {
      const value = dict[key];
      const ref = (ru as Record<string, unknown>)[key];
      expect(typeof value, key).toBe(typeof ref);
      expect(Array.isArray(value), key).toBe(Array.isArray(ref));
      if (typeof value === 'string') expect(value.trim().length, key).toBeGreaterThan(0);
    }
  });

  it.each(Object.keys(locales))('%s keeps every placeholder used in ru', (lang) => {
    const dict = locales[lang] ?? {};
    for (const key of reference) {
      const ref = (ru as Record<string, unknown>)[key];
      if (typeof ref !== 'string') continue;
      const names = (s: string): string[] => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? '').sort();
      expect(names(String(dict[key])), key).toEqual(names(ref));
    }
  });
});

describe('I18n', () => {
  it('detects the first supported language', () => {
    expect(I18n.detectLanguage(['fr-FR', 'de-AT', 'en'])).toBe('de');
    expect(I18n.detectLanguage(['UK'])).toBe('uk');
    expect(I18n.detectLanguage(['fr', 'es'])).toBe('ru');
    expect(I18n.detectLanguage([])).toBe('ru');
  });

  it('substitutes placeholders and leaves unknown ones', () => {
    const i18n = new I18n('en');
    expect(i18n.t('pageN', { n: 3 })).toBe('Page 3');
    expect(i18n.t('pageN')).toBe('Page {n}');
  });

  it('switches language', () => {
    const i18n = new I18n('en');
    expect(i18n.setLanguage('de')).toBe(true);
    expect(i18n.setLanguage('de')).toBe(false);
    expect(i18n.t('done')).toBe('Fertig');
    expect(i18n.locale).toBe('de-DE');
  });

  it.each([
    [1, 'тетрадь'],
    [2, 'тетради'],
    [4, 'тетради'],
    [5, 'тетрадей'],
    [11, 'тетрадей'],
    [14, 'тетрадей'],
    [21, 'тетрадь'],
    [22, 'тетради'],
    [25, 'тетрадей'],
    [111, 'тетрадей'],
    [0, 'тетрадей'],
  ])('Russian plural for %i', (n, form) => {
    expect(new I18n('ru').plural(n, 'nb')).toBe(`${n} ${form}`);
  });

  it('Ukrainian uses three forms', () => {
    const i18n = new I18n('uk');
    expect(i18n.plural(1, 'pg')).toBe('1 сторінка');
    expect(i18n.plural(3, 'pg')).toBe('3 сторінки');
    expect(i18n.plural(12, 'pg')).toBe('12 сторінок');
  });

  it('German and English use two forms', () => {
    expect(new I18n('de').plural(1, 'subj')).toBe('1 Fach');
    expect(new I18n('de').plural(2, 'subj')).toBe('2 Fächer');
    expect(new I18n('en').plural(0, 'nb')).toBe('0 notebooks');
    expect(new I18n('en').plural(1, 'nb')).toBe('1 notebook');
  });

  it('returns lists', () => {
    expect(new I18n('en').list('colors')).toHaveLength(8);
  });
});
