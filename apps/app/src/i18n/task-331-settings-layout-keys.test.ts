/**
 * i18n key-parity check for task #331 (i18n migration: Settings + Layout/Nav).
 * Verifies every key added by this migration — `nav.openMenu`/`nav.closeMenu`,
 * `settings.noExportPermission`, `settings.exportError`, and the wholly-new
 * `settings.tabs.*`, `settings.days.*`, and `settings.businessHours.*`
 * subtrees — has a non-empty value in all three shipped locale files
 * (es/en/ar), has distinct translations per locale for genuine prose, and
 * (for the wholly-new subtrees) an IDENTICAL leaf-key set across locales.
 *
 * Deliberately scoped to the keys this task added. `settings.*` is a large
 * pre-existing namespace with an unrelated pre-existing orphan
 * (`settings.currencyWarning.*` missing in en.json, predating this task) —
 * this test does NOT run a full-tree parity check under `settings.*` so it
 * does not start failing on that pre-existing gap. Follows the pattern
 * established by task-325-doctors-keys.test.ts (#325) and
 * task-326-labworks-expenses-keys.test.ts (#326).
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
// { form: { validation: { x: '...' } } } -> ['form.validation.x'].
function collectLeafPaths(obj: unknown, prefix = ''): string[] {
  if (obj !== null && typeof obj === 'object' && !Array.isArray(obj)) {
    return Object.entries(obj as Record<string, unknown>).flatMap(([key, value]) =>
      collectLeafPaths(value, prefix ? `${prefix}.${key}` : key)
    )
  }
  return [prefix]
}

// nav.* keys added by the #331 migration (AppLayout mobile sidebar toggle).
const NAV_NEW_KEYS = ['openMenu', 'closeMenu'] as const

// Flat settings.* keys added by the #331 migration (SettingsPage,
// DataExportForm), plus the wholly-new settings.tabs.*, settings.days.*, and
// settings.businessHours.* subtrees added by SettingsPage and
// BusinessHoursForm respectively.
const SETTINGS_NEW_KEYS = [
  'noExportPermission',
  'exportError',
  'tabs.profile',
  'tabs.profileDescription',
  'tabs.preferences',
  'tabs.preferencesDescription',
  'tabs.hours',
  'tabs.hoursDescription',
  'tabs.data',
  'tabs.dataDescription',
  'days.sun',
  'days.sunShort',
  'days.mon',
  'days.monShort',
  'days.tue',
  'days.tueShort',
  'days.wed',
  'days.wedShort',
  'days.thu',
  'days.thuShort',
  'days.fri',
  'days.friShort',
  'days.sat',
  'days.satShort',
  'businessHours.workingDays',
  'businessHours.workingDaysHint',
  'businessHours.openingHours',
  'businessHours.openingHoursHint',
  'businessHours.readOnlyNotice',
  'businessHours.openingTime',
  'businessHours.closingTime',
  'businessHours.timeSeparator',
  'businessHours.noWorkingDays',
] as const

describe('task #331 i18n key parity — nav.*', () => {
  describe.each(NAV_NEW_KEYS)('key "nav.%s"', (key) => {
    it('exists as a non-empty string in es, en, and ar', () => {
      for (const [code, dict] of Object.entries(locales)) {
        const value = getByPath((dict as { nav: unknown }).nav, key)
        expect(value, `${code}.json nav.${key} is missing`).toBeTypeOf('string')
        expect(
          (value as string).length,
          `${code}.json nav.${key} has an empty value`
        ).toBeGreaterThan(0)
      }
    })

    it('has a distinct value per locale (no locale silently reusing another’s string)', () => {
      const values = Object.values(locales).map(
        (dict) => getByPath((dict as { nav: unknown }).nav, key) as string
      )
      const unique = new Set(values)
      expect(
        unique.size,
        `expected 3 distinct translations for nav.${key}, got ${JSON.stringify(values)}`
      ).toBe(3)
    })
  })
})

describe('task #331 i18n key parity — settings.* (new keys only)', () => {
  describe.each(SETTINGS_NEW_KEYS)('key "settings.%s"', (key) => {
    it('exists as a non-empty string in es, en, and ar', () => {
      for (const [code, dict] of Object.entries(locales)) {
        const value = getByPath((dict as { settings: unknown }).settings, key)
        expect(value, `${code}.json settings.${key} is missing`).toBeTypeOf('string')
        expect(
          (value as string).length,
          `${code}.json settings.${key} has an empty value`
        ).toBeGreaterThan(0)
      }
    })

    it('has a distinct value per locale (no locale silently reusing another’s string)', () => {
      const values = Object.values(locales).map(
        (dict) => getByPath((dict as { settings: unknown }).settings, key) as string
      )
      const unique = new Set(values)
      expect(
        unique.size,
        `expected 3 distinct translations for settings.${key}, got ${JSON.stringify(values)}`
      ).toBe(3)
    })
  })

  // These three subtrees are wholly new (added entirely by this migration),
  // so an identical-leaf-key check across locales is safe here — unlike a
  // full settings.* check, it cannot trip over the pre-existing
  // settings.currencyWarning.* orphan (out of scope for this task).
  describe.each(['tabs', 'days', 'businessHours'] as const)(
    'settings.%s subtree',
    (subtree) => {
      it('has an IDENTICAL leaf-key set across es, en, and ar (no missing/extra keys)', () => {
        const keySets = Object.entries(locales).map(([code, dict]) => ({
          code,
          keys: collectLeafPaths(
            (dict as { settings: Record<string, unknown> }).settings[subtree]
          ).sort(),
        }))
        const [reference, ...rest] = keySets
        for (const other of rest) {
          const missingInOther = reference.keys.filter((k) => !other.keys.includes(k))
          const extraInOther = other.keys.filter((k) => !reference.keys.includes(k))
          expect(
            missingInOther,
            `${other.code}.json is missing settings.${subtree}.* keys present in ${reference.code}.json`
          ).toEqual([])
          expect(
            extraInOther,
            `${other.code}.json has extra settings.${subtree}.* keys not present in ${reference.code}.json`
          ).toEqual([])
        }
      })
    }
  )

  it('has an IDENTICAL leaf-key set under nav.* across es, en, and ar (no missing/extra keys)', () => {
    const keySets = Object.entries(locales).map(([code, dict]) => ({
      code,
      keys: collectLeafPaths((dict as { nav: unknown }).nav).sort(),
    }))
    const [reference, ...rest] = keySets
    for (const other of rest) {
      const missingInOther = reference.keys.filter((k) => !other.keys.includes(k))
      const extraInOther = other.keys.filter((k) => !reference.keys.includes(k))
      expect(
        missingInOther,
        `${other.code}.json is missing nav.* keys present in ${reference.code}.json`
      ).toEqual([])
      expect(
        extraInOther,
        `${other.code}.json has extra nav.* keys not present in ${reference.code}.json`
      ).toEqual([])
    }
  })
})
