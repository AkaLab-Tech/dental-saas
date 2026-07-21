import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import i18n from 'i18next'
import '@/i18n'
import { BudgetCard } from './BudgetCard'
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

function makeBudget(overrides: Partial<Budget> = {}): Budget {
  return {
    id: 'budget-1',
    tenantId: 'tenant-1',
    patientId: 'patient-1',
    createdById: 'user-1',
    status: 'APPROVED',
    notes: null,
    validUntil: '2026-12-31T00:00:00Z',
    totalAmount: '250.50',
    publicToken: null,
    publicTokenExpiresAt: null,
    isActive: true,
    createdAt: '2026-04-23T00:00:00Z',
    updatedAt: '2026-04-23T00:00:00Z',
    items: [
      {
        id: 'i1',
        budgetId: 'budget-1',
        description: 'A',
        toothNumber: null,
        quantity: 1,
        unitPrice: '100',
        totalPrice: '100',
        plannedAppointmentType: null,
        status: 'EXECUTED',
        notes: null,
        order: 0,
        createdAt: '',
        updatedAt: '',
      },
      {
        id: 'i2',
        budgetId: 'budget-1',
        description: 'B',
        toothNumber: null,
        quantity: 1,
        unitPrice: '150.50',
        totalPrice: '150.50',
        plannedAppointmentType: null,
        status: 'PENDING',
        notes: null,
        order: 1,
        createdAt: '',
        updatedAt: '',
      },
    ],
    ...overrides,
  }
}

function renderCard(budget: Budget, onDelete = vi.fn()) {
  return render(
    <MemoryRouter>
      <BudgetCard budget={budget} patientId="patient-1" onDelete={onDelete} />
    </MemoryRouter>
  )
}

describe('BudgetCard', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders total, status badge and progress', () => {
    canMock.mockReturnValue(true)
    renderCard(makeBudget())
    expect(screen.getByText(/250\.5/)).toBeInTheDocument()
    expect(screen.getByText('Aprobado')).toBeInTheDocument()
    expect(screen.getByText(/1.*de.*2/i)).toBeInTheDocument()
  })

  it('hides the delete option when user lacks BUDGETS_DELETE', () => {
    canMock.mockImplementation((p) => p !== Permission.BUDGETS_DELETE)
    renderCard(makeBudget())
    fireEvent.click(screen.getByLabelText('Actions'))
    expect(screen.getByText('Ver detalle')).toBeInTheDocument()
    expect(screen.queryByText('Eliminar presupuesto')).not.toBeInTheDocument()
  })

  it('shows delete and fires onDelete when user has BUDGETS_DELETE', () => {
    canMock.mockReturnValue(true)
    const onDelete = vi.fn()
    const b = makeBudget()
    renderCard(b, onDelete)
    fireEvent.click(screen.getByLabelText('Actions'))
    fireEvent.click(screen.getByText('Eliminar presupuesto'))
    expect(onDelete).toHaveBeenCalledWith(b)
  })

  it('shows the "Download PDF" action when user has BUDGETS_VIEW', () => {
    canMock.mockImplementation((p) => p === Permission.BUDGETS_VIEW)
    renderCard(makeBudget())
    fireEvent.click(screen.getByLabelText('Actions'))
    expect(screen.getByText('Descargar PDF')).toBeInTheDocument()
  })

  it('hides the "Download PDF" action when user lacks BUDGETS_VIEW', () => {
    canMock.mockImplementation((p) => p !== Permission.BUDGETS_VIEW)
    renderCard(makeBudget())
    fireEvent.click(screen.getByLabelText('Actions'))
    expect(screen.queryByText('Descargar PDF')).not.toBeInTheDocument()
  })

  it('calls downloadBudgetPdf with the budget id when "Download PDF" is clicked', async () => {
    canMock.mockReturnValue(true)
    downloadBudgetPdfMock.mockResolvedValue(undefined)
    const b = makeBudget({ id: 'budget-42' })
    renderCard(b)
    fireEvent.click(screen.getByLabelText('Actions'))
    fireEvent.click(screen.getByText('Descargar PDF'))
    await waitFor(() => {
      expect(downloadBudgetPdfMock).toHaveBeenCalledWith('budget-42')
    })
    expect(downloadBudgetPdfMock).toHaveBeenCalledTimes(1)
  })
})
