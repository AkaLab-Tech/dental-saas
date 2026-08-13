import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

import es from "./locales/es.json";
import en from "./locales/en.json";
import ar from "./locales/ar.json";

export const resources = {
  es: { translation: es },
  en: { translation: en },
  ar: { translation: ar },
} as const;

export const languages = [
  { code: "es", name: "Español", nativeName: "Español", dir: "ltr" },
  { code: "en", name: "English", nativeName: "English", dir: "ltr" },
  { code: "ar", name: "Arabic", nativeName: "العربية", dir: "rtl" },
] as const;

export type LanguageCode = (typeof languages)[number]["code"];

export const defaultLanguage: LanguageCode = "es";

// The landing (alveodent.com) and the product (app.alveodent.com) share the
// language preference via a parent-domain cookie. A `Domain=.alveodent.com`
// cookie is rejected by browsers when set from localhost, so fall back to a
// host-only cookie (cookieDomain undefined) outside that domain.
const { hostname, protocol } = window.location;
const cookieDomain =
  hostname === "alveodent.com" || hostname.endsWith(".alveodent.com")
    ? ".alveodent.com"
    : undefined;

// i18next's `language` can retain the region the browser reported (e.g.
// 'en-US'); `resolvedLanguage` is the stripped code actually used for
// translations (see `load: 'languageOnly'` below), so use that for dir/lang.
const updateDocumentDirection = () => {
  const lng = i18n.resolvedLanguage ?? i18n.language;
  const language = languages.find((l) => l.code === lng);
  if (language) {
    document.documentElement.dir = language.dir;
    document.documentElement.lang = language.code;
  }
};

export const i18nReady = i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: defaultLanguage,
    supportedLngs: languages.map((l) => l.code),
    // `load` only governs which translation resources get loaded (it makes
    // resolvedLanguage a base code); it does NOT touch the value the detector
    // caches into the cookie/localStorage. `convertDetectedLanguage` below is
    // what keeps the persisted cookie value a base code matching apps/app's.
    load: "languageOnly",
    defaultNS: "translation",
    interpolation: {
      escapeValue: false, // React already escapes values
    },
    detection: {
      // The shared cookie takes priority so a preference set in apps/app wins;
      // localStorage and navigator are fallbacks for first visit / no cookie.
      order: ["cookie", "localStorage", "navigator"],
      caches: ["cookie", "localStorage"],
      lookupCookie: "language",
      cookieDomain,
      cookieMinutes: 60 * 24 * 365,
      cookieOptions: {
        path: "/",
        sameSite: "lax",
        secure: protocol === "https:",
      },
      lookupLocalStorage: "language",
      // Strip region ('en-US' -> 'en') from whatever value gets detected
      // (cookie, localStorage, or navigator) before it is cached back out, so
      // the persisted cookie value is always a base code and cannot drift
      // from apps/app's. Also makes i18n.language itself a base code so it
      // matches LanguageSelector.tsx's <option> values directly.
      convertDetectedLanguage: (lng: string) => lng.split("-")[0],
    },
    initImmediate: false,
  })
  .then(() => {
    updateDocumentDirection();
  });

i18n.on("languageChanged", updateDocumentDirection);

export default i18n;
