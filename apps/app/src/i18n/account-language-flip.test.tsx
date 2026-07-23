/**
 * Regression tests for task #280 — sidebar nav still flickers ES/EN when the
 * account's saved language differs from the browser/detector-resolved
 * language (follow-up to #210).
 *
 * #210 fixed the SYNCHRONOUS flicker: main.tsx now gates the initial render
 * on i18nReady, so the detector's own resolution settles before anything
 * paints. It did NOT cover the ASYNC case this suite targets: the tenant's
 * saved language preference is fetched from the API *after* the detector has
 * already resolved a (possibly different) language, and previously only
 * PreferencesForm applied it — so every other authenticated page kept
 * showing the detector-resolved language until the user happened to visit
 * Settings.
 *
 * Fix (#280): useAccountLanguage is now the single global path that applies
 * settings.language, mounted unconditionally in AppLayout. These tests mount
 * the real hook together with the same NavLabels harness #210 uses, driven
 * by the real i18n singleton (no mocking of i18n itself), and assert the
 * nav settles to exactly one locale — the account's — with no leftover
 * detector-language values once settings resolve.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { useTranslation } from 'react-i18next'
import i18n, { i18nReady } from './index'
import { useAccountLanguage } from '@/hooks/useAccountLanguage'
import type { TenantSettings } from '@/lib/settings-api'

function NavLabels() {
  const { t } = useTranslation()
  return (
    <ul>
      <li data-testid="nav-dashboard">{t('nav.dashboard')}</li>
      <li data-testid="nav-patients">{t('nav.patients')}</li>
      <li data-testid="nav-logout">{t('nav.logout')}</li>
    </ul>
  )
}

// Harness: mirrors how AppLayout wires the hook — settings starts out null
// (as if the fetch hasn't resolved yet) and is passed in as a prop so the
// test can simulate the store updating after the nav is already mounted.
function AccountLanguageHarness({ settings }: { settings: TenantSettings | null }) {
  useAccountLanguage(settings)
  return <NavLabels />
}

const NAV_EN = { dashboard: 'Dashboard', patients: 'Patients', logout: 'Logout' }
const NAV_ES = { dashboard: 'Panel de Control', patients: 'Pacientes', logout: 'Cerrar sesión' }
const NAV_AR = { dashboard: 'لوحة التحكم', patients: 'المرضى', logout: 'تسجيل الخروج' }

function makeSettings(language: TenantSettings['language']): TenantSettings {
  return {
    id: 'settings-1',
    language,
    dateFormat: 'DD/MM/YYYY',
    timeFormat: '24h',
    defaultAppointmentDuration: 30,
    appointmentBuffer: 10,
    businessHours: {},
    workingDays: [1, 2, 3, 4, 5],
    emailNotifications: true,
    smsNotifications: false,
    appointmentReminders: true,
    reminderHoursBefore: 24,
    autoLockMinutes: 0,
    updatedAt: '2026-07-01T00:00:00.000Z',
  }
}

async function switchLocale(code: string) {
  await act(async () => {
    await i18n.changeLanguage(code)
  })
}

describe('account language consistency — regression #280 (follow-up to #210)', () => {
  afterEach(async () => {
    await switchLocale('es')
    document.documentElement.dir = 'ltr'
    document.documentElement.lang = 'es'
    window.localStorage.removeItem('language')
    window.localStorage.removeItem('accountLanguage')
  })

  it('applies the account language via useAccountLanguage and settles the nav to it — no detector-language leftovers', async () => {
    await i18nReady
    // Detector/browser resolved 'en'; the account's saved language is 'es'.
    await switchLocale('en')

    const { rerender } = render(<AccountLanguageHarness settings={null} />)

    // Before settings resolve, the nav is still in the detector language —
    // this is expected because the AppLayout first-paint gate (tested
    // separately in AppLayout.test.tsx) is what hides this frame in
    // production; this harness only exercises the hook + translation seam.
    expect(screen.getByTestId('nav-dashboard')).toHaveTextContent(NAV_EN.dashboard)

    // Settings resolve asynchronously (simulates the fetchSettings API call
    // completing after the nav is already mounted).
    await act(async () => {
      rerender(<AccountLanguageHarness settings={makeSettings('es')} />)
      await Promise.resolve()
      await Promise.resolve()
    })

    // The account language must now win, consistently across every nav item.
    expect(screen.getByTestId('nav-dashboard')).toHaveTextContent(NAV_ES.dashboard)
    expect(screen.getByTestId('nav-patients')).toHaveTextContent(NAV_ES.patients)
    expect(screen.getByTestId('nav-logout')).toHaveTextContent(NAV_ES.logout)
    // No English leftovers mixed in with the Spanish result.
    expect(screen.getByTestId('nav-dashboard').textContent).not.toBe(NAV_EN.dashboard)
  })

  it('settles to Arabic (dir=rtl) when the account language is "ar" and the detector resolved "en"', async () => {
    await i18nReady
    await switchLocale('en')

    const { rerender } = render(<AccountLanguageHarness settings={null} />)
    expect(screen.getByTestId('nav-dashboard')).toHaveTextContent(NAV_EN.dashboard)

    await act(async () => {
      rerender(<AccountLanguageHarness settings={makeSettings('ar')} />)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(screen.getByTestId('nav-dashboard')).toHaveTextContent(NAV_AR.dashboard)
    expect(screen.getByTestId('nav-patients')).toHaveTextContent(NAV_AR.patients)
    expect(document.documentElement.dir).toBe('rtl')
    expect(document.documentElement.lang).toBe('ar')
  })

  it('once settled, all nav labels are from exactly one locale — no mixed detector+account values', async () => {
    await i18nReady
    await switchLocale('es')

    const { rerender } = render(<AccountLanguageHarness settings={null} />)

    await act(async () => {
      rerender(<AccountLanguageHarness settings={makeSettings('en')} />)
      await Promise.resolve()
      await Promise.resolve()
    })

    const dashboard = screen.getByTestId('nav-dashboard').textContent!
    const patients = screen.getByTestId('nav-patients').textContent!
    const logout = screen.getByTestId('nav-logout').textContent!

    const allEnglish =
      dashboard === NAV_EN.dashboard && patients === NAV_EN.patients && logout === NAV_EN.logout
    const allSpanish =
      dashboard === NAV_ES.dashboard && patients === NAV_ES.patients && logout === NAV_ES.logout

    expect(allEnglish || allSpanish).toBe(true)
    expect(allEnglish).toBe(true)
  })

  it('mirrors the resolved account language into localStorage so the next full page load starts pre-resolved, and writes the accountLanguage marker AppLayout\'s first-paint gate relies on', async () => {
    await i18nReady
    await switchLocale('es')
    window.localStorage.removeItem('language')
    window.localStorage.removeItem('accountLanguage')

    const { rerender } = render(<AccountLanguageHarness settings={null} />)

    // Before settings resolve, neither key has been written yet by this hook
    // (the LanguageDetector may still have its own `language` entry in a
    // real session, but this harness starts clean to isolate the hook).
    expect(window.localStorage.getItem('accountLanguage')).toBeNull()

    await act(async () => {
      rerender(<AccountLanguageHarness settings={makeSettings('en')} />)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(window.localStorage.getItem('language')).toBe('en')
    // accountLanguage (review fix cycle 1, task #280) is the marker
    // AppLayout's first-paint gate reads to distinguish "account settings
    // actually applied" from a mere detector-cached guess in `language`.
    expect(window.localStorage.getItem('accountLanguage')).toBe('en')
  })

  it('does not redundantly call changeLanguage when the account language already matches the current one (no-op update)', async () => {
    await i18nReady
    await switchLocale('es')

    const changeLanguageCalls: string[] = []
    const original = i18n.changeLanguage.bind(i18n)
    i18n.changeLanguage = ((lng?: string, cb?: (err: unknown, t: unknown) => void) => {
      if (lng) changeLanguageCalls.push(lng)
      return original(lng, cb)
    }) as typeof i18n.changeLanguage

    try {
      const { rerender } = render(<AccountLanguageHarness settings={makeSettings('es')} />)
      rerender(<AccountLanguageHarness settings={makeSettings('es')} />)

      expect(changeLanguageCalls).toEqual([])
      expect(screen.getByTestId('nav-dashboard')).toHaveTextContent(NAV_ES.dashboard)
    } finally {
      i18n.changeLanguage = original
    }
  })
})
