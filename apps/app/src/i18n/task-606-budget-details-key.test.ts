/**
 * Per-locale guard for #606: `budgets.details` (the metadata card heading).
 * `fallbackLng` is `es`, so a key missing from en.json or ar.json would render
 * Spanish and nothing would fail; read each resource file directly instead.
 */
import { describe, it, expect } from 'vitest'
import es from './locales/es.json'
import en from './locales/en.json'
import ar from './locales/ar.json'

const LOCALES = { es, en, ar } as const
type Budgets = { details?: unknown; notes?: unknown }
const budgetsOf = (code: keyof typeof LOCALES) =>
  (LOCALES[code] as unknown as { budgets: Budgets }).budgets

describe('budgets.details key (#606)', () => {
  it.each(['es', 'en', 'ar'] as const)('%s defines a non-empty budgets.details', (code) => {
    const v = budgetsOf(code).details
    expect(typeof v).toBe('string')
    expect((v as string).trim().length).toBeGreaterThan(0)
  })

  it('en and ar differ from the Spanish text, so a fallback would be visible', () => {
    expect(budgetsOf('en').details).not.toBe(budgetsOf('es').details)
    expect(budgetsOf('ar').details).not.toBe(budgetsOf('es').details)
  })

  it.each(['es', 'en', 'ar'] as const)('%s heading differs from the notes label', (code) => {
    expect(budgetsOf(code).details).not.toBe(budgetsOf(code).notes)
  })

  it('es keeps the notes label "Notas"', () => {
    expect(budgetsOf('es').notes).toBe('Notas')
  })
})
