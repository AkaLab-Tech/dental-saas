/**
 * i18n key-parity guard for #557 (medical history block on the patient page).
 *
 * `fallbackLng` is `es`, so a key missing from en.json or ar.json renders
 * SPANISH to an English or Arabic operator and nothing fails. A per-locale
 * check is therefore the only way a missing key is visible at all. This pins:
 *   1. every expected key is a non-empty string in es, en and ar;
 *   2. the three locales hold EXACTLY the same `patients.medicalHistoryBlock`
 *      key set (a half-finished removal or addition by hand fails here);
 *   3. interpolation tokens ({{max}}, {{number}}) are the same set per key
 *      across the three locales;
 *   4. en and ar differ from Spanish, so an es fallback would be visible.
 * Structural parity only: translation quality is not asserted.
 *
 * Follows task-541-treatment-plan-keys.test.ts and
 * task-361-budget-item-selector-keys.test.ts.
 */
import { describe, it, expect } from 'vitest'
import es from './locales/es.json'
import en from './locales/en.json'
import ar from './locales/ar.json'

const LOCALES = { es, en, ar } as const
type Code = keyof typeof LOCALES
const CODES = Object.keys(LOCALES) as Code[]

const BLOCK = 'patients.medicalHistoryBlock'

/** Every leaf key of the block, relative to `patients.medicalHistoryBlock`. */
const BLOCK_KEYS = [
  'criticalMarker',
  'edit',
  'add',
  'addEntry',
  'remove',
  'save',
  'cancel',
  'entryLabel',
  'criticalityLabel',
  'sections.allergies',
  'sections.currentMedication',
  'sections.conditions',
  'sections.previousSurgeries',
  'sections.medicalNotes',
  'criticality.critical',
  'criticality.normal',
  'errors.empty',
  'errors.tooLong',
  'errors.multiline',
  'errors.invalidCriticality',
  'errors.tooManyEntries',
  'errors.saveFailed',
] as const

/** Keys outside the block that the block reuses. */
const REUSED_KEYS = ['patients.medicalHistory'] as const

/** Placeholders each key must carry, in every locale. */
const EXPECTED_PLACEHOLDERS: Record<string, string[]> = {
  entryLabel: ['number'],
  'errors.tooLong': ['max'],
  'errors.tooManyEntries': ['max'],
}

function getByPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, segment) => {
    if (acc && typeof acc === 'object' && segment in acc) {
      return (acc as Record<string, unknown>)[segment]
    }
    return undefined
  }, obj)
}

/** Flatten a nested object to dotted leaf paths. */
function leafPaths(node: unknown, prefix = ''): string[] {
  if (node && typeof node === 'object') {
    return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) =>
      leafPaths(v, prefix ? `${prefix}.${k}` : k)
    )
  }
  return [prefix]
}

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]).sort()
}

describe('#557 medical history i18n keys', () => {
  for (const code of CODES) {
    describe(code, () => {
      it.each([...BLOCK_KEYS.map((k) => `${BLOCK}.${k}`), ...REUSED_KEYS])(
        '%s is a non-empty string',
        (key) => {
          const value = getByPath(LOCALES[code], key)
          expect(typeof value, `${code}.json is missing ${key}`).toBe('string')
          expect((value as string).trim().length, `${code}.json has an empty ${key}`).toBeGreaterThan(0)
        }
      )

      it('holds exactly the expected key set under the block (no extra, no missing)', () => {
        const actual = leafPaths(getByPath(LOCALES[code], BLOCK)).sort()
        expect(actual, `${code}.json block keys differ from the expected set`).toEqual(
          [...BLOCK_KEYS].sort()
        )
      })

      it('no longer carries the removed addFirst key', () => {
        const block = getByPath(LOCALES[code], BLOCK) as Record<string, unknown>
        expect(block, `${code}.json is missing the block`).toBeTruthy()
        expect('addFirst' in block, `${code}.json still has ${BLOCK}.addFirst`).toBe(false)
      })
    })
  }

  it('the three locales hold the same key set as each other', () => {
    const sets = CODES.map((c) => leafPaths(getByPath(LOCALES[c], BLOCK)).sort())
    expect(sets[1], 'en.json key set differs from es.json').toEqual(sets[0])
    expect(sets[2], 'ar.json key set differs from es.json').toEqual(sets[0])
  })

  describe('placeholder parity', () => {
    it.each(Object.entries(EXPECTED_PLACEHOLDERS))(
      '%s carries exactly %j in es, en and ar',
      (key, tokens) => {
        for (const code of CODES) {
          const value = getByPath(LOCALES[code], `${BLOCK}.${key}`) as string
          expect(
            placeholders(value),
            `${code}.json ${BLOCK}.${key} has placeholders ${JSON.stringify(placeholders(value))}`
          ).toEqual(tokens)
        }
      }
    )

    it('every key has the same placeholder set in all three locales', () => {
      for (const key of BLOCK_KEYS) {
        const [esP, enP, arP] = CODES.map((c) =>
          placeholders(getByPath(LOCALES[c], `${BLOCK}.${key}`) as string)
        )
        expect(enP, `en.json ${BLOCK}.${key} placeholders differ from es`).toEqual(esP)
        expect(arP, `ar.json ${BLOCK}.${key} placeholders differ from es`).toEqual(esP)
      }
    })
  })

  it.each(['en', 'ar'] as const)(
    'the %s block strings differ from Spanish, so an es fallback would be visible',
    (code) => {
      for (const key of BLOCK_KEYS) {
        const path = `${BLOCK}.${key}`
        // "Normal" etc. may legitimately coincide with a Spanish cognate.
        if (key === 'criticality.normal' && code === 'en') continue
        expect(
          getByPath(LOCALES[code], path),
          `${code}.json ${path} is identical to Spanish — the es fallback hides a missing key`
        ).not.toBe(getByPath(es, path))
      }
    }
  )
})
