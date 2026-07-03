import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Mock } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router'
import BudgetDetailPage from './BudgetDetailPage'
import { useBudgetsStore } from '@/stores/budgets.store'
import { useAuthStore } from '@/stores/auth.store'
import { usePermissions } from '@/hooks/usePermissions'
import { downloadBudgetPdf } from '@/lib/pdf-api'
import { shareBudget } from '@/lib/budget-api'
import type { Budget } from '@/lib/budget-api'

// Mock react-i18next — return the key so assertions are stable regardless of locale
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts?.executed !== undefined) return `${key} ${opts.executed}/${opts.total}`
      return key
    },
  }),
}))

vi.mock('@/stores/budgets.store')
vi.mock('@/stores/auth.store')
vi.mock('@/hooks/usePermissions')
vi.mock('@/lib/pdf-api')
vi.mock('@/lib/budget-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/budget-api')>('@/lib/budget-api')
  return {
    ...actual,
    shareBudget: vi.fn(),
  }
})

function makeBudget(overrides: Partial<Budget> = {}): Budget {
  return {
    id: 'budget-1',
    tenantId: 'tenant-1',
    patientId: 'patient-1',
    createdById: 'user-1',
    status: 'DRAFT',
    notes: null,
    validUntil: null,
    totalAmount: '180',
    publicToken: null,
    publicTokenExpiresAt: null,
    isActive: true,
    createdAt: '2026-04-23T00:00:00Z',
    updatedAt: '2026-04-23T00:00:00Z',
    items: [
      {
        id: 'item-1',
        budgetId: 'budget-1',
        description: 'Cleaning',
        toothNumber: null,
        quantity: 1,
        unitPrice: '80',
        totalPrice: '80',
        plannedAppointmentType: null,
        status: 'PENDING',
        notes: null,
        order: 0,
        createdAt: '2026-04-23T00:00:00Z',
        updatedAt: '2026-04-23T00:00:00Z',
      },
    ],
    ...overrides,
  }
}

function mockStore(budget: Budget) {
  ;(useBudgetsStore as unknown as Mock).mockReturnValue({
    currentBudget: budget,
    loading: false,
    error: null,
    fetchBudget: vi.fn().mockResolvedValue(budget),
    updateBudget: vi.fn(),
    addItem: vi.fn(),
    updateItem: vi.fn(),
    deleteItem: vi.fn(),
    clearError: vi.fn(),
  })
}

function mockAuth() {
  ;(useAuthStore as unknown as Mock).mockImplementation(
    (selector: (s: { user: { tenant: { currency: string } } }) => unknown) =>
      selector({ user: { tenant: { currency: 'USD' } } })
  )
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

describe('BudgetDetailPage — PDF download & share gating', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStore(makeBudget())
    mockAuth()
  })

  it('shows the Download PDF button for a viewer without BUDGETS_SHARE (e.g. STAFF)', () => {
    ;(usePermissions as unknown as Mock).mockReturnValue({
      can: () => false,
      canAny: () => false,
      canAll: () => false,
    })

    renderPage()

    expect(screen.getByText('budgets.downloadPdf')).toBeInTheDocument()
  })

  it('hides the Share link button for a viewer without BUDGETS_SHARE', () => {
    ;(usePermissions as unknown as Mock).mockReturnValue({
      can: () => false,
      canAny: () => false,
      canAll: () => false,
    })

    renderPage()

    expect(screen.queryByText('budgets.share.button')).not.toBeInTheDocument()
  })

  it('shows the Share link button when the user has BUDGETS_SHARE (e.g. CLINIC_ADMIN)', () => {
    ;(usePermissions as unknown as Mock).mockReturnValue({
      can: () => true,
      canAny: () => true,
      canAll: () => true,
    })

    renderPage()

    expect(screen.getByText('budgets.share.button')).toBeInTheDocument()
  })

  it('clicking Download PDF calls downloadBudgetPdf with the budget id', async () => {
    ;(usePermissions as unknown as Mock).mockReturnValue({
      can: () => true,
      canAny: () => true,
      canAll: () => true,
    })
    vi.mocked(downloadBudgetPdf).mockResolvedValue(undefined)

    renderPage()

    fireEvent.click(screen.getByText('budgets.downloadPdf'))

    await waitFor(() => {
      expect(downloadBudgetPdf).toHaveBeenCalledWith('budget-1')
    })
  })

  it('clicking Share generates a link and displays the copyable URL panel', async () => {
    ;(usePermissions as unknown as Mock).mockReturnValue({
      can: () => true,
      canAny: () => true,
      canAll: () => true,
    })
    vi.mocked(shareBudget).mockResolvedValue({
      token: 'abc123',
      url: 'http://localhost:5003/budget/abc123',
      expiresAt: null,
    })

    renderPage()

    fireEvent.click(screen.getByText('budgets.share.button'))

    await waitFor(() => {
      expect(shareBudget).toHaveBeenCalledWith('budget-1')
    })
    expect(await screen.findByDisplayValue('http://localhost:5003/budget/abc123')).toBeInTheDocument()
  })

  it('surfaces an error message when the share request fails', async () => {
    ;(usePermissions as unknown as Mock).mockReturnValue({
      can: () => true,
      canAny: () => true,
      canAll: () => true,
    })
    vi.mocked(shareBudget).mockRejectedValue(new Error('network down'))

    renderPage()

    fireEvent.click(screen.getByText('budgets.share.button'))

    expect(await screen.findByRole('alert')).toHaveTextContent('network down')
  })
})
