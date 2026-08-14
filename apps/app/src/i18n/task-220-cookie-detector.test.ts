// @vitest-environment jsdom
/**
 * Task #220: apps/app now shares the language preference with apps/web via a
 * `.alveodent.com`-scoped cookie. This pins the detector config so the two
 * apps cannot silently drift apart on cookie name/domain/order — see the
 * mirror-image assertions in apps/web/src/i18n/index.test.ts.
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

describe('apps/app i18n cookie detector config (task #220)', () => {
  afterEach(() => {
    Object.defineProperty(window, 'location', {
      value: ORIGINAL_LOCATION,
      writable: true,
      configurable: true,
    })
    window.localStorage.clear()
    clearCookie()
    vi.resetModules()
  })

  // Review fix cycle 1 (PR #386, finding 1): localStorage must be checked
  // BEFORE the shared cookie, not after — see the precedence rationale
  // documented directly above `order` in ./index.ts. This is the inverse of
  // apps/web's order, deliberately: apps/web has no authenticated-account
  // language to protect, apps/app does (#280).
  it('checks localStorage before the shared cookie (inverse of apps/web) to protect the account-language mirror from #280', async () => {
    stubLocation('app.alveodent.com', 'https:')
    vi.resetModules()
    const { default: i18n } = await import('./index')
    const order = detectionOptions(i18n).order ?? []
    expect(order).toEqual(['localStorage', 'cookie', 'navigator'])
  })

  it('resolves from localStorage, not the cookie, when both are present (returning authenticated session)', async () => {
    stubLocation('app.alveodent.com', 'https:')
    window.localStorage.setItem('language', 'es')
    document.cookie = 'language=en; path=/'
    vi.resetModules()
    const { default: i18n, i18nReady } = await import('./index')
    await i18nReady
    expect(i18n.language).toBe('es')
  })

  it('falls back to the cookie when localStorage has no saved preference yet (first visit / no account resolved)', async () => {
    stubLocation('app.alveodent.com', 'https:')
    document.cookie = 'language=en; path=/'
    vi.resetModules()
    const { default: i18n, i18nReady } = await import('./index')
    await i18nReady
    expect(i18n.language).toBe('en')
  })

  it('caches back to cookie and localStorage on change, matching apps/web', async () => {
    stubLocation('app.alveodent.com', 'https:')
    vi.resetModules()
    const { default: i18n } = await import('./index')
    expect(detectionOptions(i18n).caches).toEqual(['cookie', 'localStorage'])
  })

  it('reads/writes the same cookie name ("language") as apps/web', async () => {
    stubLocation('app.alveodent.com', 'https:')
    vi.resetModules()
    const { default: i18n } = await import('./index')
    expect(detectionOptions(i18n).lookupCookie).toBe('language')
  })

  it('scopes the cookie to .alveodent.com on the app subdomain', async () => {
    stubLocation('app.alveodent.com', 'https:')
    vi.resetModules()
    const { default: i18n } = await import('./index')
    expect(detectionOptions(i18n).cookieDomain).toBe('.alveodent.com')
  })

  it('scopes the cookie to .alveodent.com on the landing apex domain too', async () => {
    stubLocation('alveodent.com', 'https:')
    vi.resetModules()
    const { default: i18n } = await import('./index')
    expect(detectionOptions(i18n).cookieDomain).toBe('.alveodent.com')
  })

  it('falls back to a host-only cookie on localhost (dev cannot set Domain=.alveodent.com)', async () => {
    stubLocation('localhost', 'http:')
    vi.resetModules()
    const { default: i18n } = await import('./index')
    expect(detectionOptions(i18n).cookieDomain).toBeUndefined()
  })

  it('marks the cookie secure only on https, matching apps/web', async () => {
    stubLocation('app.alveodent.com', 'https:')
    vi.resetModules()
    const { default: i18nHttps } = await import('./index')
    expect(detectionOptions(i18nHttps).cookieOptions?.secure).toBe(true)

    stubLocation('localhost', 'http:')
    vi.resetModules()
    const { default: i18nHttp } = await import('./index')
    expect(detectionOptions(i18nHttp).cookieOptions?.secure).toBe(false)
  })

  it('sets sameSite=lax and path=/ on the shared cookie', async () => {
    stubLocation('app.alveodent.com', 'https:')
    vi.resetModules()
    const { default: i18n } = await import('./index')
    expect(detectionOptions(i18n).cookieOptions?.sameSite).toBe('lax')
    expect(detectionOptions(i18n).cookieOptions?.path).toBe('/')
  })

  // Review fix cycle 1 (PR #386, finding 2): the detector caches whatever
  // value it detects, untouched by `load: 'languageOnly'` (that option only
  // affects resource loading). Without `convertDetectedLanguage`, a browser
  // reporting 'en-US' would persist 'en-US' into the cookie/localStorage,
  // which apps/web's <option> values (and this app's LanguageSelector) do
  // not match.
  it('strips the region from a detected cookie value ("en-US" -> "en"), matching apps/web', async () => {
    stubLocation('app.alveodent.com', 'https:')
    document.cookie = 'language=en-US; path=/'
    vi.resetModules()
    const { default: i18n, i18nReady } = await import('./index')
    await i18nReady
    expect(i18n.language).toBe('en')
    expect(i18n.resolvedLanguage).toBe('en')
  })
})
