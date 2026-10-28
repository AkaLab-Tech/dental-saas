import { describe, it, expect, beforeEach } from 'vitest'
import type { DetectorOptions } from 'i18next-browser-languagedetector'
import i18n, { languages, defaultLanguage, resources, i18nReady } from './index'

describe('i18n configuration', () => {
  beforeEach(() => {
    i18n.changeLanguage(defaultLanguage)
  })

  describe('languages', () => {
    it('should have Spanish, English and Arabic', () => {
      expect(languages).toHaveLength(3)
      expect(languages.map((l) => l.code)).toEqual(['es', 'en', 'ar'])
    })

    it('should have correct RTL direction for Arabic', () => {
      const arabic = languages.find((l) => l.code === 'ar')
      expect(arabic?.dir).toBe('rtl')
    })

    it('should have LTR direction for Spanish and English', () => {
      const spanish = languages.find((l) => l.code === 'es')
      const english = languages.find((l) => l.code === 'en')
      expect(spanish?.dir).toBe('ltr')
      expect(english?.dir).toBe('ltr')
    })
  })

  describe('translations', () => {
    it('should have translations for all languages', () => {
      expect(resources.es).toBeDefined()
      expect(resources.en).toBeDefined()
      expect(resources.ar).toBeDefined()
    })

    it('should have common translations', () => {
      expect(i18n.t('common.loading')).toBe('Cargando...')
      expect(i18n.t('common.save')).toBe('Guardar')
      expect(i18n.t('common.cancel')).toBe('Cancelar')
    })

    it('should switch languages correctly', () => {
      expect(i18n.t('appointments.title')).toBe('Citas')

      i18n.changeLanguage('en')
      expect(i18n.t('appointments.title')).toBe('Appointments')

      i18n.changeLanguage('ar')
      expect(i18n.t('appointments.title')).toBe('المواعيد')
    })

    it('should have navigation translations', () => {
      expect(i18n.t('nav.dashboard')).toBe('Panel de Control')
      expect(i18n.t('nav.appointments')).toBe('Citas')
      expect(i18n.t('nav.patients')).toBe('Pacientes')
    })
  })

  describe('defaultLanguage', () => {
    it('should be Spanish', () => {
      expect(defaultLanguage).toBe('es')
    })
  })

  describe('language resolution', () => {
    it('should only support the shipped languages', () => {
      expect(i18n.options.supportedLngs).toEqual(
        expect.arrayContaining(['es', 'en', 'ar'])
      )
    })

    it('should strip region from detected locales (languageOnly)', () => {
      expect(i18n.options.load).toBe('languageOnly')
    })

    it('should prefer the saved app preference over the browser language', () => {
      // localStorage (saved preference) must come before navigator so the
      // browser locale only applies on first visit.
      // i18next itself declares `detection` only as `object`; the shape with
      // `order` comes from the detector's `declare module 'i18next'`. That
      // augmentation lands on whichever i18next instance pnpm hoisted, and this
      // repo legitimately installs two (apps/web pins TypeScript ~5.6.2,
      // apps/app ~5.9.3, so the store keys one copy per peer version). When the
      // hoisted copy is not the one typing apps/app, the narrowing never reaches
      // here and reading `.order` is TS2339 — same bytes, green in one tree and
      // red in another. Casting to the detector's own exported type compiles
      // under either hoist, so it does not depend on install order.
      const order = (i18n.options.detection as DetectorOptions | undefined)?.order ?? []
      expect(order.indexOf('localStorage')).toBeLessThan(
        order.indexOf('navigator')
      )
    })

    it('should resolve to a supported base code after switching', () => {
      i18n.changeLanguage('en')
      expect(i18n.resolvedLanguage).toBe('en')
    })
  })

  // --- regression: task #210 — sidebar nav labels flicker between locale variants ---
  // Pre-fix: i18nReady was not exported; main.tsx rendered synchronously before the
  // init-chain Promise settled, so useTranslation() could re-render on 'initialized'.
  // Post-fix: i18nReady is the Promise returned by i18n.use(...).init(...).then(...)
  // and main.tsx gates createRoot().render() on it.
  describe('i18nReady', () => {
    it('is exported from the module — main.tsx can gate render on it', () => {
      // If this fails with pre-fix code, i18nReady is undefined (not exported)
      expect(i18nReady).toBeDefined()
    })

    it('is a thenable Promise so main.tsx can call .then() before rendering', () => {
      // A non-exported binding or a non-Promise would fail here
      expect(typeof (i18nReady as { then?: unknown }).then).toBe('function')
    })

    it('resolves only after i18n.isInitialized is true', async () => {
      await i18nReady
      expect(i18n.isInitialized).toBe(true)
    })

    it('resolves to a settled resolvedLanguage that is within supportedLngs', async () => {
      await i18nReady
      // resolvedLanguage must not be null/undefined — language detection settled
      expect(i18n.resolvedLanguage).toBeDefined()
      const supportedCodes = languages.map((l) => l.code) as string[]
      expect(supportedCodes).toContain(i18n.resolvedLanguage)
    })

    it('fires updateDocumentDirection before resolving — document.lang is a supported code', async () => {
      // The .then() chain in index.ts calls updateDocumentDirection(i18n.language);
      // awaiting i18nReady must mean that side-effect has already run.
      await i18nReady
      const supportedCodes = languages.map((l) => l.code) as string[]
      expect(supportedCodes).toContain(document.documentElement.lang)
    })

    it('document.dir is consistent with the resolved language after ready', async () => {
      await i18nReady
      const lang = document.documentElement.lang as 'es' | 'en' | 'ar'
      const expectedDir = languages.find((l) => l.code === lang)?.dir ?? 'ltr'
      expect(document.documentElement.dir).toBe(expectedDir)
    })

    it('supportedLngs contains exactly the three shipped locales and no other production codes', () => {
      // i18next always appends 'cimode' (its built-in debug locale) internally;
      // filter it out before asserting on the production set.
      const i18nextInternals = new Set(['cimode', 'dev'])
      const production = (i18n.options.supportedLngs as string[]).filter(
        (s) => typeof s === 'string' && !i18nextInternals.has(s),
      )
      expect(production).toHaveLength(3)
      expect(production).toContain('es')
      expect(production).toContain('en')
      expect(production).toContain('ar')
    })
  })
})
