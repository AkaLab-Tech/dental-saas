/**
 * i18n key-parity check for task #524 (paid badge: "charged in this
 * consultation" vs "covered by an advance"). The three new `payment.*` labels
 * must exist as non-empty strings in es, en and ar, and — because the whole
 * point of the task is that they read differently — be distinct from each
 * other within every locale and differ per locale. The generic `payment.paid`
 * must stay, since the two-state surfaces still use it.
 *
 * Follows task-470-labwork-paid-managed-keys.test.ts.
 */
import { describe, it, expect } from 'vitest'
import es from './locales/es.json'
import en from './locales/en.json'
import ar from './locales/ar.json'

const locales = { es, en, ar } as const
type Payment = Record<string, unknown>
const paymentOf = (dict: unknown) => (dict as { payment: Payment }).payment

const NEW_KEYS = ['chargedHere', 'coveredByBalance', 'chargedAndCovered'] as const

describe('task #524 i18n key parity — payment.chargedHere / coveredByBalance / chargedAndCovered', () => {
  describe.each(NEW_KEYS)('key "payment.%s"', (key) => {
    it('exists as a non-empty string in es, en, and ar', () => {
      for (const [code, dict] of Object.entries(locales)) {
        const value = paymentOf(dict)[key]
        expect(value, `${code}.json payment.${key} is missing`).toBeTypeOf('string')
        expect((value as string).trim().length, `${code}.json payment.${key} is empty`).toBeGreaterThan(0)
      }
    })

    it('has a distinct value per locale', () => {
      const values = Object.values(locales).map((dict) => paymentOf(dict)[key])
      expect(new Set(values).size, `expected 3 distinct values, got ${JSON.stringify(values)}`).toBe(3)
    })
  })

  it.each(Object.entries(locales))(
    '%s: the three labels and the generic "paid" label are four different strings',
    (code, dict) => {
      const p = paymentOf(dict)
      const values = [p.paid, ...NEW_KEYS.map((k) => p[k])]
      expect(new Set(values).size, `${code}: ${JSON.stringify(values)}`).toBe(4)
    }
  )

  it('keeps the existing payment.paid / payment.pending labels', () => {
    expect(paymentOf(es).paid).toBe('Pagado')
    expect(paymentOf(en).paid).toBe('Paid')
    expect(paymentOf(es).pending).toBe('Pendiente')
    expect(paymentOf(en).pending).toBe('Pending')
  })
})
