import { defineConfig, devices } from '@playwright/test';

/** Runs the end-to-end smoke test against the production build (`npm run build` first). */
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:4173/KrisPekt/',
    locale: 'ru-RU',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173/KrisPekt/',
    reuseExistingServer: true,
  },
});
