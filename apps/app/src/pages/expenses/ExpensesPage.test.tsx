import { describe, it, expect, vi, beforeEach, beforeAll, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import i18n from 'i18next'
import '@/i18n'
import type { Expense, ExpensesStats } from '@/lib/expense-api'

// ExpensesPage now renders every user-facing string through t(). Initialize
// the real i18n instance (Spanish, the app default) so assertions exercise
// the actual translated/interpolated output rather than raw keys — mirrors
// the pattern used by DoctorsPage.test.tsx for the same reason (task #325).
beforeAll(async () => {
  await i18n.changeLanguage('es')
})

// Mock functions
const mockFetchExpenses = vi.fn()
const mockFetchStats = vi.fn()
const mockCreateExpense = vi.fn()
const mockUpdateExpense = vi.fn()
const mockDeleteExpense = vi.fn()
const mockRestoreExpense = vi.fn()
const mockSetFilters = vi.fn()
const mockClearError = vi.fn()

// Mutable state
const mockExpensesState = {
  expenses: [] as Expense[],
  stats: null as ExpensesStats | null,
  total: 0,
  loading: false,
  error: null as string | null,
  filters: { isPaid: undefined as boolean | undefined },
}

// Mock the store
vi.mock('@/stores/expenses.store', () => ({
  useExpensesStore: () => ({
    expenses: mockExpensesState.expenses,
    stats: mockExpensesState.stats,
    total: mockExpensesState.total,
    loading: mockExpensesState.loading,
    error: mockExpensesState.error,
    filters: mockExpensesState.filters,
    fetchExpenses: mockFetchExpenses,
    fetchStats: mockFetchStats,
    createExpense: mockCreateExpense,
    updateExpense: mockUpdateExpense,
    deleteExpense: mockDeleteExpense,
    restoreExpense: mockRestoreExpense,
    setFilters: mockSetFilters,
    clearError: mockClearError,
  }),
}))

// Mock usePermissions hook to grant all permissions
vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => ({
    can: () => true,
    canAny: () => true,
    canAll: () => true,
  }),
}))

// Mock ExpenseCard component
vi.mock('@/components/expenses/ExpenseCard', () => ({
  ExpenseCard: ({ expense, onEdit, onDelete, onRestore, onTogglePaid }: any) => (
    <div data-testid={`expense-card-${expense.id}`}>
      <span>{expense.issuer}</span>
      <button onClick={() => onEdit(expense)}>Editar</button>
      <button onClick={() => onDelete(expense)}>Eliminar</button>
      {!expense.isActive && onRestore && (
        <button onClick={() => onRestore(expense)}>Restaurar</button>
      )}
      <button onClick={() => onTogglePaid(expense)}>Toggle Paid</button>
    </div>
  ),
}))

// Mock ExpenseFormModal component
vi.mock('@/components/expenses/ExpenseFormModal', () => ({
  ExpenseFormModal: ({ isOpen, onClose, onSubmit, expense }: any) => {
    if (!isOpen) return null
    return (
      <div data-testid="expense-form-modal" role="dialog">
        <h2>{expense ? 'Editar' : 'Nuevo'} Gasto</h2>
        <button onClick={onClose}>Cerrar</button>
        <button onClick={async () => {
          await onSubmit({
            issuer: 'Test Supplier',
            items: 'Test items',
            amount: 100,
            date: '2024-01-15',
          })
        }}>
          Guardar
        </button>
      </div>
    )
  },
}))

// Mock ConfirmDialog component
vi.mock('@/components/ui/ConfirmDialog', () => ({
  ConfirmDialog: ({ isOpen, onClose, onConfirm }: any) => {
    if (!isOpen) return null
    return (
      <div data-testid="confirm-dialog" role="dialog">
        <button onClick={onClose}>Cancelar</button>
        <button onClick={onConfirm}>Confirmar</button>
      </div>
    )
  },
}))

// Import after mocks
import { ExpensesPage } from './ExpensesPage'

function renderExpensesPage() {
  return render(
    <MemoryRouter>
      <ExpensesPage />
    </MemoryRouter>
  )
}

// Sample data
const mockExpense1: Expense = {
  id: '1',
  tenantId: 'tenant1',
  issuer: 'Dental Supply Co',
  items: 'Dental materials',
  amount: 500,
  date: '2024-01-15',
  isPaid: false,
  isActive: true,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
}

const mockExpense2: Expense = {
  id: '2',
  tenantId: 'tenant1',
  issuer: 'Equipment Inc',
  items: 'Dental equipment',
  amount: 1500,
  date: '2024-01-16',
  isPaid: true,
  isActive: true,
  createdAt: '2024-01-02T00:00:00Z',
  updatedAt: '2024-01-02T00:00:00Z',
}

