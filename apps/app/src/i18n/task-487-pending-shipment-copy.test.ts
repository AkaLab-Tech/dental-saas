/**
 * i18n guard for task #487 (labwork lifecycle "pending" no longer shares
 * copy with payment "pending").
 *
 * Before this task, `labworks.status.pending` and `payment.pending`
 * resolved to the exact same word in every locale ("Pendiente" / "Pending"
 * / "معلق"), which made a labwork card showing both badges read as if the
 * lab work itself were an unpaid payment. This slice retexted only the
 * lifecycle key to name the concrete next step (shipping the work to the
 * lab), while `payment.pending` keeps describing an outstanding payment.
 *
 * This guard asserts on the RESOLVED STRINGS loaded from the locale JSON
 * files, not on the key names (comparing the key literals would be
 * trivially true and prove nothing).
 */
import { describe, it, expect } from 'vitest'
import es from './locales/es.json'
import en from './locales/en.json'
import ar from './locales/ar.json'

const locales = { es, en, ar } as const

function getByPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, segment) => {
    if (acc && typeof acc === 'object' && segment in acc) {
      return (acc as Record<string, unknown>)[segment]
    }
    return undefined
  }, obj)
}

const EXPECTED_LIFECYCLE_PENDING: Record<keyof typeof locales, string> = {
  es: 'Pendiente de envío',
  en: 'Pending shipment',
  ar: 'بانتظار الإرسال',
}

const EXPECTED_PAYMENT_PENDING: Record<keyof typeof locales, string> = {
  es: 'Pendiente',
  en: 'Pending',
  ar: 'معلق',
}

describe('task #487 i18n guard — labworks.status.pending vs payment.pending', () => {
  it.each(Object.keys(locales) as Array<keyof typeof locales>)(
    'resolves to different strings in %s',
    (code) => {
      const dict = locales[code]
      const lifecycleValue = getByPath(dict, 'labworks.status.pending')
      const paymentValue = getByPath(dict, 'payment.pending')

      expect(lifecycleValue, `${code}.json is missing labworks.status.pending`).toBeTypeOf('string')
      expect(paymentValue, `${code}.json is missing payment.pending`).toBeTypeOf('string')

      expect(
        lifecycleValue,
        `${code}.json: labworks.status.pending ("${lifecycleValue as string}") must not equal payment.pending ("${paymentValue as string}")`
      ).not.toBe(paymentValue)
    }
  )

  it('pins the exact lifecycle pending copy per locale', () => {
    for (const code of Object.keys(locales) as Array<keyof typeof locales>) {
      expect(getByPath(locales[code], 'labworks.status.pending')).toBe(
        EXPECTED_LIFECYCLE_PENDING[code]
      )
    }
  })

  it('leaves the payment pending copy unchanged per locale', () => {
    for (const code of Object.keys(locales) as Array<keyof typeof locales>) {
      expect(getByPath(locales[code], 'payment.pending')).toBe(EXPECTED_PAYMENT_PENDING[code])
    }
  })
})
