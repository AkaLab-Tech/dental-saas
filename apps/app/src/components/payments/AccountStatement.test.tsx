import { describe, it, expect, beforeAll } from 'vitest'
import { render, screen } from '@testing-library/react'
import i18n from 'i18next'
import '@/i18n'
import { AccountStatement } from './AccountStatement'
import { formatCurrency } from '@/lib/format'
import type { AccountStatement as AccountStatementData } from '@/lib/payment-api'

beforeAll(async () => {
  await i18n.changeLanguage('es')
})

// ============================================================================
// Helpers
// ============================================================================

function makeStatement(overrides: Partial<AccountStatementData> = {}): AccountStatementData {
  return {
    appointmentsDebt: 0,
    advancesCredit: 0,
    remainingBudgetProjection: 0,
    totalBilled: 0,
    totalPaid: 0,
    advancesTotal: 0,
    ...overrides,
  }
}

// Mirrors how PaymentSection derives its formatCurrency prop: tenant currency
// (fallback 'USD') baked in via a closure, never re-derived by AccountStatement
// itself (it has no store access — it only ever sees the function).
function fmtWith(currency?: string) {
  return (amount: number) => formatCurrency(amount, currency)
}

function renderStatement(
  statement: AccountStatementData,
  formatCurrencyFn: (amount: number) => string = fmtWith('USD')
) {
  return render(<AccountStatement statement={statement} formatCurrency={formatCurrencyFn} />)
}

function valueFor(label: string): string | null | undefined {
  const card = screen.getByText(label).closest('.rounded-lg') as HTMLElement
  return card.querySelectorAll('p')[1]?.textContent
}

// ============================================================================
// Tests
// ============================================================================

