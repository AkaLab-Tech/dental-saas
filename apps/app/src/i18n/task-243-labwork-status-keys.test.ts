/**
 * i18n key-parity check for task #243-B (labwork lifecycle status UI).
 * Verifies the `labworks.status.*` keys added by this slice exist as
 * non-empty strings in all three shipped locale files (es/en/ar), that the
 * keys removed by this slice (`labworks.status.completed`,
 * `labworks.status.delivered`) are gone from all three, that the new
 * top-level `labworks.noDoctorsAvailable` key exists in all three, and that
 * the whole `labworks.*` tree still has an IDENTICAL leaf-key set across
 * locales (no missing/extra keys in any one of them).
 *
 * Follows the pattern established by task-326-labworks-expenses-keys.test.ts
 * (#326), task-325-doctors-keys.test.ts (#325), and
 * task-309-advance-payment-keys.test.ts (#309).
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

// Recursively collect every leaf (non-object) key path under a node, e.g.
// { status: { pending: '...' } } -> ['status.pending'].
function collectLeafPaths(obj: unknown, prefix = ''): string[] {
  if (obj !== null && typeof obj === 'object' && !Array.isArray(obj)) {
    return Object.entries(obj as Record<string, unknown>).flatMap(([key, value]) =>
      collectLeafPaths(value, prefix ? `${prefix}.${key}` : key)
    )
  }
  return [prefix]
}

// Keys added by task #243-B's badge/status-select rework.
const NEW_KEYS = [
  'status.label',
  'status.sent',
  'status.received',
  'status.deleted',
  'noDoctorsAvailable',
] as const

// Keys #243-B removed (superseded by `status.received` / `status.deleted` /
// the "no payment encoded" badge precedence — see labwork-api.ts).
const REMOVED_KEYS = ['status.completed', 'status.delivered'] as const

describe('task #243-B i18n key parity — labworks.status.*', () => {
  describe.each(NEW_KEYS)('key "labworks.%s"', (key) => {
    it('exists as a non-empty string in es, en, and ar', () => {
      for (const [code, dict] of Object.entries(locales)) {
        const value = getByPath((dict as { labworks: unknown }).labworks, key)
        expect(value, `${code}.json labworks.${key} is missing`).toBeTypeOf('string')
        expect(
          (value as string).length,
          `${code}.json labworks.${key} has an empty value`
        ).toBeGreaterThan(0)
      }
    })

    it('has a distinct value per locale (no locale silently reusing another’s string)', () => {
      const values = Object.values(locales).map(
        (dict) => getByPath((dict as { labworks: unknown }).labworks, key) as string
      )
      const unique = new Set(values)
      expect(
        unique.size,
        `expected 3 distinct translations for labworks.${key}, got ${JSON.stringify(values)}`
      ).toBe(3)
    })
  })

  describe.each(REMOVED_KEYS)('removed key "labworks.%s"', (key) => {
    it('no longer exists in es, en, or ar', () => {
      for (const [code, dict] of Object.entries(locales)) {
        const value = getByPath((dict as { labworks: unknown }).labworks, key)
        expect(value, `${code}.json still has labworks.${key}, which task #243-B removed`).toBeUndefined()
      }
    })
  })

  it('has an IDENTICAL leaf-key set under labworks.* across es, en, and ar (no missing/extra keys)', () => {
    const keySets = Object.entries(locales).map(([code, dict]) => ({
      code,
      keys: collectLeafPaths((dict as { labworks: unknown }).labworks).sort(),
    }))
    const [reference, ...rest] = keySets
    for (const other of rest) {
      const missingInOther = reference.keys.filter((k) => !other.keys.includes(k))
      const extraInOther = other.keys.filter((k) => !reference.keys.includes(k))
      expect(
        missingInOther,
        `${other.code}.json is missing labworks.* keys present in ${reference.code}.json`
      ).toEqual([])
      expect(
        extraInOther,
        `${other.code}.json has extra labworks.* keys not present in ${reference.code}.json`
      ).toEqual([])
    }
  })
})
