import { test as base, type Page } from '@playwright/test'
import { readFileSync } from 'fs'
import { AUTH_STATE_PATH } from '../global-setup'

/**
 * The app persists auth in sessionStorage (not localStorage) — see
 * apps/app/src/stores/auth.store.ts. Playwright's built-in `storageState`
 * only serializes cookies + localStorage, so it silently fails to restore
 * this session. Instead we inject the zustand-persist payload into
 * sessionStorage via an init script before every navigation.
 */
export const test = base.extend<{ authedPage: Page }>({
  authedPage: async ({ page }, use) => {
    const { user, accessToken, refreshToken } = JSON.parse(
      readFileSync(AUTH_STATE_PATH, 'utf-8')
    )

    const dentalAuthValue = JSON.stringify({
      state: {
        user,
        accessToken,
        refreshToken,
        isAuthenticated: true,
      },
      version: 0,
    })

    await page.addInitScript((value) => {
      window.sessionStorage.setItem('dental-auth', value)
    }, dentalAuthValue)

    await use(page)
  },
})

export { expect } from '@playwright/test'
