/**
 * i18n key-parity check for task #362 (budgets list: inline per-item
 * execution detail). Verifies the new `budgets.itemsInline.showMore` /
 * `showLess` keys exist, with a non-empty and distinct string value, in all
 * three shipped locale files (es/en/ar) — so the inline expand/collapse
 * control never silently falls back to a raw key or an English string in
 * another locale.
 */
import { describe, it, expect } from 'vitest'
import es from './locales/es.json'
import en from './locales/en.json'
import ar from './locales/ar.json'

const locales = { es, en, ar } as const

// Keys added for task #362, per the implementer's diff to locales/*.json
const NEW_KEYS = ['budgets.itemsInline.showMore', 'budgets.itemsInline.showLess'] as const

function getByPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, segment) => {
    if (acc && typeof acc === 'object' && segment in acc) {
      return (acc as Record<string, unknown>)[segment]
    }
    return undefined
  }, obj)
}

describe('task #362 i18n key parity', () => {
  describe.each(NEW_KEYS)('key "%s"', (key) => {
    it('exists as a non-empty string in es, en, and ar', () => {
      for (const [code, dict] of Object.entries(locales)) {
        const value = getByPath(dict, key)
        expect(value, `${code}.json is missing "${key}"`).toBeTypeOf('string')
        expect((value as string).length, `${code}.json has an empty value for "${key}"`).toBeGreaterThan(0)
      }
    })

    it('has a distinct value per locale (no locale silently reusing another’s string)', () => {
      const values = Object.values(locales).map((dict) => getByPath(dict, key) as string)
      const unique = new Set(values)
      expect(unique.size, `expected 3 distinct translations for "${key}", got ${JSON.stringify(values)}`).toBe(3)
    })
  })

  it('the showMore key interpolates {{count}} in every locale (used for the "+N" expand label)', () => {
    for (const [code, dict] of Object.entries(locales)) {
      const value = getByPath(dict, 'budgets.itemsInline.showMore') as string
      expect(value, `${code}.json's showMore should interpolate {{count}}`).toContain('{{count}}')
    }
  })

  it('budgets.itemsInline has the same key structure across all three locales', () => {
    const keySets = Object.entries(locales).map(([code, dict]) => {
      const node = getByPath(dict, 'budgets.itemsInline') as Record<string, unknown>
      return { code, keys: Object.keys(node ?? {}).sort() }
    })
    const [reference, ...rest] = keySets
    for (const other of rest) {
      expect(other.keys, `budgets.itemsInline keys differ between ${reference.code} and ${other.code}`).toEqual(
        reference.keys
      )
    }
  })
})
