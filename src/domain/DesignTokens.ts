/** The two colour schemes defined in tokens.css. */
export type ColorScheme = 'light' | 'dark';

/**
 * Reads design tokens straight from the text of tokens.css. The build uses it to give the system
 * bars (`<meta name="theme-color">`, the manifest's `theme_color` and `background_color`) the same
 * colours as the app, so the values exist in exactly one place.
 */
export class DesignTokens {
  /**
   * Where each scheme is declared: the light values in the first plain `:root` block, the dark
   * ones in the `:root[data-theme='dark']` block (the same values as the system dark mode block).
   */
  private static readonly BLOCKS: Record<ColorScheme, RegExp> = {
    light: /:root\s*\{([^}]*)\}/,
    dark: /:root\[data-theme=['"]?dark['"]?\]\s*\{([^}]*)\}/,
  };

  /**
   * The value of the custom property `name` (for example `--desk`) in `scheme`, or `undefined`
   * when the block or the property is missing. Dark mode falls back to the light value, as the
   * cascade does for a token that only the light block defines.
   */
  static read(css: string, scheme: ColorScheme, name: string): string | undefined {
    const value = DesignTokens.inBlock(css, scheme, name);
    if (value !== undefined || scheme === 'light') return value;
    return DesignTokens.inBlock(css, 'light', name);
  }

  private static inBlock(css: string, scheme: ColorScheme, name: string): string | undefined {
    const body = DesignTokens.BLOCKS[scheme].exec(DesignTokens.withoutComments(css))?.[1];
    if (body === undefined) return undefined;
    const escaped = name.replace(/[-]/g, '\\-');
    const match = new RegExp(`(?:^|[;\\s])${escaped}\\s*:\\s*([^;]+);`).exec(body);
    return match?.[1]?.trim();
  }

  private static withoutComments(css: string): string {
    return css.replace(/\/\*[\s\S]*?\*\//g, '');
  }
}
