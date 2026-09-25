/**
 * i18n key-parity check for task #484 (a failed profiles refetch used to empty
 * the kiosk lock screen with no way back).
 *
 * `lock.profilesError` and `lock.retry` are the entire recovery affordance on
 * that screen: the notice is what tells the operator the visible list is
 * stale and not selectable, and the button label is the only way out of the
 * errored state (`profiles` is not persisted, so a reload does not restore
 * it). A locale missing either key would render the raw key or an unlabelled
 * button — the same dead end #484 removed, in that language only.
 */
import { describe, it, expect } from 'vitest'
import es from './locales/es.json'
import en from './locales/en.json'
import ar from './locales/ar.json'

const locales = { es, en, ar } as const

const NEW_KEYS = ['lock.profilesError', 'lock.retry'] as const

function getByPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, segment) => {
    if (acc && typeof acc === 'object' && segment in acc) {
      return (acc as Record<string, unknown>)[segment]
    }
    return undefined
  }, obj)
}

describe('task #484 i18n key parity — lock.profilesError / lock.retry', () => {
  it.each(NEW_KEYS)('%s exists as a non-empty string in es, en, and ar', (key) => {
    for (const [code, dict] of Object.entries(locales)) {
      const value = getByPath(dict, key)
      expect(value, `${code}.json is missing "${key}"`).toBeTypeOf('string')
      expect(
        (value as string).trim().length,
        `${code}.json has an empty value for "${key}"`
      ).toBeGreaterThan(0)
    }
  })

  it.each(NEW_KEYS)('%s carries no interpolation placeholder (the component passes no variables)', (key) => {
    for (const [code, dict] of Object.entries(locales)) {
      const value = getByPath(dict, key) as string
      const placeholders = value.match(/\{\{(\w+)\}\}/g) ?? []
      expect(placeholders, `${code}.json introduced an unsupplied placeholder`).toEqual([])
    }
  })

  it.each(NEW_KEYS)('%s has a distinct value per locale (no locale silently reusing another one)', (key) => {
    const values = Object.values(locales).map((dict) => getByPath(dict, key) as string)
    expect(
      new Set(values).size,
      `expected 3 distinct translations, got ${JSON.stringify(values)}`
    ).toBe(3)
  })

  it('pins the es copy verbatim', () => {
    expect(getByPath(es, 'lock.profilesError')).toBe(
      'No se pudieron actualizar los perfiles. La lista que ves puede estar desactualizada y no se puede seleccionar. Reintenta para continuar.'
    )
    expect(getByPath(es, 'lock.retry')).toBe('Reintentar')
  })

  it('states in every locale that the visible list is not usable, not merely that a refresh failed', () => {
    // The approved variant keeps the rows on screen but disabled. Copy that
    // only says "could not refresh" would leave the operator clicking dead
    // cards; each locale must say the list cannot be selected / is stale.
    const mustMention: Record<string, RegExp> = {
      es: /desactualizada|no se puede seleccionar/i,
      en: /out of date|cannot be selected/i,
      ar: /قديمة|اختيارها/,
    }
    for (const [code, dict] of Object.entries(locales)) {
      const value = getByPath(dict, 'lock.profilesError') as string
      expect(value, `${code}.json does not warn that the shown list is unusable`).toMatch(
        mustMention[code]
      )
    }
  })

  it('keeps the whole lock namespace at the same key structure across all three locales', () => {
    const keySets = Object.entries(locales).map(([code, dict]) => {
      const node = getByPath(dict, 'lock') as Record<string, unknown>
      return { code, keys: Object.keys(node ?? {}).sort() }
    })
    const [reference, ...rest] = keySets
    expect(reference.keys).toContain('profilesError')
    expect(reference.keys).toContain('retry')
    for (const other of rest) {
      expect(other.keys, `lock keys differ between ${reference.code} and ${other.code}`).toEqual(
        reference.keys
      )
    }
  })

  it('does not reuse lock.retry for the generic common.loading or lock.enterPin copy', () => {
    for (const [code, dict] of Object.entries(locales)) {
      const retry = getByPath(dict, 'lock.retry') as string
      expect(retry, `${code}.json reuses common.loading for lock.retry`).not.toBe(
        getByPath(dict, 'common.loading')
      )
      expect(retry, `${code}.json reuses lock.enterPin for lock.retry`).not.toBe(
        getByPath(dict, 'lock.enterPin')
      )
    }
  })
})
