/**
 * i18n key-parity check for task #713 (an appointment cost cleared silently).
 * `appointments.form.costInvalid` is the field-level error shown when the cost
 * input holds text the browser cannot parse as a number (validity.badInput), and
 * it must exist as a non-empty string in es, en and ar.
 *
 * Why this file exists: there is no repo-wide key-parity guard.
 * i18n.test.ts asserts configuration and a handful of named keys, and
 * spike-213-keys.test.ts asserts parity only for SPIKE #213's own keys. The
 * per-task task-*-keys.test.ts files are the mechanism that catches a missing
 * locale, so this task carries its own. Each locale is asserted separately so
 * one missing locale fails on its own.
 *
 * Follows task-717-charge-less-payment-keys.test.ts.
 */
import { describe, it, expect } from 'vitest'
import es from './locales/es.json'
import en from './locales/en.json'
import ar from './locales/ar.json'

const locales = { es, en, ar } as const
const formOf = (dict: unknown) =>
  (dict as { appointments: { form: Record<string, unknown> } }).appointments.form

const KEY = 'costInvalid'

describe(`task #713 i18n key parity - appointments.form.${KEY}`, () => {
  it.each(Object.entries(locales))('%s: exists as a non-empty string', (code, dict) => {
    const value = formOf(dict)[KEY]
    expect(value, `${code}.json appointments.form.${KEY} is missing`).toBeTypeOf('string')
    expect((value as string).trim().length, `${code}.json ${KEY} is empty`).toBeGreaterThan(0)
  })
})
