/**
 * #541 — every key the patient treatment plan PDF renders must exist in es, en
 * and ar.
 *
 * This matters more here than on the frontend: `t()` has NO fallback language
 * (see "should return key if translation is missing" in index.test.ts), so a
 * missing key does not degrade to Spanish — it prints the literal string
 * "pdf.treatmentPlan.total" onto the document the patient is handed.
 *
 * The key list is the one PatientTreatmentPlanPdf.tsx reads, including the
 * four it borrows from the per-budget document's table block and
 * `pdf.table.date`, which live outside the new `treatmentPlan` block and so
 * are easy to assume rather than check.
 */
import { describe, it, expect } from 'vitest'
import { t } from './index.js'
import es from './pdf-emails.es.js'
import en from './pdf-emails.en.js'
import ar from './pdf-emails.ar.js'

const LANGUAGES = ['es', 'en', 'ar'] as const

const NEW_KEYS = [
  'pdf.treatmentPlan.title',
  'pdf.treatmentPlan.planFor',
  'pdf.treatmentPlan.itemsCount',
  'pdf.treatmentPlan.noItems',
  'pdf.treatmentPlan.total',
  'pdf.treatmentPlan.footer',
] as const

const BORROWED_KEYS = [
  'pdf.budget.table.item',
  'pdf.budget.table.description',
  'pdf.budget.table.tooth',
  'pdf.budget.table.qty',
  'pdf.budget.table.unitPrice',
  'pdf.budget.table.lineTotal',
  'pdf.table.date',
  'pdf.common.phone',
  'pdf.common.generatedOn',
] as const

const DICTS = { es, en, ar } as const

/** Reads a dotted path out of a dictionary, or undefined. */
function at(dict: unknown, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (node, key) =>
        node && typeof node === 'object' ? (node as Record<string, unknown>)[key] : undefined,
      dict
    )
}

describe('#541 treatment plan PDF translation keys', () => {
  for (const language of LANGUAGES) {
    describe(language, () => {
      it.each([...NEW_KEYS, ...BORROWED_KEYS])('t(%s) is a real string, not the key', (key) => {
        const value = t(language, key)
        // t() returns the key itself when it is missing, which is how a raw
        // "pdf.treatmentPlan.total" would reach the printed page.
        expect(value, `${language}: ${key} is missing`).not.toBe(key)
        expect(typeof value).toBe('string')
        expect(value.trim().length).toBeGreaterThan(0)
      })

      it.each(NEW_KEYS)('%s is present in the dictionary source', (key) => {
        expect(typeof at(DICTS[language], key)).toBe('string')
      })
    })
  }

  it('the treatmentPlan block has the same keys in all three locales', () => {
    const keysOf = (dict: unknown) =>
      Object.keys((at(dict, 'pdf.treatmentPlan') ?? {}) as Record<string, unknown>).sort()
    expect(keysOf(en)).toEqual(keysOf(es))
    expect(keysOf(ar)).toEqual(keysOf(es))
    expect(keysOf(es).length).toBeGreaterThan(0)
  })

  it('is actually translated, not copied from Spanish', () => {
    // There is no fallback chain to hide an untranslated block, but there is
    // copy-paste: an en block left in Spanish would ship silently.
    // `total` is excluded: "Total" is the Spanish AND the English word, so an
    // inequality assertion on it would be a false guard, not a stricter one.
    for (const key of NEW_KEYS.filter((k) => k !== 'pdf.treatmentPlan.total')) {
      expect(t('en', key), `${key} was not translated to English`).not.toBe(t('es', key))
      expect(t('ar', key), `${key} was not translated to Arabic`).not.toBe(t('es', key))
    }
  })
})
