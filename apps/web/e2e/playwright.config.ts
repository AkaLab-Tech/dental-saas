import path from "node:path"
import { fileURLToPath } from "node:url"
import { defineConfig, devices } from "@playwright/test"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// Repo root, three levels up from apps/web/e2e.
const REPO_ROOT = path.resolve(__dirname, "../../..")

const WEB_URL = process.env.VITE_WEB_PORT
  ? `http://localhost:${process.env.VITE_WEB_PORT}`
  : "http://localhost:5003"

// Task #220 -- landing page (apps/web) has no Playwright setup of its own
// (only apps/app does). The whole scaffold lives under apps/web/e2e/ (config
// included) so it matches the **/e2e/** exempt glob in .atelier.json's
// prSize count instead of adding a countable top-level config file.
export default defineConfig({
  testDir: ".",
  // Default Playwright/vitest glob both key off *.test.* / *.spec.* --
  // vitest's own default `include` would otherwise pick up files under this
  // dir too (it has no e2e-aware exclude, and apps/web/vite.config.ts is out
  // of scope for this task). Naming specs *.e2e.ts and pointing testMatch at
  // that pattern keeps the two runners out of each other's way without
  // touching vite.config.ts.
  testMatch: "**/*.e2e.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  // "playwright-report" matches the repo-root .gitignore pattern already
  // used by apps/app's e2e setup.
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL: WEB_URL,
    trace: "on-first-retry",
    screenshot: "on",
    // Playwright's default chromium locale is en-US; with no 'language'
    // cookie yet (fresh context per test), i18next-browser-languagedetector
    // falls back to navigator.language, rendering the landing page in
    // English and breaking the Spanish-default assertions in this suite.
    // Pin the browser locale to Spanish, mirroring apps/app's e2e config.
    locale: "es-ES",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm --filter @dental/web dev",
    cwd: REPO_ROOT,
    url: WEB_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
