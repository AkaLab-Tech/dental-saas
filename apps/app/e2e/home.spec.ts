import { test, expect } from '@playwright/test'

// HomePage.tsx (the "🦷 Alveo System" / "API Health Check" landing component
// this spec used to assert against) is dead code — App.tsx routes "/" to
// DashboardPage under ProtectedRoute, so HomePage is never actually
// reachable. The real marketing landing page lives in apps/web. This spec
// now asserts the ACTUAL unauthenticated behavior of "/": a redirect to
// /login.
test.describe('Home Page', () => {
  test('should redirect unauthenticated visitors from / to /login', async ({ page }) => {
    await page.goto('/')

    await expect(page).toHaveURL(/\/login/)
    await expect(page.getByRole('heading', { name: /iniciar sesión/i })).toBeVisible()
  })
})