const mockInactiveExpense: Expense = {
  id: '3',
  tenantId: 'tenant1',
  issuer: 'Old Supplier',
  items: 'Items',
  amount: 200,
  date: '2024-01-17',
  isPaid: false,
  isActive: false,
  createdAt: '2024-01-03T00:00:00Z',
  updatedAt: '2024-01-03T00:00:00Z',
}

const mockStats: ExpensesStats = {
  total: 3,
  paid: 1,
  unpaid: 2,
  totalAmount: 2200,
}

describe('ExpensesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mockExpensesState.expenses = []
    mockExpensesState.stats = null
    mockExpensesState.total = 0
    mockExpensesState.loading = false
    mockExpensesState.error = null
    mockExpensesState.filters = { isPaid: undefined }
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  describe('rendering', () => {
    it('should render the page title', () => {
      mockExpensesState.expenses = [mockExpense1]
      renderExpensesPage()

      expect(screen.getByRole('heading', { name: /^gastos$/i })).toBeInTheDocument()
      expect(screen.getByText(/gestiona los gastos de tu clínica/i)).toBeInTheDocument()
    })

    it('should render "Nuevo Gasto" button', () => {
      renderExpensesPage()

      expect(screen.getByRole('button', { name: /nuevo gasto/i })).toBeInTheDocument()
    })

    it('should display stats when available', () => {
      mockExpensesState.stats = mockStats
      mockExpensesState.expenses = [mockExpense1]
      renderExpensesPage()

      expect(screen.getByText(/3 gastos/i)).toBeInTheDocument()
      expect(screen.getAllByText(/2,200\.00/).length).toBeGreaterThan(0)
    })

    it('should render stats cards', () => {
      mockExpensesState.stats = mockStats
      mockExpensesState.expenses = [mockExpense1]
      renderExpensesPage()

      expect(screen.getAllByText(/total/i).length).toBeGreaterThan(0)
      expect(screen.getByText(/por pagar/i)).toBeInTheDocument()
      expect(screen.getByText(/pagados/i)).toBeInTheDocument()
      expect(screen.getByText(/monto total/i)).toBeInTheDocument()
    })
  })

  describe('data fetching', () => {
    it('should fetch expenses and stats on mount', () => {
      renderExpensesPage()

      expect(mockFetchExpenses).toHaveBeenCalled()
      expect(mockFetchStats).toHaveBeenCalled()
    })

    it('should debounce search', async () => {
      renderExpensesPage()

      mockFetchExpenses.mockClear()

      const searchInput = screen.getByPlaceholderText(/buscar por proveedor/i)
      fireEvent.change(searchInput, { target: { value: 'Dental' } })

      expect(mockFetchExpenses).not.toHaveBeenCalled()

      await act(async () => {
        vi.advanceTimersByTime(300)
      })

      expect(mockFetchExpenses).toHaveBeenCalledWith({ search: 'Dental' })
    })
  })

  describe('filters', () => {
    it('should toggle filters panel', () => {
      renderExpensesPage()

      const filterButton = screen.getByRole('button', { name: /filtros/i })
      fireEvent.click(filterButton)

      expect(screen.getByText(/estado de pago/i)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /^todos$/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /pagados/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /pendientes/i })).toBeInTheDocument()
    })

    it('should filter by paid status', () => {
      renderExpensesPage()

      fireEvent.click(screen.getByRole('button', { name: /filtros/i }))

      const paidButton = screen.getByRole('button', { name: /^pagados$/i })
      fireEvent.click(paidButton)

      expect(mockSetFilters).toHaveBeenCalledWith({ isPaid: true })
    })

    it('should clear all filters', () => {
      renderExpensesPage()

      fireEvent.click(screen.getByRole('button', { name: /filtros/i }))

      const allButton = screen.getByRole('button', { name: /^todos$/i })
      fireEvent.click(allButton)

      expect(mockSetFilters).toHaveBeenCalledWith({ isPaid: undefined })
    })
  })

  describe('loading state', () => {
    it('should show loading spinner', () => {
      mockExpensesState.loading = true
      mockExpensesState.expenses = []
      renderExpensesPage()

      const spinner = document.querySelector('.animate-spin')
      expect(spinner).toBeInTheDocument()
    })
  })

  describe('empty state', () => {
    it('should show empty state', () => {
      mockExpensesState.expenses = []
      renderExpensesPage()

      expect(screen.getByText(/no hay gastos/i)).toBeInTheDocument()
      expect(screen.getByText(/comienza registrando tu primer gasto/i)).toBeInTheDocument()
    })
  })

  describe('expense list', () => {
    it('should render list of expenses', () => {
      mockExpensesState.expenses = [mockExpense1, mockExpense2]
      renderExpensesPage()

      expect(screen.getByTestId('expense-card-1')).toBeInTheDocument()
      expect(screen.getByTestId('expense-card-2')).toBeInTheDocument()
    })
  })

  describe('create expense', () => {
    it('should open create modal', () => {
      renderExpensesPage()

      fireEvent.click(screen.getByRole('button', { name: /nuevo gasto/i }))

      expect(screen.getByTestId('expense-form-modal')).toBeInTheDocument()
    })

    it('should call createExpense', async () => {
      vi.useRealTimers()
      mockCreateExpense.mockResolvedValue(undefined)
      renderExpensesPage()

      fireEvent.click(screen.getByRole('button', { name: /nuevo gasto/i }))

      const saveButton = screen.getByRole('button', { name: /guardar/i })
      await act(async () => {
        fireEvent.click(saveButton)
        await new Promise(resolve => setTimeout(resolve, 50))
      })

      expect(mockCreateExpense).toHaveBeenCalled()

      vi.useFakeTimers()
    })
  })

  describe('edit expense', () => {
    it('should open edit modal', () => {
      mockExpensesState.expenses = [mockExpense1]
      renderExpensesPage()

      const editButton = screen.getAllByRole('button', { name: /editar/i })[0]
      fireEvent.click(editButton)

      expect(screen.getByTestId('expense-form-modal')).toBeInTheDocument()
    })

    it('should call updateExpense', async () => {
      vi.useRealTimers()
      mockExpensesState.expenses = [mockExpense1]
      mockUpdateExpense.mockResolvedValue(undefined)
      renderExpensesPage()

      fireEvent.click(screen.getAllByRole('button', { name: /editar/i })[0])

      const saveButton = screen.getByRole('button', { name: /guardar/i })
      await act(async () => {
        fireEvent.click(saveButton)
        await new Promise(resolve => setTimeout(resolve, 50))
      })

      expect(mockUpdateExpense).toHaveBeenCalled()

      vi.useFakeTimers()
    })
  })

  describe('delete expense', () => {
    it('should open confirm dialog', () => {
      mockExpensesState.expenses = [mockExpense1]
      renderExpensesPage()

      const deleteButton = screen.getAllByRole('button', { name: /eliminar/i })[0]
      fireEvent.click(deleteButton)

      expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument()
    })

    it('should call deleteExpense', async () => {
      vi.useRealTimers()
      mockExpensesState.expenses = [mockExpense1]
      mockDeleteExpense.mockResolvedValue(undefined)
      renderExpensesPage()

      fireEvent.click(screen.getAllByRole('button', { name: /eliminar/i })[0])

      const confirmButton = screen.getByRole('button', { name: /confirmar/i })
      await act(async () => {
        fireEvent.click(confirmButton)
        await new Promise(resolve => setTimeout(resolve, 50))
      })

      expect(mockDeleteExpense).toHaveBeenCalledWith('1')

      vi.useFakeTimers()
    })
  })

  describe('restore expense', () => {
    it('should call restoreExpense', async () => {
      vi.useRealTimers()
      mockExpensesState.expenses = [mockInactiveExpense]
      mockRestoreExpense.mockResolvedValue(undefined)
      renderExpensesPage()

      const restoreButton = screen.getByRole('button', { name: /restaurar/i })
      await act(async () => {
        fireEvent.click(restoreButton)
        await new Promise(resolve => setTimeout(resolve, 50))
      })

      expect(mockRestoreExpense).toHaveBeenCalledWith('3')

      vi.useFakeTimers()
    })
  })

  describe('toggle paid', () => {
    it('should call updateExpense with isPaid toggle', async () => {
      vi.useRealTimers()
      mockExpensesState.expenses = [mockExpense1]
      mockUpdateExpense.mockResolvedValue(undefined)
      renderExpensesPage()

      const toggleButton = screen.getByRole('button', { name: /toggle paid/i })
      await act(async () => {
        fireEvent.click(toggleButton)
        await new Promise(resolve => setTimeout(resolve, 50))
      })

      expect(mockUpdateExpense).toHaveBeenCalledWith('1', { isPaid: true })

      vi.useFakeTimers()
    })
  })

  describe('error handling', () => {
    it('should display error message', () => {
      mockExpensesState.error = 'Error loading expenses'
      renderExpensesPage()

      expect(screen.getByText(/error loading expenses/i)).toBeInTheDocument()
    })

    it('should clear error', () => {
      mockExpensesState.error = 'Error loading expenses'
      renderExpensesPage()

      const closeButton = screen.getByRole('button', { name: /cerrar/i })
      fireEvent.click(closeButton)

      expect(mockClearError).toHaveBeenCalled()
    })
  })
})
