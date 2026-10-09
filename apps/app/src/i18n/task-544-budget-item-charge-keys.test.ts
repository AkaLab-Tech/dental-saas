/**
 * i18n key-parity check for task #544 (an executed budget item creates a
 * charge). The three new `appointments.budgetItems.*` strings must exist as
 * non-empty strings in es, en and ar, differ per locale (catches a Spanish
 * string pasted into ar.json), and — because they are three different surfaces
 * (a label, a status line and a duplicate-cost hint) — be distinct from each
 * other within every locale.
 *
 * Follows task-524-paid-badge-charged-vs-covered-keys.test.ts.
 */
import { describe, it, expect } from 'vitest'
import es from './locales/es.json'
import en from './locales/en.json'
import ar from './locales/ar.json'

const locales = { es, en, ar } as const
type BudgetItems = Record<string, unknown>
const budgetItemsOf = (dict: unknown) =>
  (dict as { appointments: { budgetItems: BudgetItems } }).appointments.budgetItems

const NEW_KEYS = ['executedCharge', 'executedChargeStatus', 'executedChargeHint'] as const

describe('task #544 i18n key parity — appointments.budgetItems.executedCharge / executedChargeStatus / executedChargeHint', () => {
  describe.each(NEW_KEYS)('key "appointments.budgetItems.%s"', (key) => {
    it('exists as a non-empty string in es, en, and ar', () => {
      for (const [code, dict] of Object.entries(locales)) {
        const value = budgetItemsOf(dict)[key]
        expect(value, `${code}.json appointments.budgetItems.${key} is missing`).toBeTypeOf('string')
        expect(
          (value as string).trim().length,
          `${code}.json appointments.budgetItems.${key} is empty`
        ).toBeGreaterThan(0)
      }
    })

    it('has a distinct value per locale', () => {
      const values = Object.values(locales).map((dict) => budgetItemsOf(dict)[key])
      expect(new Set(values).size, `expected 3 distinct values, got ${JSON.stringify(values)}`).toBe(3)
    })
  })

  it.each(Object.entries(locales))(
    '%s: the three strings are three different values',
    (code, dict) => {
      const b = budgetItemsOf(dict)
      const values = NEW_KEYS.map((k) => b[k])
      expect(new Set(values).size, `${code}: ${JSON.stringify(values)}`).toBe(3)
    }
  )
})
