/**
 * i18n key-parity check for task #391 (cancelling an appointment with a
 * recorded consultation payment now warns the operator before converting it
 * to credit). Verifies the new `payments.cancelWithRecordedPayment` key
 * exists, with a non-empty, distinct, `{{amount}}`-interpolated string
 * value, in all three shipped locale files (es/en/ar) — so the new warning
 * paragraph in PatientAppointmentsSection/DoctorAppointmentsSection never
 * silently falls back to a raw key, an English string in another locale, or
 * a string missing the interpolation placeholder.
 */
import { describe, it, expect } from 'vitest'
import es from './locales/es.json'
import en from './locales/en.json'
import ar from './locales/ar.json'

const locales = { es, en, ar } as const

// Key added for task #391, per the implementer's diff to locales/*.json
const NEW_KEY = 'payments.cancelWithRecordedPayment'

function getByPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, segment) => {
    if (acc && typeof acc === 'object' && segment in acc) {
      return (acc as Record<string, unknown>)[segment]
    }
    return undefined
  }, obj)
}

describe('task #391 i18n key parity', () => {
  it('exists as a non-empty string in es, en, and ar', () => {
    for (const [code, dict] of Object.entries(locales)) {
      const value = getByPath(dict, NEW_KEY)
      expect(value, `${code}.json is missing "${NEW_KEY}"`).toBeTypeOf('string')
      expect((value as string).length, `${code}.json has an empty value for "${NEW_KEY}"`).toBeGreaterThan(0)
    }
  })

  it('has a distinct value per locale (no locale silently reusing another’s string)', () => {
    const values = Object.values(locales).map((dict) => getByPath(dict, NEW_KEY) as string)
    const unique = new Set(values)
    expect(unique.size, `expected 3 distinct translations for "${NEW_KEY}", got ${JSON.stringify(values)}`).toBe(3)
  })

  it('carries the {{amount}} interpolation placeholder in every locale', () => {
    for (const [code, dict] of Object.entries(locales)) {
      const value = getByPath(dict, NEW_KEY) as string
      expect(value, `${code}.json's "${NEW_KEY}" is missing the {{amount}} placeholder`).toContain('{{amount}}')
    }
  })

  it('sits alongside reverseConsultationConfirm under payments in every locale (same parent block)', () => {
    for (const [code, dict] of Object.entries(locales)) {
      const node = getByPath(dict, 'payments') as Record<string, unknown>
      expect(node, `${code}.json is missing the payments block`).toBeTruthy()
      expect(node.reverseConsultationConfirm, `${code}.json is missing payments.reverseConsultationConfirm`).toBeTypeOf(
        'string'
      )
      expect(node.cancelWithRecordedPayment, `${code}.json is missing payments.cancelWithRecordedPayment`).toBeTypeOf(
        'string'
      )
    }
  })
})
