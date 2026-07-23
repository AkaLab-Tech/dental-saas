import { useEffect } from 'react'
import i18n, { type LanguageCode } from '@/i18n'
import type { TenantSettings } from '@/lib/settings-api'

/**
 * Single source of truth for applying the tenant's saved language preference.
 * Runs once `settings` resolve for any authenticated session (not just the
 * Settings page). Mirrors the value into localStorage so the synchronous
 * LanguageDetector picks the right language on the *next* full page load,
 * closing the gap where the account language differs from the
 * detector-resolved one (#280, follow-up to #210).
 *
 * Also writes a dedicated `accountLanguage` marker, written ONLY here (never
 * by the i18next LanguageDetector, which caches its own browser-detected
 * guess into `localStorage.language` on every init). AppLayout's first-paint
 * gate reads this marker — not `localStorage.language` — to tell whether the
 * ACCOUNT language has actually been resolved before, as opposed to merely
 * having a detector guess cached.
 */
export function useAccountLanguage(settings: TenantSettings | null) {
  useEffect(() => {
    if (!settings) return

    if (settings.language !== i18n.language) {
      i18n.changeLanguage(settings.language as LanguageCode)
    }
    window.localStorage.setItem('language', settings.language)
    window.localStorage.setItem('accountLanguage', settings.language)
  }, [settings])
}
