/**
 * i18n key-parity check for task #396 (dashboard "pending payments" became the
 * net outstanding across all patient-billable work, and the stat card subtitle
 * was retexted accordingly).
 *
 * The card interpolates a formatted currency amount, so the `{{amount}}`
 * placeholder must survive the retext in every locale — a translation that
 * dropped it would render the sentence with no number at all, silently.
 */
import { describe, it, expect } from 'vitest'
import es from './locales/es.json'
import en from './locales/en.json'
import ar from './locales/ar.json'

const locales = { es, en, ar } as const

const RETEXTED_KEY = 'dashboard.statCards.pendingAmount'

// The pre-#396 copy: a bare "pending" with no basis named. Pinned as a
// negative so a merge/revert that restores the old wording fails loudly
// rather than shipping a label that no longer describes the figure.
const PRE_396_VALUES: Record<keyof typeof locales, string> = {
  es: '{{amount}} pendientes',
  en: '{{amount}} pending',
  ar: '{{amount}} معلّق',
}

function getByPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, segment) => {
    if (acc && typeof acc === 'object' && segment in acc) {
      return (acc as Record<string, unknown>)[segment]
    }
    return undefined
  }, obj)
}

describe('task #396 i18n key parity — dashboard.statCards.pendingAmount', () => {
  it('exists as a non-empty string in es, en, and ar', () => {
    for (const [code, dict] of Object.entries(locales)) {
      const value = getByPath(dict, RETEXTED_KEY)
      expect(value, `${code}.json is missing "${RETEXTED_KEY}"`).toBeTypeOf('string')
      expect((value as string).length, `${code}.json has an empty value for "${RETEXTED_KEY}"`).toBeGreaterThan(0)
    }
  })

  it('keeps the {{amount}} interpolation placeholder in all three locales', () => {
    for (const [code, dict] of Object.entries(locales)) {
      const value = getByPath(dict, RETEXTED_KEY) as string
      expect(value, `${code}.json lost the {{amount}} placeholder`).toContain('{{amount}}')
      // Exactly one occurrence — a duplicated placeholder would print the
      // amount twice.
      expect(value.match(/\{\{amount\}\}/g)?.length, `${code}.json repeats {{amount}}`).toBe(1)
    }
  })

  it('carries no other interpolation placeholder than {{amount}}', () => {
    for (const [code, dict] of Object.entries(locales)) {
      const value = getByPath(dict, RETEXTED_KEY) as string
      const placeholders = value.match(/\{\{(\w+)\}\}/g) ?? []
      expect(placeholders, `${code}.json introduced an unsupplied placeholder`).toEqual(['{{amount}}'])
    }
  })

  it('has been retexted away from the pre-#396 "pending" wording in every locale', () => {
    for (const [code, dict] of Object.entries(locales)) {
      const value = getByPath(dict, RETEXTED_KEY) as string
      expect(value, `${code}.json still carries the pre-#396 copy`).not.toBe(
        PRE_396_VALUES[code as keyof typeof locales]
      )
    }
  })

  it('pins the retexted es/en/ar values', () => {
    expect(getByPath(es, RETEXTED_KEY)).toBe('{{amount}} por cobrar a pacientes')
    expect(getByPath(en, RETEXTED_KEY)).toBe('{{amount}} outstanding from patients')
    expect(getByPath(ar, RETEXTED_KEY)).toBe('{{amount}} مستحقة على المرضى')
  })

  it('has a distinct value per locale (no locale silently reusing another’s string)', () => {
    const values = Object.values(locales).map((dict) => getByPath(dict, RETEXTED_KEY) as string)
    expect(new Set(values).size, `expected 3 distinct translations, got ${JSON.stringify(values)}`).toBe(3)
  })

  it('dashboard.statCards has the same key structure across all three locales', () => {
    const keySets = Object.entries(locales).map(([code, dict]) => {
      const node = getByPath(dict, 'dashboard.statCards') as Record<string, unknown>
      return { code, keys: Object.keys(node ?? {}).sort() }
    })
    const [reference, ...rest] = keySets
    expect(reference.keys).toContain('pendingAmount')
    for (const other of rest) {
      expect(other.keys, `statCards keys differ between ${reference.code} and ${other.code}`).toEqual(
        reference.keys
      )
    }
  })
})
