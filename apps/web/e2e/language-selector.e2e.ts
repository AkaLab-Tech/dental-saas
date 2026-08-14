import path from "node:path"
import { test, expect, type Page } from "@playwright/test"

// Task #220 -- language selector + i18n on the landing page (apps/web).
// v1 scope converts only: header/nav, HomePage's hero section, and the
// primary CTAs. Everything else (Pricing/Features pages, Footer, FAQ,
// Testimonials, legal pages, PublicBudgetPage, HomePage's non-hero
// sections) is deliberately left in Spanish -- see priority check 5.

// The e2e-runner invocation sets this to an absolute
// <worktree>/.task-log/screenshots/<iso-timestamp>/ path so screenshots land
// in a stable, gitignored location instead of wherever pnpm's cwd happens to
// be. Falls back to a local dir for ad-hoc runs.
const SCREENSHOT_DIR = process.env.E2E_SCREENSHOT_DIR ?? path.join(process.cwd(), "e2e-screenshots")

function screenshotPath(name: string) {
  return path.join(SCREENSHOT_DIR, name)
}

const LANGUAGE_LABEL = "Language"

async function selectLanguage(page: Page, code: "es" | "en" | "ar") {
  const selector = page.getByLabel(LANGUAGE_LABEL).first()
  await selector.selectOption(code)
}

test.describe("landing language selector", () => {
  test("renders in the header and lists es/en/ar", async ({ page }) => {
    await page.goto("/")

    const selector = page.getByLabel(LANGUAGE_LABEL).first()
    await expect(selector).toBeVisible()

    const optionLabels = await selector.locator("option").allTextContents()
    expect(optionLabels).toEqual(["Español", "English", "العربية"])

    await page.screenshot({ path: screenshotPath("01-selector-renders.png"), fullPage: true })
  })

  test("switching language changes header/nav + hero + primary CTA", async ({ page }) => {
    await page.goto("/")

    // Spanish (default) baseline.
    await expect(page.getByRole("link", { name: "Inicio" })).toBeVisible()
    await expect(page.getByRole("heading", { name: /Gestiona tu clínica dental/ })).toBeVisible()
    await expect(page.getByRole("link", { name: "Comenzar Prueba Gratis" })).toBeVisible()
    await page.screenshot({ path: screenshotPath("02a-es-hero.png"), fullPage: true })

    await selectLanguage(page, "en")

    await expect(page.getByRole("link", { name: "Home" })).toBeVisible()
    await expect(page.getByRole("heading", { name: /Manage your dental clinic/ })).toBeVisible()
    await expect(page.getByRole("link", { name: "Start Free Trial" })).toBeVisible()
    await expect(page.getByRole("link", { name: "Log In" })).toBeVisible()
    await page.screenshot({ path: screenshotPath("02b-en-hero.png"), fullPage: true })
  })

  test("preference persists across route navigation and reload via a host-only cookie", async ({
    page,
    context,
  }) => {
    await page.goto("/")
    await selectLanguage(page, "en")
    await expect(page.getByRole("link", { name: "Home" })).toBeVisible()

    const cookiesAfterSelect = await context.cookies()
    const languageCookie = cookiesAfterSelect.find((c) => c.name === "language")
    expect(languageCookie).toBeDefined()
    expect(languageCookie?.value).toBe("en")
    // localhost -> host-only cookie (cookieDomain undefined), never the
    // ".alveodent.com" parent-domain cookie used in production.
    expect(languageCookie?.domain).toBe("localhost")

    // Navigate to another landing route -- nav/header should stay English.
    await page.getByRole("link", { name: "Pricing" }).click()
    await expect(page).toHaveURL(/\/precios/)
    await expect(page.getByRole("link", { name: "Home" })).toBeVisible()

    // Reload should keep the same preference (cookie takes priority in the
    // detector order).
    await page.reload()
    await expect(page.getByRole("link", { name: "Home" })).toBeVisible()

    await page.screenshot({ path: screenshotPath("03-persisted-after-reload.png"), fullPage: true })
  })

  test("ar applies RTL direction without visibly breaking the layout", async ({ page }) => {
    await page.goto("/")
    await selectLanguage(page, "ar")

    await expect(page.locator("html")).toHaveAttribute("dir", "rtl")
    await expect(page.locator("html")).toHaveAttribute("lang", "ar")
    await expect(page.getByRole("heading", { name: /أدر عيادة الأسنان/ })).toBeVisible()

    await page.screenshot({ path: screenshotPath("04-ar-rtl.png"), fullPage: true })
  })

  test("non-converted sections still render in Spanish regardless of selected language", async ({
    page,
  }) => {
    await page.goto("/")
    await selectLanguage(page, "en")

    // HomePage's non-hero sections (features grid, CTA band) are out of
    // v1 scope and stay hardcoded Spanish -- not a bug.
    await expect(
      page.getByRole("heading", { name: "Todo lo que necesitas para tu clínica" })
    ).toBeVisible()
    await expect(page.getByRole("heading", { name: "¿Listo para transformar tu clínica?" })).toBeVisible()

    // Pricing page is entirely out of v1 scope.
    await page.getByRole("link", { name: "Pricing" }).click()
    await expect(page).toHaveURL(/\/precios/)
    await page.screenshot({ path: screenshotPath("05-non-converted-pricing.png"), fullPage: true })
  })
})
