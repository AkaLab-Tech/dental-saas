/**
 * i18n key-parity check for task #326 (i18n migration: Labworks + Expenses).
 * Verifies the entire `labworks.*` and `expenses.*` trees have an IDENTICAL
 * leaf-key set across all three shipped locale files (es/en/ar) — no
 * missing/extra keys in any locale — plus non-empty values for every key
 * this migration added, and distinct translations for the subset of keys
 * that are genuine prose (labels/messages) rather than shared literals
 * (numeric placeholders, cognates) that are expected to repeat across
 * locales by design.
 *
 * Follows the pattern established by spike-213-keys.test.ts (#213),
 * task-309-advance-payment-keys.test.ts (#309), and
 * task-325-doctors-keys.test.ts (#325).
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

// Every key added by the #326 migration (LabworkCard, LabworkFormModal,
// LabworksPage), per the implementer's diff to locales/*.json. The
// pre-existing labworks.* keys (title, status.*, phone, dateRange, etc.)
// predate this migration and are covered by the deep key-parity check below.
const LABWORKS_NEW_KEYS = [
  'searchPlaceholder',
  'paymentStatus',
  'deliveryStatus',
  'paidFilter',
  'unpaidFilter',
  'filterDelivered',
  'pendingDelivery',
  'notDelivered',
  'stats.total',
  'stats.unpaid',
  'stats.totalValue',
  'emptyState.filtered',
  'emptyState.hint',
  'createLabwork',
  'statsCount',
  'pagination',
  'deleteLabwork',
  'deleteConfirmMessage',
  'toast.restored',
  'toast.updated',
  'toast.created',
  'toast.deleted',
  'form.editTitle',
  'form.createTitle',
  'form.patientLabel',
  'form.labLabel',
  'form.labPlaceholder',
  'form.dateLabel',
  'form.priceLabel',
  'form.pricePlaceholder',
  'form.notesLabel',
  'form.notesPlaceholder',
  'form.saveChanges',
] as const

// Subset of LABWORKS_NEW_KEYS that are genuine translated prose — expected
// to have a distinct string per locale. Excludes:
// - stats.total: "Total" is a Spanish/English cognate (both literally
//   "Total"); ar is distinct ("الإجمالي"). Not a copy-paste miss.
// - form.pricePlaceholder: shared numeric placeholder "0.00" across all
//   three locales by design (not "translated" prose).
const LABWORKS_DISTINCT_PER_LOCALE_KEYS = LABWORKS_NEW_KEYS.filter(
  (key) => key !== 'stats.total' && key !== 'form.pricePlaceholder'
)

// Every key added by the #326 migration (ExpenseCard, ExpenseFormModal,
// ExpensesPage), per the implementer's diff to locales/*.json.
const EXPENSES_NEW_KEYS = [
  'searchPlaceholder',
  'paymentStatus',
  'pendingFilter',
  'stats.total',
  'stats.unpaid',
  'stats.paid',
  'stats.totalAmount',
  'emptyState.filtered',
  'emptyState.hint',
  'createExpense',
  'statsCount',
  'pagination',
  'deleteExpense',
  'deleteConfirmMessage',
  'toast.restored',
  'toast.updated',
  'toast.created',
  'toast.deleted',
  'issuerLabel',
  'issuerPlaceholder',
  'dateLabel',
  'amountLabel',
  'amountPlaceholder',
  'itemsLabel',
  'itemPlaceholder',
  'addItem',
  'tagsLabel',
  'newTagPlaceholder',
  'notesLabel',
  'notesPlaceholder',
  'saveChanges',
] as const

// Subset of EXPENSES_NEW_KEYS that are genuine translated prose. Excludes:
// - stats.total: same es/en cognate as labworks.stats.total above.
// - amountPlaceholder: shared numeric placeholder "0.00" across all three
//   locales by design.
const EXPENSES_DISTINCT_PER_LOCALE_KEYS = EXPENSES_NEW_KEYS.filter(
  (key) => key !== 'stats.total' && key !== 'amountPlaceholder'
)

describe('task #326 i18n key parity — labworks.*', () => {
  describe.each(LABWORKS_NEW_KEYS)('key "labworks.%s"', (key) => {
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
  })

  describe.each(LABWORKS_DISTINCT_PER_LOCALE_KEYS)('key "labworks.%s" (translatable prose)', (key) => {
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

describe('task #326 i18n key parity — expenses.*', () => {
  describe.each(EXPENSES_NEW_KEYS)('key "expenses.%s"', (key) => {
    it('exists as a non-empty string in es, en, and ar', () => {
      for (const [code, dict] of Object.entries(locales)) {
        const value = getByPath((dict as { expenses: unknown }).expenses, key)
        expect(value, `${code}.json expenses.${key} is missing`).toBeTypeOf('string')
        expect(
          (value as string).length,
          `${code}.json expenses.${key} has an empty value`
        ).toBeGreaterThan(0)
      }
    })
  })

  describe.each(EXPENSES_DISTINCT_PER_LOCALE_KEYS)('key "expenses.%s" (translatable prose)', (key) => {
    it('has a distinct value per locale (no locale silently reusing another’s string)', () => {
      const values = Object.values(locales).map(
        (dict) => getByPath((dict as { expenses: unknown }).expenses, key) as string
      )
      const unique = new Set(values)
      expect(
        unique.size,
        `expected 3 distinct translations for expenses.${key}, got ${JSON.stringify(values)}`
      ).toBe(3)
    })
  })

  it('has an IDENTICAL leaf-key set under expenses.* across es, en, and ar (no missing/extra keys)', () => {
    const keySets = Object.entries(locales).map(([code, dict]) => ({
      code,
      keys: collectLeafPaths((dict as { expenses: unknown }).expenses).sort(),
    }))
    const [reference, ...rest] = keySets
    for (const other of rest) {
      const missingInOther = reference.keys.filter((k) => !other.keys.includes(k))
      const extraInOther = other.keys.filter((k) => !reference.keys.includes(k))
      expect(
        missingInOther,
        `${other.code}.json is missing expenses.* keys present in ${reference.code}.json`
      ).toEqual([])
      expect(
        extraInOther,
        `${other.code}.json has extra expenses.* keys not present in ${reference.code}.json`
      ).toEqual([])
    }
  })
})
