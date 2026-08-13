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
    // Strip region from detected locales ('en-US' -> 'en') so resolvedLanguage
    // is always one of our base codes and non-React consumers stay in sync.
    load: 'languageOnly',
    defaultNS: 'translation',
    interpolation: {
      escapeValue: false, // React already escapes values
    },
    detection: {
      // The shared cookie takes priority so a preference set on the landing
      // page wins; localStorage and navigator are fallbacks.
      order: ['cookie', 'localStorage', 'navigator'],
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
