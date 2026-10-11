import { FALLBACK_LANGUAGE, LOCALES } from '../core/constants';
import type { Language } from '../core/types';
import de from './locales/de.json';
import en from './locales/en.json';
import ru from './locales/ru.json';
import uk from './locales/uk.json';

type Dictionary = typeof ru;
/** Keys whose value is a plain string. */
export type TextKey = { [K in keyof Dictionary]: Dictionary[K] extends string ? K : never }[keyof Dictionary];
/** Keys whose value is a list of strings (plural forms, colour names). */
export type ListKey = {
  [K in keyof Dictionary]: Dictionary[K] extends string[] ? K : never;
}[keyof Dictionary];
/** Nouns with plural forms (`pl_subj`, `pl_nb`, `pl_pg`). */
export type PluralNoun = 'subj' | 'nb' | 'pg';

type LooseDictionary = Partial<Record<string, string | string[]>>;

const DICTIONARIES: Record<Language, LooseDictionary> = { ru, uk, de, en };

/** Whether a string is one of the supported interface languages. */
export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(DICTIONARIES, value);
}

/**
 * Translations and plural rules. Strings are looked up in the current language, then in
 * Russian (the prototype's source language), then the key itself is shown.
 */
export class I18n {
  private current: Language;

  constructor(language: Language) {
    this.current = language;
  }

  /** Picks the first supported language from the browser's preference list (fallback: ru). */
  static detectLanguage(preferred: readonly string[]): Language {
    for (const tag of preferred) {
      const code = String(tag).slice(0, 2).toLowerCase();
      if (isLanguage(code)) return code;
    }
    return FALLBACK_LANGUAGE;
  }

  /**
   * Index of the plural form for `n`. Ukrainian and Russian have three forms
   * (1 / 2–4 / 5–20, by the last two digits); German and English have two.
   */
  static pluralIndex(language: Language, n: number): number {
    if (language === 'ru' || language === 'uk') {
      const lastTwo = Math.abs(n) % 100;
      const last = lastTwo % 10;
      if (lastTwo > 10 && lastTwo < 20) return 2;
      if (last === 1) return 0;
      if (last > 1 && last < 5) return 1;
      return 2;
    }
    return n === 1 ? 0 : 1;
  }

  /** Current language. */
  get language(): Language {
    return this.current;
  }

  /** BCP 47 locale for dates. */
  get locale(): string {
    return LOCALES[this.current];
  }

  /** Switches the language. Returns false if it was already active. */
  setLanguage(language: Language): boolean {
    if (language === this.current) return false;
    this.current = language;
    return true;
  }

  /** Translates `key`, replacing `{name}` placeholders with `vars`. */
  t(key: TextKey, vars?: Record<string, string | number>): string {
    const raw = this.lookup(key);
    let text = typeof raw === 'string' ? raw : key;
    if (vars)
      text = text.replace(/\{(\w+)\}/g, (m, name: string) => (vars[name] != null ? String(vars[name]) : m));
    return text;
  }

  /** Returns a list value such as the colour names. */
  list(key: ListKey): string[] {
    const raw = this.lookup(key);
    return Array.isArray(raw) ? raw : [];
  }

  /** "3 тетради", "1 notebook". */
  plural(n: number, noun: PluralNoun): string {
    const forms = this.list(`pl_${noun}`);
    const form = forms[I18n.pluralIndex(this.current, n)] ?? forms[forms.length - 1] ?? '';
    return n + ' ' + form;
  }

  private lookup(key: string): string | string[] | undefined {
    return DICTIONARIES[this.current][key] ?? DICTIONARIES[FALLBACK_LANGUAGE][key];
  }
}
