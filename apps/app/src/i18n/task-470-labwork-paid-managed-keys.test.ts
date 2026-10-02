/**
 * i18n key-parity check for task #470 (labwork `isPaid` owned by FIFO
 * payments). Verifies the two keys the labwork card renders in place of the
 * manual paid toggle exist as non-empty strings in es, en and ar, differ per
 * locale, and that the whole `labworks.*` tree keeps an identical leaf-key set.
 *
 * Follows task-243-labwork-status-keys.test.ts and
 * task-487-pending-shipment-copy.test.ts.
 */
import { describe, it, expect } from 'vitest'
import es from './locales/es.json'
import en from './locales/en.json'
import ar from './locales/ar.json'

const locales = { es, en, ar } as const

const NEW_KEYS = ['paidManagedByPayments', 'viewPatientPayments'] as const

function collectLeafPaths(obj: unknown, prefix = ''): string[] {
  if (obj !== null && typeof obj === 'object' && !Array.isArray(obj)) {
    return Object.entries(obj as Record<string, unknown>).flatMap(([key, value]) =>
      collectLeafPaths(value, prefix ? `${prefix}.${key}` : key)
    )
  }
  return [prefix]
}

describe('task #470 i18n key parity — labworks.paidManagedByPayments / viewPatientPayments', () => {
  describe.each(NEW_KEYS)('key "labworks.%s"', (key) => {
    it('exists as a non-empty string in es, en, and ar', () => {
      for (const [code, dict] of Object.entries(locales)) {
        const value = (dict as unknown as { labworks: Record<string, unknown> }).labworks[key]
        expect(value, `${code}.json labworks.${key} is missing`).toBeTypeOf('string')
        expect((value as string).trim().length, `${code}.json labworks.${key} is empty`).toBeGreaterThan(0)
      }
    })

    it('has a distinct value per locale', () => {
      const values = Object.values(locales).map(
        (dict) => (dict as unknown as { labworks: Record<string, string> }).labworks[key]
      )
      expect(new Set(values).size, `expected 3 distinct values, got ${JSON.stringify(values)}`).toBe(3)
    })
  })

  it('has an IDENTICAL leaf-key set under labworks.* across es, en, and ar', () => {
    const [reference, ...rest] = Object.entries(locales).map(([code, dict]) => ({
      code,
      keys: collectLeafPaths((dict as unknown as { labworks: unknown }).labworks).sort(),
    }))
    for (const other of rest) {
      expect(other.keys.filter((k) => !reference.keys.includes(k)), `${other.code} extra`).toEqual([])
      expect(reference.keys.filter((k) => !other.keys.includes(k)), `${other.code} missing`).toEqual([])
    }
  })
})
