import { LANGUAGES } from '../../core/constants';
import type { Language } from '../../core/types';
import type { MenuEntry } from '../dialogs/Menu';

/** Menu entries listing the interface languages, with a check on the current one. */
export function languageMenu(current: Language, onPick: (language: Language) => void): MenuEntry[] {
  return LANGUAGES.map((l) => ({ label: l.name, check: l.k === current, onClick: () => onPick(l.k) }));
}

/** Short code for the language pill ("UA", "RU", …). */
export function languageShort(language: Language): string {
  return LANGUAGES.find((l) => l.k === language)?.short ?? language.toUpperCase();
}
