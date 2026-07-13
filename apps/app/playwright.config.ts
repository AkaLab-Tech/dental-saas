import { defineConfig, devices } from '@playwright/test'

const APP_URL = process.env.VITE_APP_PORT ? `http://localhost:${process.env.VITE_APP_PORT}` : 'http://localhost:5002'
const API_URL = process.env.PORT ? `http://localhost:${process.env.PORT}` : 'http://localhost:5001'

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // A single dev-mode vite server backs every worker; running several
  // workers in parallel against its on-demand module compilation caused
  // widespread, non-deterministic locator timeouts. One worker trades some
  // wall-clock time for a suite that passes reliably.
  workers: 1,
  reporter: 'html',
  use: {
    baseURL: APP_URL,
    trace: 'on-first-retry',
    // Playwright's default chromium locale is en-US; with no localStorage
    // 'language' key yet (fresh context per test), i18next-browser-languagedetector
    // falls back to navigator.language, rendering the app in English and
    // breaking every Spanish-text assertion in this suite. Pin the browser
    // locale to Spanish so the UI matches what the specs assert.
    locale: 'es-ES',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // Two servers: `pnpm dev` run from this package's cwd only resolves to
  // this package's own "dev" script (vite), not the turbo root pipeline —
  // the API needs its own entry or it never boots for global-setup to hit.
  webServer: [
    {
      command: 'pnpm --filter @dental/api dev',
      url: `${API_URL}/api/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: 'pnpm dev',
      url: APP_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
})
