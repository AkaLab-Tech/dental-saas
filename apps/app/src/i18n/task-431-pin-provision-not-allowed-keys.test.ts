/**
 * i18n key-parity check for task #431 (the kiosk stopped offering PIN
 * provisioning to sessions that cannot perform it, and now explains why).
 *
 * `pin.provisionNotAllowed` is the only copy the blocked operator ever sees:
 * the `setup-unavailable` step renders it and nothing else — no step label, no
 * PIN inputs, no retry prompt. A locale missing the key would leave that
 * screen showing the raw key or an empty card, i.e. a dead end with no
 * explanation, which is exactly the failure #431 set out to remove.
 */
import { describe, it, expect } from 'vitest'
import es from './locales/es.json'
import en from './locales/en.json'
import ar from './locales/ar.json'

const locales = { es, en, ar } as const

const NEW_KEY = 'pin.provisionNotAllowed'

function getByPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, segment) => {
    if (acc && typeof acc === 'object' && segment in acc) {
      return (acc as Record<string, unknown>)[segment]
    }
    return undefined
  }, obj)
}

describe('task #431 i18n key parity — pin.provisionNotAllowed', () => {
  it('exists as a non-empty string in es, en, and ar', () => {
    for (const [code, dict] of Object.entries(locales)) {
      const value = getByPath(dict, NEW_KEY)
      expect(value, `${code}.json is missing "${NEW_KEY}"`).toBeTypeOf('string')
      expect((value as string).trim().length, `${code}.json has an empty value for "${NEW_KEY}"`).toBeGreaterThan(0)
    }
  })

  it('carries no interpolation placeholder (the component passes no variables)', () => {
    for (const [code, dict] of Object.entries(locales)) {
      const value = getByPath(dict, NEW_KEY) as string
      const placeholders = value.match(/\{\{(\w+)\}\}/g) ?? []
      expect(placeholders, `${code}.json introduced an unsupplied placeholder`).toEqual([])
    }
  })

  it('pins the es copy verbatim', () => {
    expect(getByPath(es, NEW_KEY)).toBe(
      'Este perfil todavía no tiene PIN. Pedile a un administrador que lo configure.'
    )
  })

  it('has a distinct value per locale (no locale silently reusing another one)', () => {
    const values = Object.values(locales).map((dict) => getByPath(dict, NEW_KEY) as string)
    expect(new Set(values).size, `expected 3 distinct translations, got ${JSON.stringify(values)}`).toBe(3)
  })

  it('does not duplicate the existing pin.saveError retry copy in any locale', () => {
    // The whole point of the new step is that it does NOT say "try again":
    // a locale that copy-pasted saveError would restore the original bug in
    // that language only.
    for (const [code, dict] of Object.entries(locales)) {
      const value = getByPath(dict, NEW_KEY) as string
      const saveError = getByPath(dict, 'pin.saveError') as string
      expect(value, `${code}.json reuses pin.saveError for ${NEW_KEY}`).not.toBe(saveError)
    }
  })

  it('keeps the whole pin namespace at the same key structure across all three locales', () => {
    const keySets = Object.entries(locales).map(([code, dict]) => {
      const node = getByPath(dict, 'pin') as Record<string, unknown>
      return { code, keys: Object.keys(node ?? {}).sort() }
    })
    const [reference, ...rest] = keySets
    expect(reference.keys).toContain('provisionNotAllowed')
    for (const other of rest) {
      expect(other.keys, `pin keys differ between ${reference.code} and ${other.code}`).toEqual(
        reference.keys
      )
    }
  })
})
