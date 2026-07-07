/**
 * i18n key-parity check for SPIKE #213 (patient/doctor list-view POCs).
 * Verifies every key the spike introduced exists, with a non-empty string
 * value, in all three shipped locale files (es/en/ar) — so a POC never
 * silently falls back to a raw key or an English string in another locale.
 *
 * Not a general-purpose i18n completeness test (the project has none yet);
 * scoped to the keys this spike added, per the tester's charter for #213.
 */
import { describe, it, expect } from 'vitest'
import es from './locales/es.json'
import en from './locales/en.json'
import ar from './locales/ar.json'

const locales = { es, en, ar } as const

// Keys added for SPIKE #213, per the implementer's diff to locales/*.json
const NEW_KEYS = [
  'common.actions',
  'common.restore',
  'patients.list.name',
  'patients.list.genderAge',
  'patients.list.contact',
  'patients.list.viewRecord',
  'doctors.list.name',
  'doctors.list.contact',
  'doctors.list.workingDays',
  'doctors.list.viewRecord',
] as const

function getByPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, segment) => {
    if (acc && typeof acc === 'object' && segment in acc) {
      return (acc as Record<string, unknown>)[segment]
    }
    return undefined
  }, obj)
}

describe('SPIKE #213 i18n key parity', () => {
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
      // es/en/ar happen to differ for every key this spike added (no shared
      // cognates like "email"); a repeat strongly suggests a copy-paste miss.
      const unique = new Set(values)
      expect(unique.size, `expected 3 distinct translations for "${key}", got ${JSON.stringify(values)}`).toBe(3)
    })
  })

  it('patients.list and doctors.list have the same key structure across all three locales', () => {
    const sections = ['patients.list', 'doctors.list'] as const
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
