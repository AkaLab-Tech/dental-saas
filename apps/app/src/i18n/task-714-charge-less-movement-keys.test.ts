/**
 * i18n guard for task #714: the payment-movements ledger labels a RECEIVED row
 * whose appointment had no charge of its own. Key: `payments.movements.chargeLess`.
 *
 *  - G11: resolves to a non-empty string in es, en and ar (one assertion per
 *    locale), three distinct values, and the key count of `payments.movements`
 *    is asserted separately (a content test cannot count documents).
 *  - G12: describes the SAME condition as #717's
 *    `appointments.form.paidWithoutChargeWarning` ("this visit has no charge of
 *    its own"), but unlike #717 it names no destination for the money — the
 *    ledger row does not know where the money went.
 *
 * Follows task-717-charge-less-payment-keys.test.ts.
 */
import { describe, it, expect } from 'vitest'
import es from './locales/es.json'
import en from './locales/en.json'
import ar from './locales/ar.json'

const locales = { es, en, ar } as const
type Code = keyof typeof locales

const movementsOf = (dict: unknown) =>
  (dict as { payments: { movements: Record<string, unknown> } }).payments.movements
const warningOf = (dict: unknown) =>
  (dict as { appointments: { form: Record<string, string> } }).appointments.form
    .paidWithoutChargeWarning

const KEY = 'chargeLess'
// subtitle, empty, dateFrom, dateTo, chargeLess, types, originAppointmentCancelled, originAppointment
const EXPECTED_MOVEMENTS_KEY_COUNT = 8

// The phrase both strings use for "a charge of its own", per language.
const SHARED_CONDITION: Record<Code, string> = {
  es: 'cobro propio',
  en: 'charge of its own',
  ar: 'مبلغ خاص بها',
}

// Words that would name where the money went (credit, pool, paying another
// visit). #717's warning legitimately says these; this label must not.
const DESTINATION_WORDS: Record<Code, string[]> = {
  es: ['saldo', 'crédito', 'credito', 'a favor', 'queda', 'paga', 'pagó', 'pozo', 'otra'],
  en: ['credit', 'balance', 'stays', 'pays', 'paid', 'pool', 'applied', 'another', 'other'],
  ar: ['رصيد', 'يسدد', 'يبقى', 'أخرى', 'اخرى', 'ائتمان'],
}

describe('task #714 i18n — payments.movements.chargeLess', () => {
  it.each(Object.keys(locales) as Code[])(
    '%s: resolves to a non-empty string',
    (code) => {
      const value = movementsOf(locales[code])[KEY]
      expect(value, `${code}.json payments.movements.${KEY} is missing`).toBeTypeOf('string')
      expect((value as string).trim().length, `${code}.json ${KEY} is empty`).toBeGreaterThan(0)
    }
  )

  it('has a distinct value per locale', () => {
    const values = Object.values(locales).map((dict) => movementsOf(dict)[KEY])
    expect(new Set(values).size, `expected 3 distinct values, got ${JSON.stringify(values)}`).toBe(3)
  })

  it('the es string is the approved wording, verbatim', () => {
    expect(movementsOf(es)[KEY]).toBe('La cita no tenía cobro propio')
  })

  it.each(Object.keys(locales) as Code[])(
    '%s: payments.movements holds exactly 8 keys (counted apart from the content checks)',
    (code) => {
      expect(Object.keys(movementsOf(locales[code]))).toHaveLength(EXPECTED_MOVEMENTS_KEY_COUNT)
    }
  )

  describe('G12: same condition as #717, no destination claimed', () => {
    it.each(Object.keys(locales) as Code[])(
      '%s: the label and #717 warning both use the phrase for "no charge of its own"',
      (code) => {
        const label = movementsOf(locales[code])[KEY] as string
        const warning = warningOf(locales[code])
        expect(label, `${code} label: ${label}`).toContain(SHARED_CONDITION[code])
        expect(warning, `${code} #717 warning: ${warning}`).toContain(SHARED_CONDITION[code])
      }
    )

    it.each(Object.keys(locales) as Code[])(
      '%s: the label claims no destination for the money',
      (code) => {
        const label = (movementsOf(locales[code])[KEY] as string).toLowerCase()
        const hits = DESTINATION_WORDS[code].filter((w) => label.includes(w))
        expect(hits, `${code} label "${label}" names a destination`).toEqual([])
      }
    )

    it('vacuity: the destination vocabulary does fire on #717 own warning in every locale', () => {
      for (const code of Object.keys(locales) as Code[]) {
        const warning = warningOf(locales[code]).toLowerCase()
        const hits = DESTINATION_WORDS[code].filter((w) => warning.includes(w))
        expect(hits.length, `${code} #717 warning "${warning}" matched no destination word`).toBeGreaterThan(0)
      }
    })
  })
})
