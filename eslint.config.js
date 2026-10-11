import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/** Markup sinks that must never receive data (section 4B §1 of the coding rules). */
const htmlSinks = [
  {
    selector: 'AssignmentExpression[left.property.name=/^(innerHTML|outerHTML)$/]',
    message:
      'Do not assign innerHTML/outerHTML. Use textContent or the el() helper; static icons go through icons.ts.',
  },
  {
    selector: "CallExpression[callee.property.name='insertAdjacentHTML']",
    message: 'insertAdjacentHTML is banned: build nodes with el().',
  },
  {
    selector: "CallExpression[callee.object.name='document'][callee.property.name=/^(write|writeln)$/]",
    message: 'document.write is banned.',
  },
  {
    selector:
      "CallExpression[callee.property.name='setAttribute'][arguments.0.type='Literal'][arguments.0.value=/^on/i]",
    message: 'Inline event-handler attributes are banned: use addEventListener.',
  },
];

export default tseslint.config(
  {
    ignores: [
      'dist/',
      'dev-dist/',
      'coverage/',
      'playwright-report/',
      'test-results/',
      'reference/',
      'node_modules/',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.browser },
    },
    rules: {
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-script-url': 'error',
      'prefer-const': 'error',
      eqeqeq: ['error', 'smart'],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-restricted-syntax': ['error', ...htmlSinks],
    },
  },
  {
    // The single place allowed to put static, hard-coded SVG strings into the DOM.
    files: ['src/ui/icons.ts'],
    rules: {
      'no-restricted-syntax': ['error', ...htmlSinks.slice(1)],
    },
  },
  {
    files: ['vite.config.ts', 'vitest.config.ts', 'playwright.config.ts', 'eslint.config.js', 'tests/**'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
);
