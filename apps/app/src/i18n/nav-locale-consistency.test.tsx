/**
 * Regression tests for task #210 — sidebar nav labels flicker between locale
 * variants on navigation.
 *
 * Root cause: main.tsx called createRoot().render() synchronously after
 * `import './i18n'`, before the i18n init-chain Promise resolved.
 * react-i18next fires an 'initialized'/'languageChanged' event as a microtask
 * after the synchronous render, causing useTranslation() in AppLayout to
 * re-render and flip nav labels from the fallbackLng ('es') to the detected
 * locale — the visible flicker.
 *
 * Fix: i18nReady is now exported and main.tsx gates createRoot().render() inside
 * i18nReady.then(). These tests assert the observable outcomes that the fix
 * guarantees: after i18nReady resolves, all nav.* keys resolve against a single
 * settled locale with no fallback contamination.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { useTranslation } from 'react-i18next'
import i18n, { i18nReady } from './index'

// ---------------------------------------------------------------------------
// Minimal nav harness — mirrors the navItems labelKey pattern in AppLayout.tsx
// ---------------------------------------------------------------------------
function NavLabels() {
  const { t } = useTranslation()
  return (
    <ul>
      <li data-testid="nav-dashboard">{t('nav.dashboard')}</li>
      <li data-testid="nav-patients">{t('nav.patients')}</li>
      <li data-testid="nav-appointments">{t('nav.appointments')}</li>
      <li data-testid="nav-logout">{t('nav.logout')}</li>
    </ul>
  )
}

// ---------------------------------------------------------------------------
// Expected label values per locale (sourced from locale JSON files)
// ---------------------------------------------------------------------------
const NAV_EN = {
  dashboard: 'Dashboard',
  patients: 'Patients',
  appointments: 'Appointments',
  logout: 'Logout',
}
const NAV_ES = {
  dashboard: 'Panel de Control',
  patients: 'Pacientes',
  appointments: 'Citas',
  logout: 'Cerrar sesión',
}
const NAV_AR = {
  dashboard: 'لوحة التحكم',
  patients: 'المرضى',
  appointments: 'المواعيد',
  logout: 'تسجيل الخروج',
}

// ---------------------------------------------------------------------------
// Helper: switch locale AND flush the resulting React state updates so any
// mounted component that uses useTranslation() re-renders inside act().
// This prevents the "An update was not wrapped in act(...)" warning when
// afterEach resets the locale while a component is still mounted (Testing
// Library's cleanup afterEach runs after our own afterEach).
// ---------------------------------------------------------------------------
async function switchLocale(code: string) {
  await act(async () => {
    await i18n.changeLanguage(code)
  })
}

describe('nav label locale consistency — regression #210', () => {
  // Reset locale after each test. Wrapped in act() because Testing Library's
  // cleanup (unmount) runs in its own afterEach that may fire AFTER ours, so
  // the component can still be mounted when we change language here.
  afterEach(async () => {
    await switchLocale('es')
    // Restore LTR in case an Arabic test set dir=rtl
    document.documentElement.dir = 'ltr'
    document.documentElement.lang = 'es'
  })

  // -------------------------------------------------------------------------
  // English locale
  // -------------------------------------------------------------------------
  describe('English locale (en)', () => {
    it('all nav.* keys resolve to English — no Spanish fallback mixed in', async () => {
      await i18nReady
      await switchLocale('en')

      render(<NavLabels />)

      expect(screen.getByTestId('nav-dashboard')).toHaveTextContent(NAV_EN.dashboard)
      expect(screen.getByTestId('nav-patients')).toHaveTextContent(NAV_EN.patients)
      expect(screen.getByTestId('nav-appointments')).toHaveTextContent(NAV_EN.appointments)
      expect(screen.getByTestId('nav-logout')).toHaveTextContent(NAV_EN.logout)
    })

    it('Spanish fallback values are absent when locale is en', async () => {
      // These are the exact values that flickered in the pre-fix first render
      await i18nReady
      await switchLocale('en')

      render(<NavLabels />)

      expect(screen.getByTestId('nav-dashboard').textContent).not.toBe(NAV_ES.dashboard)
      expect(screen.getByTestId('nav-patients').textContent).not.toBe(NAV_ES.patients)
      expect(screen.getByTestId('nav-appointments').textContent).not.toBe(NAV_ES.appointments)
      expect(screen.getByTestId('nav-logout').textContent).not.toBe(NAV_ES.logout)
    })

    it('nav labels stay English after microtasks settle — no re-render flips locale', async () => {
      // Pre-fix: after the first render, the 'initialized'/'languageChanged' event
      // fired as a microtask and caused useTranslation() to re-render with the
      // detected locale, flipping labels. Post-fix, i18nReady is awaited first,
      // so the initialized event has already fired and no second render occurs.
      await i18nReady
      await switchLocale('en')

      render(<NavLabels />)

      // Drain all pending microtasks (initialized event handlers, queued updates)
      await act(async () => {})

      expect(screen.getByTestId('nav-dashboard')).toHaveTextContent(NAV_EN.dashboard)
      expect(screen.getByTestId('nav-logout')).toHaveTextContent(NAV_EN.logout)
    })
  })

  // -------------------------------------------------------------------------
  // Spanish locale
  // -------------------------------------------------------------------------
  describe('Spanish locale (es)', () => {
    it('all nav.* keys resolve to Spanish', async () => {
      await i18nReady
      await switchLocale('es')

      render(<NavLabels />)

      expect(screen.getByTestId('nav-dashboard')).toHaveTextContent(NAV_ES.dashboard)
      expect(screen.getByTestId('nav-patients')).toHaveTextContent(NAV_ES.patients)
      expect(screen.getByTestId('nav-appointments')).toHaveTextContent(NAV_ES.appointments)
      expect(screen.getByTestId('nav-logout')).toHaveTextContent(NAV_ES.logout)
    })
  })

  // -------------------------------------------------------------------------
  // Arabic locale — also verifies document RTL direction
  // -------------------------------------------------------------------------
  describe('Arabic locale (ar)', () => {
    it('all nav.* keys resolve to Arabic', async () => {
      await i18nReady
      await switchLocale('ar')

      render(<NavLabels />)

      expect(screen.getByTestId('nav-dashboard')).toHaveTextContent(NAV_AR.dashboard)
      expect(screen.getByTestId('nav-patients')).toHaveTextContent(NAV_AR.patients)
      expect(screen.getByTestId('nav-appointments')).toHaveTextContent(NAV_AR.appointments)
      expect(screen.getByTestId('nav-logout')).toHaveTextContent(NAV_AR.logout)
    })

    it('document.dir is rtl and document.lang is ar after switching to Arabic', async () => {
      // updateDocumentDirection is wired to the languageChanged event in index.ts.
      // Switching to 'ar' must produce dir=rtl immediately — before any render.
      await i18nReady
      await switchLocale('ar')

      expect(document.documentElement.dir).toBe('rtl')
      expect(document.documentElement.lang).toBe('ar')
    })

    it('rendered Arabic nav labels and document.dir=rtl are in sync', async () => {
      await i18nReady
      await switchLocale('ar')

      render(<NavLabels />)

      expect(screen.getByTestId('nav-dashboard')).toHaveTextContent(NAV_AR.dashboard)
      // Both translations AND document direction must reflect Arabic simultaneously
      expect(document.documentElement.dir).toBe('rtl')
    })
  })

  // -------------------------------------------------------------------------
  // Locale consistency invariant — the core regression guard
  // -------------------------------------------------------------------------
  describe('single-locale invariant', () => {
    it('all nav labels are from exactly one locale — no mixed fallback+detected values (en)', async () => {
      // The pre-fix bug produced mixed values, e.g.:
      //   nav-dashboard = "Panel de Control"  (es, from first synchronous render)
      //   nav-logout    = "Logout"             (en, from re-render after initialized event)
      // Post-fix: i18nReady is awaited, so the initialized event has already fired
      // and only ONE render ever happens — all labels from the same locale.
      await i18nReady
      await switchLocale('en')

      render(<NavLabels />)

      // Drain all pending microtasks so any potential re-render has finished
      await act(async () => {})

      const dashboard = screen.getByTestId('nav-dashboard').textContent!
      const patients = screen.getByTestId('nav-patients').textContent!
      const appointments = screen.getByTestId('nav-appointments').textContent!
      const logout = screen.getByTestId('nav-logout').textContent!

      const allEnglish =
        dashboard === NAV_EN.dashboard &&
        patients === NAV_EN.patients &&
        appointments === NAV_EN.appointments &&
        logout === NAV_EN.logout

      const allSpanish =
        dashboard === NAV_ES.dashboard &&
        patients === NAV_ES.patients &&
        appointments === NAV_ES.appointments &&
        logout === NAV_ES.logout

      // All labels must be from the same locale — mixed values indicate the flicker bug
      expect(allEnglish || allSpanish).toBe(true)
      // With i18n.language = 'en', the result must be entirely English
      expect(allEnglish).toBe(true)
    })
  })
})
