/**
 * i18n copy guard for task #513. `appointments.form.paidAmountHint` described
 * pre-#401 behaviour: that an appointment payment is "applied to the patient's
 * oldest debt" and "kept separate from advance payments". Since #401 a
 * kind=APPOINTMENT payment is earmarked to ITS OWN appointment (capped at that
 * appointment's cost) and only the excess joins the FIFO pool.
 *
 * Per locale this pins (1) the two false claims are gone, (2) the earmark and
 * the excess are positively mentioned, (3) the hint is a single sentence.
 * Tokens are discriminating words, not whole phrases, because the locales
 * worded the old claim differently ("oldest outstanding balance" in en).
 *
 * Follows task-524-paid-badge-charged-vs-covered-keys.test.ts.
 */
import { describe, it, expect } from 'vitest'
import es from './locales/es.json'
import en from './locales/en.json'
import ar from './locales/ar.json'

const hintOf = (dict: unknown) =>
  (dict as { appointments: { form: { paidAmountHint: string } } }).appointments.form.paidAmountHint

interface Case {
  forbidden: string[]
  required: string[]
}

const CASES: Record<'es' | 'en' | 'ar', Case & { dict: unknown }> = {
  es: {
    dict: es,
    forbidden: ['más antigua', 'separado de las entregas'],
    required: ['costo', 'exceda'],
  },
  en: {
    dict: en,
    forbidden: ['oldest', 'kept separate from advance payments'],
    required: ['cost', 'exceeds'],
  },
  ar: {
    dict: ar,
    forbidden: ['أقدم', 'منفصلة عن الدفعات'],
    required: ['تكلفته', 'يزيد'],
  },
}

describe('task #513 appointments.form.paidAmountHint describes the post-#401 earmark', () => {
  for (const code of ['es', 'en', 'ar'] as const) {
    describe(code, () => {
      const { dict, forbidden, required } = CASES[code]
      const value = hintOf(dict)

      it.each(forbidden)(`${code}: does not contain the pre-#401 claim "%s"`, (phrase) => {
        expect(value, `${code}.json still says "${phrase}"`).not.toContain(phrase)
      })

      it.each(required)(`${code}: mentions the appointment cost / excess via "%s"`, (token) => {
        expect(value, `${code}.json no longer mentions "${token}"`).toContain(token)
      })

      it(`${code}: is a single sentence`, () => {
        const body = value.trim().replace(/[.!?؟]+$/, '')
        expect(body, `${code}.json hint has more than one sentence`).not.toMatch(/[.!?؟]/)
      })
    })
  }
})
