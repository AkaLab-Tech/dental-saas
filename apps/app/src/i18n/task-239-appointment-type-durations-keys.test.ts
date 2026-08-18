/**
 * i18n key-parity check for task #239 (configurable appointment duration:
 * per-appointment-type duration editor in PreferencesForm). Verifies the
 * `settings.appointmentTypeDurations.*` keys exist, with a non-empty and
 * distinct string value, in all three shipped locale files (es/en/ar) — so
 * the editor's labels, placeholder, and duplicate-type error never silently
 * fall back to a raw key or an English string in another locale.
 *
 * Added during review-fix cycle 1: the review-fix wired up `duplicateType`
 * (it existed in all three locales but was previously referenced nowhere in
 * the component); this file covers the whole `appointmentTypeDurations`
 * block, per the repo's per-task i18n key-parity convention.
 */
import { describe, it, expect } from 'vitest'
import es from './locales/es.json'
import en from './locales/en.json'
import ar from './locales/ar.json'

const locales = { es, en, ar } as const

const NEW_KEYS = [
  'settings.appointmentTypeDurations.title',
  'settings.appointmentTypeDurations.description',
  'settings.appointmentTypeDurations.typePlaceholder',
  'settings.appointmentTypeDurations.durationColumn',
  'settings.appointmentTypeDurations.add',
  'settings.appointmentTypeDurations.remove',
  'settings.appointmentTypeDurations.duplicateType',
] as const

function getByPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, segment) => {
    if (acc && typeof acc === 'object' && segment in acc) {
      return (acc as Record<string, unknown>)[segment]
    }
    return undefined
  }, obj)
}

describe('task #239 i18n key parity', () => {
  describe.each(NEW_KEYS)('key "%s"', (key) => {
    it('exists as a non-empty string in es, en, and ar', () => {
      for (const [code, dict] of Object.entries(locales)) {
        const value = getByPath(dict, key)
        expect(value, `${code}.json is missing "${key}"`).toBeTypeOf('string')
        expect((value as string).length, `${code}.json has an empty value for "${key}"`).toBeGreaterThan(0)
      }
    })

    it('has a distinct value per locale (no locale silently reusing another’s string)', () => {
      const values = Object.values(locales).map((dict) => getByPath(dict, key) as string)
      const unique = new Set(values)
      expect(unique.size, `expected 3 distinct translations for "${key}", got ${JSON.stringify(values)}`).toBe(3)
    })
  })

  it('settings.appointmentTypeDurations has the same key structure across all three locales', () => {
    const keySets = Object.entries(locales).map(([code, dict]) => {
      const node = getByPath(dict, 'settings.appointmentTypeDurations') as Record<string, unknown>
      return { code, keys: Object.keys(node ?? {}).sort() }
    })
    const [reference, ...rest] = keySets
    for (const other of rest) {
      expect(
        other.keys,
        `settings.appointmentTypeDurations keys differ between ${reference.code} and ${other.code}`
      ).toEqual(reference.keys)
    }
  })
})
