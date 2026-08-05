/**
 * i18n key-parity check for task #361 (appointment budget item selector:
 * eligibility filter + executed-item lock). Verifies the new
 * `appointments.budgetItems.filterHint` key exists, with a non-empty and
 * distinct string value, in all three shipped locale files (es/en/ar) — so
 * the new hint text under the selector never silently falls back to a raw
 * key or an English string in another locale.
 */
import { describe, it, expect } from 'vitest'
import es from './locales/es.json'
import en from './locales/en.json'
import ar from './locales/ar.json'

const locales = { es, en, ar } as const

// Key added for task #361, per the implementer's diff to locales/*.json
const NEW_KEY = 'appointments.budgetItems.filterHint'

function getByPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, segment) => {
    if (acc && typeof acc === 'object' && segment in acc) {
      return (acc as Record<string, unknown>)[segment]
    }
    return undefined
  }, obj)
}

describe('task #361 i18n key parity', () => {
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

  it('sits alongside selectHint under appointments.budgetItems in every locale (same parent block)', () => {
    for (const [code, dict] of Object.entries(locales)) {
      const node = getByPath(dict, 'appointments.budgetItems') as Record<string, unknown>
      expect(node, `${code}.json is missing the appointments.budgetItems block`).toBeTruthy()
      expect(node.selectHint, `${code}.json is missing appointments.budgetItems.selectHint`).toBeTypeOf('string')
      expect(node.filterHint, `${code}.json is missing appointments.budgetItems.filterHint`).toBeTypeOf('string')
    }
  })
})
