import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import i18n from 'i18next'
import '@/i18n'
import { PatientBudgetPdfButton } from './PatientBudgetPdfButton'
import { useBudgetsStore } from '@/stores/budgets.store'
import type { Budget } from '@/lib/budget-api'
import { Permission } from '@dental/shared'

beforeAll(async () => {
  await i18n.changeLanguage('es')
})

const canMock = vi.fn()
const downloadBudgetPdfMock = vi.fn()

vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => ({
    can: (perm: Permission) => canMock(perm),
    canAny: () => false,
    canAll: () => false,
  }),
}))

vi.mock('@/stores/auth.store', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({ user: { tenant: { currency: 'USD' } } }),
}))

vi.mock('@/lib/pdf-api', () => ({
  downloadBudgetPdf: (budgetId: string) => downloadBudgetPdfMock(budgetId),
}))

// Every field that identifies a budget differs, so a picker that always
// returns the first (or last) item is detectable.
function makeBudget(overrides: Partial<Budget> = {}): Budget {
  return {
    id: 'budget-1',
    tenantId: 'tenant-1',
    patientId: 'patient-A',
    createdById: 'user-1',
    status: 'APPROVED',
    notes: null,
    validUntil: '2026-12-31T00:00:00Z',
    totalAmount: '250.50',
    publicToken: null,
    publicTokenExpiresAt: null,
    isActive: true,
    createdAt: '2026-03-15T12:00:00Z',
    updatedAt: '2026-03-15T12:00:00Z',
    items: [],
    ...overrides,
  }
}

const newest = makeBudget({
  id: 'budget-newest',
  totalAmount: '999.00',
  status: 'DRAFT',
  createdAt: '2026-08-20T12:00:00Z',
})
const middle = makeBudget({
  id: 'budget-middle',
  totalAmount: '420.75',
  status: 'PARTIAL',
  createdAt: '2026-06-10T12:00:00Z',
})
const oldest = makeBudget({
  id: 'budget-oldest',
  totalAmount: '150.00',
  status: 'COMPLETED',
  createdAt: '2026-01-05T12:00:00Z',
})

function seed(budgets: Budget[], patientId: string | null = 'patient-A', loading = false) {
  useBudgetsStore.setState({ budgets, currentPatientId: patientId, loading })
}

function renderButton(patientId = 'patient-A', onError = vi.fn()) {
  render(<PatientBudgetPdfButton patientId={patientId} onError={onError} />)
  return onError
}

describe('PatientBudgetPdfButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    canMock.mockReturnValue(true)
    downloadBudgetPdfMock.mockResolvedValue(undefined)
    seed([])
  })

  it('with one budget, a single click downloads that budget with no menu', async () => {
    seed([middle])
    renderButton()
    fireEvent.click(screen.getByRole('button', { name: /Exportar presupuesto/ }))
    await waitFor(() => expect(downloadBudgetPdfMock).toHaveBeenCalledWith('budget-middle'))
    expect(downloadBudgetPdfMock).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('with two budgets, clicking the button downloads nothing and opens a menu with one row per budget', () => {
    seed([newest, oldest])
    renderButton()
    fireEvent.click(screen.getByRole('button', { name: /Exportar presupuesto/ }))
    expect(downloadBudgetPdfMock).not.toHaveBeenCalled()
    const items = within(screen.getByRole('menu')).getAllByRole('menuitem')
    expect(items).toHaveLength(2)
  })

  it('with two budgets, the user picks: the second row downloads the second budget id', async () => {
    seed([newest, oldest])
    renderButton()
    fireEvent.click(screen.getByRole('button', { name: /Exportar presupuesto/ }))
    const items = screen.getAllByRole('menuitem')
    fireEvent.click(items[1])
    await waitFor(() => expect(downloadBudgetPdfMock).toHaveBeenCalledWith('budget-oldest'))
    expect(downloadBudgetPdfMock).toHaveBeenCalledTimes(1)
    expect(downloadBudgetPdfMock).not.toHaveBeenCalledWith('budget-newest')
    // the menu closes after choosing
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('with three budgets, each row downloads its own id', async () => {
    seed([newest, middle, oldest])
    renderButton()
    fireEvent.click(screen.getByRole('button', { name: /Exportar presupuesto/ }))
    fireEvent.click(screen.getAllByRole('menuitem')[1])
    await waitFor(() => expect(downloadBudgetPdfMock).toHaveBeenCalledTimes(1))
    expect(downloadBudgetPdfMock).toHaveBeenLastCalledWith('budget-middle')
    fireEvent.click(screen.getByRole('button', { name: /Exportar presupuesto/ }))
    fireEvent.click(screen.getAllByRole('menuitem')[0])
    await waitFor(() => expect(downloadBudgetPdfMock).toHaveBeenCalledTimes(2))
    expect(downloadBudgetPdfMock).toHaveBeenLastCalledWith('budget-newest')
  })

  it('each menu row shows its own total, creation date and status', () => {
    seed([newest, oldest])
    renderButton()
    fireEvent.click(screen.getByRole('button', { name: /Exportar presupuesto/ }))
    const [first, second] = screen.getAllByRole('menuitem')
    expect(first).toHaveTextContent('USD 999.00')
    expect(first).toHaveTextContent(/Creado el 20.*ago.*2026/)
    expect(first).toHaveTextContent('Borrador')
    expect(second).toHaveTextContent('USD 150.00')
    expect(second).toHaveTextContent(/Creado el 5.*ene.*2026/)
    expect(second).toHaveTextContent('Completado')
  })

  it('with no budgets, renders nothing and exports nothing', () => {
    seed([])
    renderButton()
    // Behaviour first: clicking whatever is offered must not export anything.
    for (const button of screen.queryAllByRole('button')) {
      try {
        fireEvent.click(button)
      } catch {
        // a control with nothing to export may throw; the assertions below still apply
      }
    }
    expect(downloadBudgetPdfMock).not.toHaveBeenCalled()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('without BUDGETS_VIEW, renders nothing even when budgets exist', () => {
    canMock.mockImplementation((p) => p !== Permission.BUDGETS_VIEW)
    seed([newest, oldest])
    renderButton()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(downloadBudgetPdfMock).not.toHaveBeenCalled()
  })

  it('asks for BUDGETS_VIEW specifically', () => {
    seed([middle])
    renderButton()
    expect(canMock).toHaveBeenCalledWith(Permission.BUDGETS_VIEW)
  })

  it("does not leak another patient's budgets onto this record", () => {
    seed([newest, oldest], 'patient-A')
    renderButton('patient-B')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(downloadBudgetPdfMock).not.toHaveBeenCalled()
  })

  it('renders nothing while the list for this patient is still loading', () => {
    seed([newest], 'patient-A', true)
    renderButton('patient-A')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('reports a failed download through onError with the error message', async () => {
    downloadBudgetPdfMock.mockRejectedValue(new Error('boom'))
    seed([middle])
    const onError = renderButton()
    fireEvent.click(screen.getByRole('button', { name: /Exportar presupuesto/ }))
    await waitFor(() => expect(onError).toHaveBeenCalledWith('boom'))
  })
})
