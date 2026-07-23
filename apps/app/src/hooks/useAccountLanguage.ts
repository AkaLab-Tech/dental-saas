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
 */
export function useAccountLanguage(settings: TenantSettings | null) {
  useEffect(() => {
    if (!settings) return

    if (settings.language !== i18n.language) {
      i18n.changeLanguage(settings.language as LanguageCode)
    }
    window.localStorage.setItem('language', settings.language)
  }, [settings])
}
