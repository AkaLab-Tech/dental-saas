/**
 * Task #220: apps/web locale key parity.
 *
 * Follows the pattern established at
 * apps/app/src/i18n/task-361-budget-item-selector-keys.test.ts. Verifies the
 * three shipped locale files expose the same key set with non-empty,
 * per-locale-distinct values — a missing key in one language silently falls
 * back to i18next's raw key (or another locale's fallbackLng string) in
 * production instead of failing loudly here.
 */
import { describe, it, expect } from 'vitest'
import es from './locales/es.json'
import en from './locales/en.json'
import ar from './locales/ar.json'

const locales = { es, en, ar } as const

function flattenKeys(obj: unknown, prefix = ''): string[] {
  if (obj === null || typeof obj !== 'object') return [prefix]
  return Object.entries(obj as Record<string, unknown>).flatMap(([key, value]) =>
    flattenKeys(value, prefix ? `${prefix}.${key}` : key)
  )
}

function getByPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, segment) => {
    if (acc && typeof acc === 'object' && segment in acc) {
      return (acc as Record<string, unknown>)[segment]
    }
    return undefined
  }, obj)
}

describe('apps/web locale key parity', () => {
  const esKeys = flattenKeys(es).sort()

  it('en.json has exactly the same key set as es.json', () => {
    const enKeys = flattenKeys(en).sort()
    expect(enKeys).toEqual(esKeys)
  })

  it('ar.json has exactly the same key set as es.json', () => {
    const arKeys = flattenKeys(ar).sort()
    expect(arKeys).toEqual(esKeys)
  })

  it('every key resolves to a non-empty string in all three locales', () => {
    for (const key of esKeys) {
      for (const [code, dict] of Object.entries(locales)) {
        const value = getByPath(dict, key)
        expect(value, `${code}.json is missing "${key}"`).toBeTypeOf('string')
        expect((value as string).length, `${code}.json has an empty value for "${key}"`).toBeGreaterThan(0)
      }
    }
  })

  it('covers exactly the nav/cta/hero scope this task shipped (no stray top-level namespaces)', () => {
    const topLevel = Object.keys(es).sort()
    expect(topLevel).toEqual(['cta', 'hero', 'nav'])
  })

  it('es and en have distinct values for every key (catches a copy-paste-and-forget locale)', () => {
    for (const key of esKeys) {
      const esValue = getByPath(es, key)
      const enValue = getByPath(en, key)
      expect(esValue, `es and en share the same string for "${key}"`).not.toBe(enValue)
    }
  })
})
