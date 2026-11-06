import { defineConfig, devices } from '@playwright/test';

/** Runs the end-to-end smoke test against the production build (`npm run build` first). */
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:4173/KrisPekt/',
    locale: 'ru-RU',
    // Automatic backups download a file on their own schedule, which a test waiting for its own
    // download could take for it. A test about them turns them on.
    storageState: {
      cookies: [],
      origins: [
        {
          origin: 'http://localhost:4173',
          localStorage: [{ name: 'konspektnik.prefs.v1', value: '{"autoBackup":"off"}' }],
        },
      ],
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173/KrisPekt/',
    reuseExistingServer: true,
  },
});
