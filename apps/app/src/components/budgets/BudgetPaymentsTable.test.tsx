/**
 * Task #613 - the payments table of a budget: one row per paying visit.
 *
 * Runs against the real i18n (Spanish) so the empty-state message is checked as
 * rendered text, not as a key. Amounts, dates, descriptions and notes differ per
 * visit so a table that repeats the first row, or reads one field in place of
 * another, goes red. The row count is asserted in its own `it()`.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import i18n from 'i18next'
import '@/i18n'
import { BudgetPaymentsTable } from './BudgetPaymentsTable'
import type { BudgetVisit } from '@/lib/budget-api'

beforeAll(async () => {
  await i18n.changeLanguage('es')
})

const VISITS: BudgetVisit[] = [
  {
    appointmentId: 'appt-1',
    date: '2026-03-04T15:00:00.000Z',
    lines: [{ budgetItemId: 'item-1', description: 'Limpieza', notes: 'nota-del-vinculo-1' }],
    charged: 100,
    covered: 100,
  },
  {
    appointmentId: 'appt-2',
    date: '2026-03-14T15:00:00.000Z',
    lines: [
      { budgetItemId: 'item-2', description: 'Corona', notes: 'nota-del-vinculo-2' },
      { budgetItemId: 'item-3', description: 'Radiografía', notes: null },
    ],
    charged: 250,
    covered: 0,
  },
]

const norm = (s: string | null) => (s ?? '').replace(/\u00a0/g, ' ').trim()

function bodyRows(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('tbody tr'))
}

describe('BudgetPaymentsTable', () => {
  it('renders exactly two rows for two paying visits', () => {
    const { container } = render(<BudgetPaymentsTable visits={VISITS} currency="USD" />)
    expect(bodyRows(container)).toHaveLength(2)
  })

  it('shows each row with its own date and its own charged and covered amounts', () => {
    const { container } = render(<BudgetPaymentsTable visits={VISITS} currency="USD" />)
    const [first, second] = bodyRows(container).map((r) =>
      Array.from(r.querySelectorAll('td')).map((td) => norm(td.textContent))
    )
    expect(first[0]).toBe('4/3/2026')
    expect(first[3]).toBe('USD 100.00')
    expect(first[4]).toBe('USD 100.00')
    expect(second[0]).toBe('14/3/2026')
    expect(second[3]).toBe('USD 250.00')
    expect(second[4]).toBe('USD 0.00')
  })

  it('shows the line descriptions and the association notes (not an empty cell) on the row', () => {
    const { container } = render(<BudgetPaymentsTable visits={VISITS} currency="USD" />)
    const [first, second] = bodyRows(container)
    const cells = (row: HTMLElement) => Array.from(row.querySelectorAll('td'))
    expect(norm(cells(first)[1].textContent)).toBe('Limpieza')
    expect(norm(cells(first)[2].textContent)).toBe('nota-del-vinculo-1')
    expect(norm(cells(second)[1].textContent)).toBe('CoronaRadiografía')
    expect(norm(cells(second)[2].textContent)).toBe('nota-del-vinculo-2')
  })

  it('a visit with charged > 0 and covered 0 still renders its row', () => {
    const { container } = render(<BudgetPaymentsTable visits={[VISITS[1]]} currency="USD" />)
    expect(bodyRows(container)).toHaveLength(1)
  })

  it('renders the column headings', () => {
    render(<BudgetPaymentsTable visits={VISITS} currency="USD" />)
    const head = screen.getByRole('table')
    for (const label of ['Fecha', 'Qué se hizo', 'Notas', 'Cobrado', 'Abonado']) {
      expect(within(head).getByText(label, { selector: 'th' })).toBeInTheDocument()
    }
  })

  it('with no visits renders the empty-state message, not a bare heading', () => {
    render(<BudgetPaymentsTable visits={[]} currency="USD" />)
    expect(screen.getByRole('heading', { name: 'Pagos' })).toBeInTheDocument()
    expect(screen.getByText('Aún no hay visitas con cobro en este presupuesto.')).toBeVisible()
  })

  it('with no visits renders no data rows', () => {
    const { container } = render(<BudgetPaymentsTable visits={[]} currency="USD" />)
    expect(bodyRows(container)).toHaveLength(0)
  })
})
