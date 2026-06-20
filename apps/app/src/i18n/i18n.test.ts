import { describe, it, expect, beforeEach } from 'vitest'
import i18n, { languages, defaultLanguage, resources } from './index'

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
      const order = i18n.options.detection?.order ?? []
      expect(order.indexOf('localStorage')).toBeLessThan(
        order.indexOf('navigator')
      )
    })

    it('should resolve to a supported base code after switching', () => {
      i18n.changeLanguage('en')
      expect(i18n.resolvedLanguage).toBe('en')
    })
  })
})
