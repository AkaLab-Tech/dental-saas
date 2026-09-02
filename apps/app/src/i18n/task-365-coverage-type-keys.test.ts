/**
 * i18n key-parity check for task #365 (patient profile: particular vs
 * convenio/insurance-agreement coverage type). Verifies the new
 * `patients.form.{coverageType,particular,convenio,convenioName}` keys exist,
 * with a non-empty and distinct string value, in all three shipped locale
 * files (es/en/ar) — so the coverage-type select, its options, and the
 * PatientDetailPage coverage-status row never silently fall back to a raw
 * key or an English string in another locale.
 */
import { describe, it, expect } from 'vitest'
import es from './locales/es.json'
import en from './locales/en.json'
import ar from './locales/ar.json'

const locales = { es, en, ar } as const

const NEW_KEYS = [
  'patients.form.coverageType',
  'patients.form.particular',
  'patients.form.convenio',
  'patients.form.convenioName',
] as const

function getByPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, segment) => {
    if (acc && typeof acc === 'object' && segment in acc) {
      return (acc as Record<string, unknown>)[segment]
    }
    return undefined
  }, obj)
}

describe('task #365 i18n key parity', () => {
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

  it('patients.form has the same key structure across all three locales', () => {
    const sections = ['patients.form'] as const
    for (const section of sections) {
      const keySets = Object.entries(locales).map(([code, dict]) => {
        const node = getByPath(dict, section) as Record<string, unknown>
        return { code, keys: Object.keys(node ?? {}).sort() }
      })
      const [reference, ...rest] = keySets
      for (const other of rest) {
        expect(other.keys, `${section} keys differ between ${reference.code} and ${other.code}`).toEqual(
          reference.keys
        )
      }
    }
  })
})
