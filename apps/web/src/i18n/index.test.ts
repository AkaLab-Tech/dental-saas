// @vitest-environment jsdom
/**
 * Task #220: apps/web i18n bootstrap.
 *
 * The riskiest piece of this change is the `cookieDomain` derivation — it
 * reads `window.location.hostname` at module-evaluation time, so each case
 * below stubs `window.location` and re-imports a fresh module instance via
 * `vi.resetModules()`. This is also the seam apps/app relies on to share the
 * `language` cookie, so drift here silently breaks cross-app persistence.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import type { i18n as I18n } from 'i18next'
import type { DetectorOptions } from 'i18next-browser-languagedetector'

function stubLocation(hostname: string, protocol: 'http:' | 'https:') {
  Object.defineProperty(window, 'location', {
    value: { hostname, protocol, href: `${protocol}//${hostname}/` },
    writable: true,
    configurable: true,
  })
}

const ORIGINAL_LOCATION = window.location

// i18next's InitOptions types `detection` as a loose plugin-agnostic object;
// this narrows it back to the browser detector's actual shape for assertions.
function detectionOptions(i18n: I18n): DetectorOptions {
  return i18n.options.detection as DetectorOptions
}

function clearCookie() {
  document.cookie = 'language=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/'
}

describe('apps/web i18n bootstrap', () => {
  afterEach(() => {
    Object.defineProperty(window, 'location', {
      value: ORIGINAL_LOCATION,
      writable: true,
      configurable: true,
    })
    clearCookie()
    vi.resetModules()
  })

  describe('cookie domain derivation', () => {
    it('scopes the cookie to .alveodent.com on the apex domain', async () => {
      stubLocation('alveodent.com', 'https:')
      vi.resetModules()
      const { default: i18n } = await import('./index')
      expect(detectionOptions(i18n).cookieDomain).toBe('.alveodent.com')
    })

    it('scopes the cookie to .alveodent.com on the app subdomain (the sharing seam)', async () => {
      stubLocation('app.alveodent.com', 'https:')
      vi.resetModules()
      const { default: i18n } = await import('./index')
      expect(detectionOptions(i18n).cookieDomain).toBe('.alveodent.com')
    })

    it('falls back to a host-only cookie (undefined domain) on localhost', async () => {
      stubLocation('localhost', 'http:')
      vi.resetModules()
      const { default: i18n } = await import('./index')
      expect(detectionOptions(i18n).cookieDomain).toBeUndefined()
    })

    it('does not scope to .alveodent.com for an unrelated domain (no substring match)', async () => {
      stubLocation('notalveodent.com', 'https:')
      vi.resetModules()
      const { default: i18n } = await import('./index')
      expect(detectionOptions(i18n).cookieDomain).toBeUndefined()
    })

    it('marks the cookie secure only on https', async () => {
      stubLocation('alveodent.com', 'https:')
      vi.resetModules()
      const { default: i18nHttps } = await import('./index')
      expect(detectionOptions(i18nHttps).cookieOptions?.secure).toBe(true)
    })

    it('marks the cookie non-secure on http (local dev)', async () => {
      stubLocation('localhost', 'http:')
      vi.resetModules()
      const { default: i18nHttp } = await import('./index')
      expect(detectionOptions(i18nHttp).cookieOptions?.secure).toBe(false)
    })

    it('uses the same cookie name ("language") apps/app reads and writes', async () => {
      stubLocation('alveodent.com', 'https:')
      vi.resetModules()
      const { default: i18n } = await import('./index')
      expect(detectionOptions(i18n).lookupCookie).toBe('language')
    })

    it('checks the cookie before localStorage/navigator so a preference set on apps/app wins', async () => {
      stubLocation('alveodent.com', 'https:')
      vi.resetModules()
      const { default: i18n } = await import('./index')
      const order = detectionOptions(i18n).order ?? []
      expect(order[0]).toBe('cookie')
      expect(order.indexOf('cookie')).toBeLessThan(order.indexOf('localStorage'))
      expect(order.indexOf('localStorage')).toBeLessThan(order.indexOf('navigator'))
    })

    // Review fix cycle 1 (PR #386, finding 2): the detector caches whatever
    // value it detects, untouched by `load: 'languageOnly'` (that option only
    // affects resource loading). Without `convertDetectedLanguage`, a browser
    // reporting 'en-US' would persist 'en-US' into the cookie, which
    // LanguageSelector.tsx's <option> values (and apps/app's) do not match.
    it('strips the region from a detected cookie value ("en-US" -> "en"), matching apps/app', async () => {
      stubLocation('alveodent.com', 'https:')
      document.cookie = 'language=en-US; path=/'
      vi.resetModules()
      const { default: i18n, i18nReady } = await import('./index')
      await i18nReady
      expect(i18n.language).toBe('en')
      expect(i18n.resolvedLanguage).toBe('en')
    })
  })

  describe('languages export', () => {
    it('ships exactly es, en, ar', async () => {
      stubLocation('localhost', 'http:')
      vi.resetModules()
      const { languages } = await import('./index')
      expect(languages.map((l) => l.code)).toEqual(['es', 'en', 'ar'])
    })

    it('marks ar as rtl and es/en as ltr', async () => {
      stubLocation('localhost', 'http:')
      vi.resetModules()
      const { languages } = await import('./index')
      expect(languages.find((l) => l.code === 'ar')?.dir).toBe('rtl')
      expect(languages.find((l) => l.code === 'es')?.dir).toBe('ltr')
      expect(languages.find((l) => l.code === 'en')?.dir).toBe('ltr')
    })
  })

  describe('resources', () => {
    it('bundles translation resources for all three locales', async () => {
      stubLocation('localhost', 'http:')
      vi.resetModules()
      const { resources } = await import('./index')
      expect(resources.es.translation.hero.titleHighlight).toBe('inteligente')
      expect(resources.en.translation.hero.titleHighlight).toBe('smartly')
      expect(resources.ar.translation.hero.titleHighlight).toBe('ذكية')
    })
  })

  describe('i18nReady', () => {
    it('resolves once i18next has initialized', async () => {
      stubLocation('localhost', 'http:')
      vi.resetModules()
      const { i18nReady, default: i18n } = await import('./index')
      await i18nReady
      expect(i18n.isInitialized).toBe(true)
    })
  })

  describe('document direction (RTL)', () => {
    it('sets dir=rtl and lang=ar when ar is selected', async () => {
      stubLocation('localhost', 'http:')
      vi.resetModules()
      const { default: i18n, i18nReady } = await import('./index')
      await i18nReady
      await i18n.changeLanguage('ar')
      expect(document.documentElement.dir).toBe('rtl')
      expect(document.documentElement.lang).toBe('ar')
    })

    it('sets dir=ltr and lang=en when en is selected', async () => {
      stubLocation('localhost', 'http:')
      vi.resetModules()
      const { default: i18n, i18nReady } = await import('./index')
      await i18nReady
      await i18n.changeLanguage('en')
      expect(document.documentElement.dir).toBe('ltr')
      expect(document.documentElement.lang).toBe('en')
    })

    it('sets dir=ltr and lang=es when es is selected', async () => {
      stubLocation('localhost', 'http:')
      vi.resetModules()
      const { default: i18n, i18nReady } = await import('./index')
      await i18nReady
      await i18n.changeLanguage('es')
      expect(document.documentElement.dir).toBe('ltr')
      expect(document.documentElement.lang).toBe('es')
    })

    // Regression guard for the implementer's en-US fix: i18n.language can keep
    // a region suffix even with load: 'languageOnly'; updateDocumentDirection
    // must key off resolvedLanguage, not language, or this stays ltr/en-US.
    it('resolves dir/lang from resolvedLanguage, not the raw regional language code', async () => {
      stubLocation('localhost', 'http:')
      vi.resetModules()
      const { default: i18n, i18nReady } = await import('./index')
      await i18nReady
      await i18n.changeLanguage('en-US')
      expect(i18n.resolvedLanguage).toBe('en')
      expect(document.documentElement.lang).toBe('en')
      expect(document.documentElement.dir).toBe('ltr')
    })
  })
})
