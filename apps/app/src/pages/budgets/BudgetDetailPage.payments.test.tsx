/**
 * Task #613 guard 7 - a write that creates a payments row leaves the row
 * rendered. The REAL budgets store and the REAL detail page run; only the
 * HTTP-facing budget-api module is mocked. Marking a line EXECUTED answers with
 * a budget that has one more visit, and the page must show N+1 rows with the new
 * row's date and amount (a store that kept the previous `visits` stays at N).
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router'
import i18n from 'i18next'
import '@/i18n'
import BudgetDetailPage from './BudgetDetailPage'
import { useBudgetsStore } from '@/stores/budgets.store'
import type { BudgetWithVisits, BudgetVisit } from '@/lib/budget-api'

beforeAll(async () => {
  await i18n.changeLanguage('es')
})

const getBudgetMock = vi.fn()
const updateBudgetItemMock = vi.fn()

vi.mock('@/lib/budget-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/budget-api')>('@/lib/budget-api')
  return {
    ...actual,
    getBudget: (id: string) => getBudgetMock(id),
    updateBudgetItem: (b: string, i: string, d: unknown) => updateBudgetItemMock(b, i, d),
  }
})

vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => ({ can: () => true, canAny: () => true, canAll: () => true }),
}))

vi.mock('@/stores/auth.store', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({ user: { tenant: { currency: 'USD' } } }),
}))

vi.mock('@/lib/pdf-api', () => ({
  downloadBudgetPdf: vi.fn(),
  downloadPatientBudgetsPdf: vi.fn(),
}))

const norm = (s: string | null) => (s ?? '').replace(/ /g, ' ').trim()

const FIRST_VISIT: BudgetVisit = {
  appointmentId: 'appt-1',
  date: '2026-03-04T15:00:00.000Z',
  lines: [{ budgetItemId: 'item-1', description: 'Limpieza', notes: 'nota-1' }],
  charged: 100,
  covered: 100,
}

const NEW_VISIT: BudgetVisit = {
  appointmentId: 'appt-2',
  date: '2026-03-14T15:00:00.000Z',
  lines: [{ budgetItemId: 'item-2', description: 'Corona', notes: 'nota-2' }],
  charged: 250,
  covered: 0,
}

function makeBudget(visits: BudgetVisit[], item2Status: 'PENDING' | 'EXECUTED'): BudgetWithVisits {
  const base = {
    budgetId: 'budget-1',
    toothNumber: null,
    quantity: 1,
    plannedAppointmentType: null,
    notes: null,
    createdAt: '2026-04-23T00:00:00Z',
    updatedAt: '2026-04-23T00:00:00Z',
  }
  return {
    id: 'budget-1',
    tenantId: 'tenant-1',
    patientId: 'patient-1',
    createdById: null,
    status: 'APPROVED',
    notes: null,
    validUntil: null,
    totalAmount: '350',
    money: { total: 350, billed: visits.reduce((s, v) => s + v.charged, 0), covered: 100, remaining: 0, notBilled: 0 },
    visits,
    publicToken: null,
    publicTokenExpiresAt: null,
    isActive: true,
    createdAt: '2026-04-23T00:00:00Z',
    updatedAt: '2026-04-23T00:00:00Z',
    items: [
      { ...base, id: 'item-1', description: 'Limpieza', unitPrice: '100', totalPrice: '100', status: 'EXECUTED', order: 0 },
      { ...base, id: 'item-2', description: 'Corona', unitPrice: '250', totalPrice: '250', status: item2Status, order: 1 },
    ],
  }
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/patients/patient-1/budgets/budget-1']}>
      <Routes>
        <Route path="/patients/:patientId/budgets/:id" element={<BudgetDetailPage />} />
      </Routes>
    </MemoryRouter>
  )
}

function paymentsRows(): HTMLElement[] {
  const heading = screen.getByRole('heading', { name: 'Pagos' })
  const table = heading.parentElement!.querySelector('table')
  return table ? Array.from(table.querySelectorAll<HTMLElement>('tbody tr')) : []
}

describe('BudgetDetailPage payments table (#613)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useBudgetsStore.getState().reset()
  })

  it('mounts the payments table with one row per visit the budget carries', async () => {
    getBudgetMock.mockResolvedValue(makeBudget([FIRST_VISIT], 'PENDING'))
    renderPage()
    await screen.findByRole('heading', { name: 'Pagos' })
    expect(paymentsRows()).toHaveLength(1)
  })

  it('GUARD 7 - marking a line EXECUTED takes the table from 1 row to 2', async () => {
    getBudgetMock.mockResolvedValue(makeBudget([FIRST_VISIT], 'PENDING'))
    updateBudgetItemMock.mockResolvedValue(makeBudget([FIRST_VISIT, NEW_VISIT], 'EXECUTED'))
    renderPage()
    await screen.findByRole('heading', { name: 'Pagos' })
    expect(paymentsRows()).toHaveLength(1)

    // Edit the second line (Corona), set it EXECUTED, save.
    const editButtons = await screen.findAllByRole('button', { name: 'Editar' })
    fireEvent.click(editButtons[1])
    const statusSelect = screen
      .getAllByRole('combobox')
      .find((el) => (el as HTMLSelectElement).value === 'PENDING') as HTMLSelectElement
    fireEvent.change(statusSelect, { target: { value: 'EXECUTED' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(paymentsRows()).toHaveLength(2))
    expect(updateBudgetItemMock).toHaveBeenCalledTimes(1)
    expect(updateBudgetItemMock.mock.calls[0][2]).toMatchObject({ status: 'EXECUTED' })
  })

  it('GUARD 7 - after that write the NEW row shows its own date (14/3/2026) and amount (USD 250.00)', async () => {
    getBudgetMock.mockResolvedValue(makeBudget([FIRST_VISIT], 'PENDING'))
    updateBudgetItemMock.mockResolvedValue(makeBudget([FIRST_VISIT, NEW_VISIT], 'EXECUTED'))
    renderPage()
    await screen.findByRole('heading', { name: 'Pagos' })

    const editButtons = await screen.findAllByRole('button', { name: 'Editar' })
    fireEvent.click(editButtons[1])
    const statusSelect = screen
      .getAllByRole('combobox')
      .find((el) => (el as HTMLSelectElement).value === 'PENDING') as HTMLSelectElement
    fireEvent.change(statusSelect, { target: { value: 'EXECUTED' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(paymentsRows()).toHaveLength(2))
    const cells = Array.from(paymentsRows()[1].querySelectorAll('td')).map((td) => norm(td.textContent))
    expect(cells[0]).toBe('14/3/2026')
    expect(cells[3]).toBe('USD 250.00')
    // The first row is untouched.
    const first = Array.from(paymentsRows()[0].querySelectorAll('td')).map((td) => norm(td.textContent))
    expect(first[0]).toBe('4/3/2026')
    expect(first[3]).toBe('USD 100.00')
    expect(within(paymentsRows()[1]).getByText('nota-2')).toBeInTheDocument()
  })

  it('the store replaces currentBudget.visits with the ones the write answered', async () => {
    useBudgetsStore.setState({ currentBudget: makeBudget([FIRST_VISIT], 'PENDING') })
    updateBudgetItemMock.mockResolvedValue(makeBudget([FIRST_VISIT, NEW_VISIT], 'EXECUTED'))
    await useBudgetsStore.getState().updateItem('budget-1', 'item-2', { status: 'EXECUTED' })
    expect(useBudgetsStore.getState().currentBudget?.visits.map((v) => v.appointmentId)).toEqual([
      'appt-1',
      'appt-2',
    ])
  })
})
