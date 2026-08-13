import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'

import es from './locales/es.json'
import en from './locales/en.json'
import ar from './locales/ar.json'

export const resources = {
  es: { translation: es },
  en: { translation: en },
  ar: { translation: ar },
} as const

export const languages = [
  { code: 'es', name: 'Español', nativeName: 'Español', dir: 'ltr' },
  { code: 'en', name: 'English', nativeName: 'English', dir: 'ltr' },
  { code: 'ar', name: 'Arabic', nativeName: 'العربية', dir: 'rtl' },
] as const

export type LanguageCode = (typeof languages)[number]['code']

export const defaultLanguage: LanguageCode = 'es'

// The product (app.alveodent.com) and the landing (alveodent.com) share the
// language preference via a parent-domain cookie. A `Domain=.alveodent.com`
// cookie is rejected by browsers when set from localhost, so fall back to a
// host-only cookie (cookieDomain undefined) outside that domain.
const { hostname, protocol } = window.location
const cookieDomain =
  hostname === 'alveodent.com' || hostname.endsWith('.alveodent.com') ? '.alveodent.com' : undefined

// Update document direction when language changes
const updateDocumentDirection = (lng: string) => {
  const language = languages.find((l) => l.code === lng)
  if (language) {
    document.documentElement.dir = language.dir
    document.documentElement.lang = lng
  }
}

export const i18nReady = i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: defaultLanguage,
    // Only resolve to languages we actually ship; anything else (e.g. an
    // unsupported browser locale) falls back to defaultLanguage.
    supportedLngs: languages.map((l) => l.code),
    // `load` only governs which translation resources get loaded (it makes
    // resolvedLanguage a base code); it does NOT touch the value the detector
    // caches into the cookie/localStorage. `convertDetectedLanguage` below is
    // what keeps those persisted values as base codes.
    load: 'languageOnly',
    defaultNS: 'translation',
    interpolation: {
      escapeValue: false, // React already escapes values
    },
    detection: {
      // Precedence: localStorage before the shared cookie. useAccountLanguage
      // (#280) mirrors the authenticated tenant's saved language into
      // localStorage on every settings load, and AppLayout's first-paint gate
      // relies on that mirror being authoritative for returning sessions — if
      // the cookie won here, a language picked on the landing page by a
      // different session/device could silently override the account's
      // saved preference and reintroduce the wrong-language first paint #280
      // fixed. Putting localStorage first preserves that invariant.
      //
      // This means landing (alveodent.com) -> app cross-subdomain sharing via
      // the cookie only takes effect while localStorage has no value yet —
      // i.e. a fresh browser, first login, or an anonymous/pre-account-load
      // visit. Once useAccountLanguage mirrors the account language into
      // localStorage, it takes over on every later load and the shared
      // cookie is effectively ignored for that session. This is a deliberate
      // trade-off (account language must win once known), not an oversight.
      order: ['localStorage', 'cookie', 'navigator'],
      // Still cache into the cookie so app -> landing sharing works when the
      // user changes language from within the app.
      caches: ['cookie', 'localStorage'],
      lookupCookie: 'language',
      cookieDomain,
      cookieMinutes: 60 * 24 * 365,
      cookieOptions: {
        path: '/',
        sameSite: 'lax',
        secure: protocol === 'https:',
      },
      lookupLocalStorage: 'language',
      // Strip region ('en-US' -> 'en') from whatever value gets detected
      // (cookie, localStorage, or navigator) before it is cached back out, so
      // the persisted cookie/localStorage value is always a base code and
      // cannot drift from apps/web's. Also makes i18n.language itself a base
      // code, which LanguageSelector.tsx's `value={i18n.language}` binding
      // depends on to match one of its <option> values.
      convertDetectedLanguage: (lng: string) => lng.split('-')[0],
    },
    // Ensure synchronous initialization when resources are bundled
    initImmediate: false,
  })
  .then(() => {
    // Set initial direction after i18n is fully initialized
    updateDocumentDirection(i18n.language)
  })

// Update document direction when language changes
i18n.on('languageChanged', updateDocumentDirection)

export default i18n
