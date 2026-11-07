/// <reference types="node" />
// Read from disk: Vitest replaces CSS imports, even `?raw` ones, with an empty string.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DesignTokens } from '../../src/domain/DesignTokens';

const TOKENS = readFileSync('src/styles/tokens.css', 'utf8');

/** The body of the system dark-mode block, which must repeat the forced dark theme exactly. */
function systemDarkBlock(css: string): string {
  const match = /:root:not\(\[data-theme='light'\]\)\s*\{([^}]*)\}/.exec(css);
  if (!match?.[1]) throw new Error('no system dark block');
  return match[1];
}

describe('DesignTokens', () => {
  it('reads the background of both schemes from tokens.css', () => {
    expect(DesignTokens.read(TOKENS, 'light', '--desk')).toMatch(/^#[0-9a-f]{6}$/i);
    expect(DesignTokens.read(TOKENS, 'dark', '--desk')).toMatch(/^#[0-9a-f]{6}$/i);
    expect(DesignTokens.read(TOKENS, 'dark', '--desk')).not.toBe(
      DesignTokens.read(TOKENS, 'light', '--desk'),
    );
  });

  it('reads the same dark values as the system dark mode uses', () => {
    const system = systemDarkBlock(TOKENS);
    for (const name of ['--desk', '--surface']) {
      const value = DesignTokens.read(TOKENS, 'dark', name);
      expect(system).toContain(`${name}: ${value};`);
    }
  });

  it('falls back to the light value for a token the dark theme does not change', () => {
    expect(DesignTokens.read(TOKENS, 'dark', '--r-lg')).toBe(DesignTokens.read(TOKENS, 'light', '--r-lg'));
  });

  it('ignores comments and does not confuse similar names', () => {
    const css = `/* :root { --desk: #000000; } */
      :root { --desk-2: #222222; --desk: #e3e7ed; }
      :root[data-theme='dark'] { --desk: #111418; }`;
    expect(DesignTokens.read(css, 'light', '--desk')).toBe('#e3e7ed');
    expect(DesignTokens.read(css, 'dark', '--desk')).toBe('#111418');
  });

  it('returns undefined for a missing token or block', () => {
    expect(DesignTokens.read(TOKENS, 'light', '--nope')).toBeUndefined();
    expect(DesignTokens.read('', 'dark', '--desk')).toBeUndefined();
  });
});
