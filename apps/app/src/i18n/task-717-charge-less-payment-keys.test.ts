/**
 * i18n key-parity check for task #717 (warn when a payment is typed on a visit
 * with no charge of its own). `appointments.form.paidWithoutChargeWarning` must
 * exist as a non-empty string in es, en and ar, with three distinct values
 * (catches a Spanish string pasted into ar.json), and must differ from the
 * neighbouring `paidAmountHint` it replaces in the same slot.
 *
 * Follows task-544-budget-item-charge-keys.test.ts.
 */
import { describe, it, expect } from 'vitest'
import es from './locales/es.json'
import en from './locales/en.json'
import ar from './locales/ar.json'

const locales = { es, en, ar } as const
const formOf = (dict: unknown) =>
  (dict as { appointments: { form: Record<string, unknown> } }).appointments.form

const KEY = 'paidWithoutChargeWarning'

describe(`task #717 i18n key parity — appointments.form.${KEY}`, () => {
  it('exists as a non-empty string in es, en, and ar', () => {
    for (const [code, dict] of Object.entries(locales)) {
      const value = formOf(dict)[KEY]
      expect(value, `${code}.json appointments.form.${KEY} is missing`).toBeTypeOf('string')
      expect((value as string).trim().length, `${code}.json ${KEY} is empty`).toBeGreaterThan(0)
    }
  })

  it('has a distinct value per locale', () => {
    const values = Object.values(locales).map((dict) => formOf(dict)[KEY])
    expect(new Set(values).size, `expected 3 distinct values, got ${JSON.stringify(values)}`).toBe(3)
  })

  it.each(Object.entries(locales))(
    '%s: differs from the paidAmountHint it replaces',
    (code, dict) => {
      expect(formOf(dict)[KEY], code).not.toBe(formOf(dict).paidAmountHint)
    }
  )
})