describe('AccountStatement', () => {
  describe('renders the three figures, individually labelled and visually separated', () => {
    it('shows appointmentsDebt, advancesCredit, and remainingBudgetProjection each with their own label', () => {
      renderStatement(
        makeStatement({ appointmentsDebt: 137, advancesCredit: 53, remainingBudgetProjection: 89 })
      )

      expect(screen.getByText('Deuda por consultas realizadas')).toBeInTheDocument()
      expect(screen.getByText('Saldo a favor')).toBeInTheDocument()
      expect(screen.getByText('Presupuesto restante')).toBeInTheDocument()

      expect(valueFor('Deuda por consultas realizadas')).toMatch(/USD\s*137\.00/)
      expect(valueFor('Saldo a favor')).toMatch(/USD\s*53\.00/)
      expect(valueFor('Presupuesto restante')).toMatch(/USD\s*89\.00/)
    })

    it('puts each figure in its own visually-distinct container', () => {
      renderStatement(
        makeStatement({ appointmentsDebt: 137, advancesCredit: 53, remainingBudgetProjection: 89 })
      )

      const debtCard = screen.getByText('Deuda por consultas realizadas').closest('.rounded-lg')
      const creditCard = screen.getByText('Saldo a favor').closest('.rounded-lg')
      const projectionCard = screen.getByText('Presupuesto restante').closest('.rounded-lg')

      expect(debtCard).toHaveClass('bg-amber-50')
      expect(creditCard).toHaveClass('bg-green-50')
      expect(projectionCard).toHaveClass('bg-gray-50')

      // Three distinct DOM containers, not one merged block.
      expect(debtCard).not.toBe(creditCard)
      expect(creditCard).not.toBe(projectionCard)
      expect(debtCard).not.toBe(projectionCard)
    })
  })

  describe('zero states', () => {
    it('renders all three figures as 0 in the tenant currency, not blank and not an error, when nothing is owed/credited/projected', () => {
      renderStatement(makeStatement())

      expect(valueFor('Deuda por consultas realizadas')).toMatch(/USD\s*0\.00/)
      expect(valueFor('Saldo a favor')).toMatch(/USD\s*0\.00/)
      expect(valueFor('Presupuesto restante')).toMatch(/USD\s*0\.00/)
    })

    it('does not apply the amber "debt owed" color to a zero appointmentsDebt', () => {
      renderStatement(makeStatement({ appointmentsDebt: 0 }))

      const debtValue = screen
        .getByText('Deuda por consultas realizadas')
        .closest('.rounded-lg')
        ?.querySelectorAll('p')[1]

      expect(debtValue).not.toHaveClass('text-amber-600')
    })
  })

  describe('currency formatting', () => {
    it('formats amounts in a non-USD tenant currency when provided', () => {
      renderStatement(
        makeStatement({ appointmentsDebt: 250, advancesCredit: 0, remainingBudgetProjection: 0 }),
        fmtWith('UYU')
      )

      expect(valueFor('Deuda por consultas realizadas')).toMatch(/UYU\s*250\.00/)
    })

    it('falls back to USD when no tenant currency is supplied to formatCurrency', () => {
      renderStatement(
        makeStatement({ appointmentsDebt: 250, advancesCredit: 0, remainingBudgetProjection: 0 }),
        fmtWith(undefined)
      )

      expect(valueFor('Deuda por consultas realizadas')).toMatch(/USD\s*250\.00/)
    })
  })

  describe('remaining-budget projection disclaimer and styling', () => {
    it('renders the "not a debt" disclaimer next to the projection figure', () => {
      renderStatement(makeStatement({ remainingBudgetProjection: 500 }))

      expect(
        screen.getByText('Proyección de tratamiento pendiente — no es deuda.')
      ).toBeInTheDocument()
    })

    it('does not style the projection figure like the debt figure, even when both are > 0', () => {
      renderStatement(makeStatement({ appointmentsDebt: 100, remainingBudgetProjection: 100 }))

      const debtValue = screen
        .getByText('Deuda por consultas realizadas')
        .closest('.rounded-lg')
        ?.querySelectorAll('p')[1]
      const projectionValue = screen
        .getByText('Presupuesto restante')
        .closest('.rounded-lg')
        ?.querySelectorAll('p')[1]

      expect(debtValue).toHaveClass('text-amber-600')
      expect(projectionValue).not.toHaveClass('text-amber-600')
      expect(projectionValue).not.toHaveClass('text-red-600')

      const projectionCard = screen.getByText('Presupuesto restante').closest('.rounded-lg')
      expect(projectionCard).not.toHaveClass('bg-amber-50')
      expect(projectionCard).not.toHaveClass('bg-red-50')
    })
  })

  // REGRESSION GUARD: a previous version rendered a "de las cuales X
  // entregadas" ("of which X were advances") hint under the credit figure,
  // using advancesTotal (sum of ALL active ADVANCE payments, applied or
  // not) as if it were a subset of advancesCredit (Math.max(0, totalPaid -
  // totalBilled), the unapplied leftover only). Whenever totalBilled > 0,
  // advancesTotal can legitimately exceed advancesCredit, so the hint read
  // as a bigger "subset" than the figure it sat under (reviewer repro:
  // "Saldo a favor USD 200.00 de las cuales USD 500.00 entregadas"). The
  // hint was removed entirely — the individual entregas are already listed
  // in the payments list below the statement. This must never come back.
  describe('does not render a stale/misleading fourth number under the credit figure', () => {
    it('never renders advancesTotal, even when it exceeds advancesCredit and totalBilled > 0', () => {
      // advancesCredit (200) < advancesTotal (500) is the realistic case:
      // totalBilled (300) > 0 means some advances were already applied,
      // leaving less credit than was ever deposited. 500 does not collide
      // with any other figure/formatted substring rendered by this
      // component (debt=0, projection=0, credit=200).
      const { container } = renderStatement(
        makeStatement({
          appointmentsDebt: 0,
          advancesCredit: 200,
          remainingBudgetProjection: 0,
          totalBilled: 300,
          totalPaid: 500,
          advancesTotal: 500,
        })
      )

      const rendered = container.textContent ?? ''

      // The correct figure (advancesCredit) renders — fails loudly if the
      // two numbers were ever swapped instead of the hint being removed.
      expect(valueFor('Saldo a favor')).toMatch(/USD\s*200\.00/)

      // The forbidden number (advancesTotal) must not appear anywhere.
      expect(rendered).not.toContain(formatCurrency(500, 'USD'))
      expect(rendered).not.toMatch(/500/)

      // No subset-implying copy in any language this component could render.
      expect(rendered).not.toMatch(/de las cuales/)
      expect(rendered).not.toMatch(/of which/)
      expect(rendered).not.toMatch(/منها/)

      // The credit card is back to exactly one value line (label + amount),
      // no secondary hint paragraph.
      const creditCard = screen.getByText('Saldo a favor').closest('.rounded-lg') as HTMLElement
      expect(creditCard.querySelectorAll('p')).toHaveLength(2)
    })
  })

  // LOAD-BEARING REGRESSION GUARD: appointmentsDebt, advancesCredit, and
  // remainingBudgetProjection must never be summed/diffed into a single
  // aggregate anywhere in the rendered output. A SCHEDULED costed appointment
  // can legitimately count towards both appointmentsDebt AND
  // remainingBudgetProjection at once, so any derived total would
  // double-count real money. Values below are chosen so that no pairwise
  // sum/difference of the three legitimate figures collides with another
  // legitimate figure, and no forbidden aggregate is a coincidental digit
  // substring of a legitimate one.
  describe('never aggregates the three figures into a single total', () => {
    it('renders only the three individual figures — no summed/diffed total appears anywhere', () => {
      const debt = 137
      const credit = 53
      const projection = 89

      const { container } = renderStatement(
        makeStatement({
          appointmentsDebt: debt,
          advancesCredit: credit,
          remainingBudgetProjection: projection,
          advancesTotal: 0,
        })
      )

      const rendered = container.textContent ?? ''

      // Legitimate figures are present.
      expect(rendered).toContain(formatCurrency(debt, 'USD'))
      expect(rendered).toContain(formatCurrency(credit, 'USD'))
      expect(rendered).toContain(formatCurrency(projection, 'USD'))

      // Forbidden aggregates (sums and absolute differences of every pair,
      // plus the grand total) must never appear.
      const forbidden = [
        debt + credit, // 190
        debt + projection, // 226
        credit + projection, // 142
        debt + credit + projection, // 279
        Math.abs(debt - credit), // 84
        Math.abs(debt - projection), // 48
        Math.abs(projection - credit), // 36
      ]

      for (const total of forbidden) {
        expect(rendered).not.toContain(formatCurrency(total, 'USD'))
      }
    })
  })
})
