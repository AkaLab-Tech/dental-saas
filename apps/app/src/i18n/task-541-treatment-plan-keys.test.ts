/**
 * i18n key guard for #541 (the whole-treatment-plan export).
 *
 * `fallbackLng` is `es`, so a key missing from en.json or ar.json renders
 * SPANISH to an English or Arabic operator and nothing fails — that is #543.
 * A per-locale presence check is therefore the only way a missing key is
 * visible at all.
 *
 * Follows task-513-paid-amount-hint-keys.test.ts.
 */
import { describe, it, expect } from 'vitest'
import { t } from '@dental/shared'
import es from './locales/es.json'
import en from './locales/en.json'
import ar from './locales/ar.json'

const LOCALES = { es, en, ar } as const
type Code = keyof typeof LOCALES

/** Keys PatientBudgetPdfButton renders after the #541 inversion. */
const BUDGET_KEYS = [
  'exportPdf', // the PRIMARY action: the whole plan
  'exportPdfPlanError', // new in #541
  'exportPdfIndividual', // new in #541: the menu header
  'exportPdfChoose', // kept: the chevron's accessible name and the menu label
  'exportPdfError', // kept: the per-budget failure
] as const

/** The treatment-plan block the PDF itself prints, in @dental/shared. */
const PDF_KEYS = [
  'pdf.treatmentPlan.title',
  'pdf.treatmentPlan.planFor',
  'pdf.treatmentPlan.itemsCount',
  'pdf.treatmentPlan.noItems',
  'pdf.treatmentPlan.total',
  'pdf.treatmentPlan.footer',
] as const

function budgets(dict: unknown): Record<string, unknown> {
  return (dict as { budgets: Record<string, unknown> }).budgets
}

describe('#541 treatment plan i18n keys', () => {
  for (const code of Object.keys(LOCALES) as Code[]) {
    describe(code, () => {
      it.each(BUDGET_KEYS)('budgets.%s is a non-empty string', (key) => {
        const value = budgets(LOCALES[code])[key]
        expect(typeof value, `${code}.json is missing budgets.${key}`).toBe('string')
        expect(String(value).trim().length).toBeGreaterThan(0)
      })
    })
  }

  it.each(['en', 'ar'] as const)(
    'the %s keys differ from Spanish, so a fallback to es would be visible',
    (code) => {
      for (const key of BUDGET_KEYS) {
        expect(
          budgets(LOCALES[code])[key],
          `${code}.json budgets.${key} is identical to Spanish — the es fallback hides a missing key`
        ).not.toBe(budgets(es)[key])
      }
    }
  )

  it('the primary action is named after the treatment plan, not a single budget', () => {
    // The control downloads every budget at once since #541; the old copy
    // ("Exportar presupuesto" / "Export budget") described the inverse.
    expect(budgets(es).exportPdf).toContain('plan')
    expect(budgets(en).exportPdf).toContain('plan')
    expect(budgets(ar).exportPdf).toContain('خطة')
  })

  it.each(PDF_KEYS)('%s resolves in es, en and ar through @dental/shared', (key) => {
    // The shared t() has NO fallback: a missing key is printed verbatim onto
    // the patient's PDF. It reads the built package, so this also catches a
    // stale packages/shared/dist.
    for (const language of ['es', 'en', 'ar'] as const) {
      const value = t(language, key)
      expect(value, `${language}: ${key} is missing from @dental/shared`).not.toBe(key)
      expect(String(value).trim().length).toBeGreaterThan(0)
    }
  })
})
