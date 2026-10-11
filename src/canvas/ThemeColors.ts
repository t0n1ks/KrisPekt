import { THEME_FALLBACK } from '../core/constants';

/**
 * Theme colours the canvas needs (desk, page shadow, page labels, ruler ink), read from the
 * CSS custom properties in tokens.css so canvas and DOM always match the active theme.
 */
export class ThemeColors {
  desk: string = THEME_FALLBACK.desk;
  shadow: string = THEME_FALLBACK.shadow;
  label: string = THEME_FALLBACK.label;
  fg: string = THEME_FALLBACK.fg;
  muted: string = THEME_FALLBACK.muted;

  /** Re-reads the variables; call when the colour scheme changes. */
  read(root: Element = document.documentElement): void {
    const styles = getComputedStyle(root);
    const get = (name: string): string => styles.getPropertyValue(name).trim();
    this.desk = get('--desk') || THEME_FALLBACK.desk;
    this.shadow = get('--shadow') || THEME_FALLBACK.shadow;
    this.label = get('--page-label') || THEME_FALLBACK.label;
    this.fg = get('--fg') || THEME_FALLBACK.fg;
    this.muted = get('--muted') || THEME_FALLBACK.muted;
  }
}
