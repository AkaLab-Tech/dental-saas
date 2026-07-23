import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { StrictMode } from 'react'
import { renderHook, act } from '@testing-library/react'
import i18n, { i18nReady } from '@/i18n'
import { useAccountLanguage } from './useAccountLanguage'
import type { TenantSettings } from '@/lib/settings-api'

// useAccountLanguage is the single global entry point (task #280, follow-up to
// #210) that applies the tenant's saved language preference — replacing the
// old per-page mount effect in PreferencesForm. These tests cover the hook in
// isolation: it must call i18n.changeLanguage only when the account's saved
// language differs from the current one (idempotent under StrictMode's
// double-invoked effects), and it must always mirror the value into
// localStorage so the next full page load's LanguageDetector resolves the
// same language synchronously.

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

describe('useAccountLanguage', () => {
  beforeEach(async () => {
    await i18nReady
    await act(async () => {
      await i18n.changeLanguage('es')
    })
    window.localStorage.removeItem('language')
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await act(async () => {
      await i18n.changeLanguage('es')
    })
    window.localStorage.removeItem('language')
  })

  it('does nothing when settings is null — no changeLanguage call, no localStorage write', () => {
    const changeLanguageSpy = vi.spyOn(i18n, 'changeLanguage')

    renderHook(() => useAccountLanguage(null))

    expect(changeLanguageSpy).not.toHaveBeenCalled()
    expect(window.localStorage.getItem('language')).toBeNull()
  })

  it('calls i18n.changeLanguage(settings.language) exactly once when it differs from the current language', () => {
    const changeLanguageSpy = vi.spyOn(i18n, 'changeLanguage')

    renderHook(() => useAccountLanguage(makeSettings('en')))

    expect(changeLanguageSpy).toHaveBeenCalledTimes(1)
    expect(changeLanguageSpy).toHaveBeenCalledWith('en')
  })

  it('mirrors settings.language into localStorage.language when it differs from the current language', () => {
    renderHook(() => useAccountLanguage(makeSettings('en')))

    expect(window.localStorage.getItem('language')).toBe('en')
  })

  it('is idempotent: does NOT call changeLanguage when settings.language already equals i18n.language', () => {
    // i18n.language is 'es' after the beforeEach reset — settings also 'es'
    const changeLanguageSpy = vi.spyOn(i18n, 'changeLanguage')

    renderHook(() => useAccountLanguage(makeSettings('es')))

    expect(changeLanguageSpy).not.toHaveBeenCalled()
  })

  it('still mirrors the value into localStorage even when no changeLanguage call is needed', () => {
    renderHook(() => useAccountLanguage(makeSettings('es')))

    expect(window.localStorage.getItem('language')).toBe('es')
  })

  it('guards against StrictMode double-invocation: mounting under React.StrictMode calls changeLanguage only once', () => {
    // React.StrictMode intentionally mounts -> cleans up -> remounts every
    // effect once in development to surface unsafe side effects. Both
    // invocations happen synchronously within the same commit, before the
    // changeLanguage promise chain has any chance to resolve i18n.language —
    // so a naive effect would call changeLanguage twice for one settings
    // value. The guard (settings.language !== i18n.language) must still hold
    // since i18n.language is unchanged between the two invocations, which
    // would make this assertion fail if the guard were removed.
    const changeLanguageSpy = vi.spyOn(i18n, 'changeLanguage')

    renderHook(() => useAccountLanguage(makeSettings('en')), {
      wrapper: StrictMode,
    })

    expect(changeLanguageSpy).toHaveBeenCalledTimes(1)
    expect(changeLanguageSpy).toHaveBeenCalledWith('en')
  })

  it('does not re-apply once i18n.language has actually settled to the account language (post-resolution idempotency)', async () => {
    const changeLanguageSpy = vi.spyOn(i18n, 'changeLanguage')

    await act(async () => {
      renderHook(() => useAccountLanguage(makeSettings('en')))
      // Flush the changeLanguage promise chain so i18n.language actually settles.
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(i18n.language).toBe('en')
    changeLanguageSpy.mockClear()

    // A subsequent mount (e.g. remounting AppLayout on navigation) with the
    // same account language must NOT call changeLanguage again.
    renderHook(() => useAccountLanguage(makeSettings('en')))
    expect(changeLanguageSpy).not.toHaveBeenCalled()
  })

  it('re-applies when settings.language changes across re-renders', async () => {
    const changeLanguageSpy = vi.spyOn(i18n, 'changeLanguage')

    const { rerender } = renderHook(
      ({ s }: { s: TenantSettings }) => useAccountLanguage(s),
      { initialProps: { s: makeSettings('en') } }
    )
    expect(changeLanguageSpy).toHaveBeenCalledWith('en')
    changeLanguageSpy.mockClear()

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    rerender({ s: makeSettings('ar') })
    expect(changeLanguageSpy).toHaveBeenCalledWith('ar')
    expect(window.localStorage.getItem('language')).toBe('ar')
  })
})
