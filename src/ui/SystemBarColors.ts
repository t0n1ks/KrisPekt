/** The screen that fills the window. */
export type AppScreen = 'library' | 'editor';

/**
 * Which token is at the top edge of each screen: the library lies on the desk, the editor (and
 * its pages panel and PDF viewer) starts with a bar in the surface colour.
 */
const TOP_TOKEN: Record<AppScreen, string> = {
  library: '--desk',
  editor: '--surface',
};

/**
 * Keeps `<meta name="theme-color">` equal to the colour at the top of the visible screen, so
 * Android's status bar and the title bar of an installed desktop app blend into the app.
 *
 * The build puts one meta per colour scheme into index.html, which covers the first paint. This
 * class then writes the live colour into every one of them: whichever media query matches, the
 * bar shows what is on screen, also when a `data-theme` attribute overrides the system scheme.
 * The colour is read from the computed tokens, never hard-coded, so it follows tokens.css.
 */
export class SystemBarColors {
  private screen: AppScreen = 'library';
  private readonly cleanup: (() => void)[] = [];

  constructor(private readonly doc: Document) {}

  /** Starts following the colour scheme (system setting or `data-theme`) and applies the colour. */
  start(): void {
    const view = this.doc.defaultView;
    const update = (): void => this.apply();
    const scheme = view?.matchMedia?.('(prefers-color-scheme: dark)');
    scheme?.addEventListener('change', update);
    if (scheme) this.cleanup.push(() => scheme.removeEventListener('change', update));
    const observer = new MutationObserver(update);
    observer.observe(this.doc.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    this.cleanup.push(() => observer.disconnect());
    this.apply();
  }

  /** The library or the editor became the visible screen. */
  show(screen: AppScreen): void {
    this.screen = screen;
    this.apply();
  }

  /** Stops following the colour scheme. */
  destroy(): void {
    for (const off of this.cleanup.splice(0)) off();
  }

  private apply(): void {
    const view = this.doc.defaultView;
    if (!view) return;
    const color = view
      .getComputedStyle(this.doc.documentElement)
      .getPropertyValue(TOP_TOKEN[this.screen])
      .trim();
    if (!color) return;
    for (const meta of this.metas()) {
      if (meta.content !== color) meta.content = color;
    }
  }

  /** The theme-color metas; one is created if the page has none. */
  private metas(): HTMLMetaElement[] {
    const found = [...this.doc.head.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')];
    if (found.length) return found;
    const meta = this.doc.createElement('meta');
    meta.name = 'theme-color';
    this.doc.head.append(meta);
    return [meta];
  }
}
