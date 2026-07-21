/**
 * i18n key-parity check for task #325 (i18n migration: Doctors).
 * Verifies the entire `doctors.*` tree has an IDENTICAL leaf-key set across
 * all three shipped locale files (es/en/ar) — no missing/extra keys in any
 * locale — plus non-empty values for every key this migration added, and
 * distinct translations for the subset of keys that are genuine prose
 * (labels/messages/day names) rather than shared literals (email domains,
 * phone numbers, license codes, numeric placeholders) that are expected to
 * repeat across locales by design.
 *
 * Follows the pattern established by spike-213-keys.test.ts (#213) and
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
// { form: { validation: { x: '...' } } } -> ['form.validation.x'].
function collectLeafPaths(obj: unknown, prefix = ''): string[] {
  if (obj !== null && typeof obj === 'object' && !Array.isArray(obj)) {
    return Object.entries(obj as Record<string, unknown>).flatMap(([key, value]) =>
      collectLeafPaths(value, prefix ? `${prefix}.${key}` : key)
    )
  }
  return [prefix]
}

// Every key added/touched by the #325 migration (DoctorFormModal,
// DoctorDetailPage, DoctorsPage), per the implementer's diff to
// locales/*.json. Section-container keys (form, list, detail, etc.) are
// covered separately by the deep key-parity check below.
const NEW_KEYS = [
  'deleteDoctor',
  'deleteConfirmMessage',
  'availableCount',
  'searchPlaceholder',
  'showInactiveFilter',
  'bio',
  'limitBanner.title',
  'limitBanner.body',
  'limitBanner.viewPlans',
  'emptyState.noDoctors',
  'emptyState.noDoctorsHint',
  'emptyState.noResults',
  'emptyState.noResultsHint',
  'toast.created',
  'toast.updated',
  'toast.deleted',
  'toast.restored',
  'days.mon',
  'days.tue',
  'days.wed',
  'days.thu',
  'days.fri',
  'days.sat',
  'days.sun',
  'days.short.mon',
  'days.short.tue',
  'days.short.wed',
  'days.short.thu',
  'days.short.fri',
  'days.short.sat',
  'days.short.sun',
  'form.consultingRoom',
  'form.hourlyRate',
  'form.workingHoursStart',
  'form.workingHoursEnd',
  'form.closeForm',
  'form.saveChanges',
  'form.createDoctor',
  'form.placeholders.firstName',
  'form.placeholders.lastName',
  'form.placeholders.email',
  'form.placeholders.phone',
  'form.placeholders.specialty',
  'form.placeholders.licenseNumber',
  'form.placeholders.consultingRoom',
  'form.placeholders.hourlyRate',
  'form.placeholders.bio',
  'form.validation.firstNameRequired',
  'form.validation.lastNameRequired',
  'form.validation.invalidEmail',
  'form.validation.bioMaxLength',
  'form.validation.hourlyRatePositive',
  'detail.backToDoctors',
  'detail.loadError',
  'detail.saveError',
  'detail.workSchedule',
  'detail.schedule',
  'detail.license',
  'detail.consultingRoom',
  'detail.hourlyRate',
] as const

// Subset of NEW_KEYS that are genuine translated prose (labels, messages,
// day names) — expected to have a distinct string per locale. Deliberately
// excludes keys whose value is a shared literal by design: email-domain,
// phone-number, and license/rate example placeholders, which the
// implementer intentionally reused across locales (e.g.
// form.placeholders.phone is the same "+1 234 567 890" example in all
// three, since a placeholder phone number isn't "translated"). Also
// excludes days.short.sat: "Sábado"/"Saturday" coincidentally both
// single-letter-abbreviate to "S" (es/en collide, ar is distinct) — a
// legitimate cognate, not a copy-paste miss.
const DISTINCT_PER_LOCALE_KEYS = [
  'deleteDoctor',
  'deleteConfirmMessage',
  'availableCount',
  'searchPlaceholder',
  'showInactiveFilter',
  'bio',
  'limitBanner.title',
  'limitBanner.body',
  'limitBanner.viewPlans',
  'emptyState.noDoctors',
  'emptyState.noDoctorsHint',
  'emptyState.noResults',
  'emptyState.noResultsHint',
  'toast.created',
  'toast.updated',
  'toast.deleted',
  'toast.restored',
  'days.mon',
  'days.tue',
  'days.wed',
  'days.thu',
  'days.fri',
  'days.sat',
  'days.sun',
  'days.short.mon',
  'days.short.tue',
  'days.short.wed',
  'days.short.thu',
  'days.short.fri',
  'days.short.sun',
  'form.consultingRoom',
  'form.hourlyRate',
  'form.workingHoursStart',
  'form.workingHoursEnd',
  'form.closeForm',
  'form.saveChanges',
  'form.createDoctor',
  'form.placeholders.firstName',
  'form.placeholders.lastName',
  'form.placeholders.specialty',
  'form.placeholders.bio',
  'form.validation.firstNameRequired',
  'form.validation.lastNameRequired',
  'form.validation.invalidEmail',
  'form.validation.bioMaxLength',
  'form.validation.hourlyRatePositive',
  'detail.backToDoctors',
  'detail.loadError',
  'detail.saveError',
  'detail.workSchedule',
  'detail.schedule',
  'detail.license',
  'detail.consultingRoom',
  'detail.hourlyRate',
] as const

describe('task #325 i18n key parity — doctors.*', () => {
  describe.each(NEW_KEYS)('key "doctors.%s"', (key) => {
    it('exists as a non-empty string in es, en, and ar', () => {
      for (const [code, dict] of Object.entries(locales)) {
        const value = getByPath((dict as { doctors: unknown }).doctors, key)
        expect(value, `${code}.json doctors.${key} is missing`).toBeTypeOf('string')
        expect(
          (value as string).length,
          `${code}.json doctors.${key} has an empty value`
        ).toBeGreaterThan(0)
      }
    })
  })

  describe.each(DISTINCT_PER_LOCALE_KEYS)('key "doctors.%s" (translatable prose)', (key) => {
    it('has a distinct value per locale (no locale silently reusing another’s string)', () => {
      const values = Object.values(locales).map(
        (dict) => getByPath((dict as { doctors: unknown }).doctors, key) as string
      )
      const unique = new Set(values)
      expect(
        unique.size,
        `expected 3 distinct translations for doctors.${key}, got ${JSON.stringify(values)}`
      ).toBe(3)
    })
  })

  it('has an IDENTICAL leaf-key set under doctors.* across es, en, and ar (no missing/extra keys)', () => {
    const keySets = Object.entries(locales).map(([code, dict]) => ({
      code,
      keys: collectLeafPaths((dict as { doctors: unknown }).doctors).sort(),
    }))
    const [reference, ...rest] = keySets
    for (const other of rest) {
      const missingInOther = reference.keys.filter((k) => !other.keys.includes(k))
      const extraInOther = other.keys.filter((k) => !reference.keys.includes(k))
      expect(
        missingInOther,
        `${other.code}.json is missing doctors.* keys present in ${reference.code}.json`
      ).toEqual([])
      expect(
        extraInOther,
        `${other.code}.json has extra doctors.* keys not present in ${reference.code}.json`
      ).toEqual([])
    }
  })
})
