/**
 * i18n key-parity check for task #384 (view/reverse consultation payments).
 * Verifies the new `payments.consultationPayment`, `payments.reverseConsultationPayment`,
 * and `payments.reverseConsultationConfirm` keys exist, with a non-empty and
 * distinct string value, in all three shipped locale files (es/en/ar) — so the
 * "Pago en consulta" line, its kebab-menu reversal action, and its
 * confirmation dialog never silently fall back to a raw key or an English
 * string in another locale.
 */
import { describe, it, expect } from 'vitest'
import es from './locales/es.json'
import en from './locales/en.json'
import ar from './locales/ar.json'

const locales = { es, en, ar } as const

const NEW_KEYS = [
  'payments.consultationPayment',
  'payments.reverseConsultationPayment',
  'payments.reverseConsultationConfirm',
] as const

function getByPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, segment) => {
    if (acc && typeof acc === 'object' && segment in acc) {
      return (acc as Record<string, unknown>)[segment]
    }
    return undefined
  }, obj)
}

describe('task #384 i18n key parity', () => {
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

  it('the reversal confirm string is distinct from the existing Entregas-deletion confirm string', () => {
    // #381 scoped Entregas to advances only; the new consultation-payment
    // reversal must carry its own wording (payments.reverseConsultationConfirm),
    // not silently reuse whatever confirm copy Entregas' delete action uses.
    for (const [code, dict] of Object.entries(locales)) {
      const reverseConfirm = getByPath(dict, 'payments.reverseConsultationConfirm') as string
      const deleteConfirm = getByPath(dict, 'payments.deleteConfirm') as string | undefined
      if (deleteConfirm !== undefined) {
        expect(reverseConfirm, `${code}.json reuses payments.deleteConfirm wording`).not.toBe(deleteConfirm)
      }
    }
  })

  it('payments has the same key structure across all three locales', () => {
    const sections = ['payments'] as const
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
