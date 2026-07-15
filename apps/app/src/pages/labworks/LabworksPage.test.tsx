import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import type { Labwork, LabworksStats } from '@/lib/labwork-api'

// Mock functions
const mockFetchLabworks = vi.fn()
const mockFetchStats = vi.fn()
const mockCreateLabwork = vi.fn()
const mockUpdateLabwork = vi.fn()
const mockDeleteLabwork = vi.fn()
const mockRestoreLabwork = vi.fn()
const mockSetFilters = vi.fn()
const mockClearError = vi.fn()

// Mutable state
const mockLabworksState = {
  labworks: [] as Labwork[],
  stats: null as LabworksStats | null,
  total: 0,
  loading: false,
  error: null as string | null,
  filters: {
    isPaid: undefined as boolean | undefined,
    isDelivered: undefined as boolean | undefined,
    overdue: undefined as boolean | undefined,
    from: undefined as string | undefined,
    to: undefined as string | undefined,
  },
}

// Mock the store
vi.mock('@/stores/labworks.store', () => ({
  useLabworksStore: () => ({
    labworks: mockLabworksState.labworks,
    stats: mockLabworksState.stats,
    total: mockLabworksState.total,
    loading: mockLabworksState.loading,
    error: mockLabworksState.error,
    filters: mockLabworksState.filters,
    fetchLabworks: mockFetchLabworks,
    fetchStats: mockFetchStats,
    createLabwork: mockCreateLabwork,
    updateLabwork: mockUpdateLabwork,
    deleteLabwork: mockDeleteLabwork,
    restoreLabwork: mockRestoreLabwork,
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

// Mock LabworkCard component
vi.mock('@/components/labworks/LabworkCard', () => ({
  LabworkCard: ({ labwork, onEdit, onDelete, onRestore, onTogglePaid, onToggleDelivered }: any) => (
    <div data-testid={`labwork-card-${labwork.id}`}>
      <span>{labwork.lab}</span>
      <button onClick={() => onEdit(labwork)}>Editar</button>
      <button onClick={() => onDelete(labwork)}>Eliminar</button>
      {!labwork.isActive && onRestore && (
        <button onClick={() => onRestore(labwork)}>Restaurar</button>
      )}
      <button onClick={() => onTogglePaid(labwork)}>Toggle Paid</button>
      <button onClick={() => onToggleDelivered(labwork)}>Toggle Delivered</button>
    </div>
  ),
}))

// Mock LabworkFormModal component
vi.mock('@/components/labworks/LabworkFormModal', () => ({
  LabworkFormModal: ({ isOpen, onClose, onSubmit, labwork }: any) => {
    if (!isOpen) return null
    return (
      <div data-testid="labwork-form-modal" role="dialog">
        <h2>{labwork ? 'Editar' : 'Nuevo'} Trabajo</h2>
        <button onClick={onClose}>Cerrar</button>
        <button onClick={async () => {
          await onSubmit({
            lab: 'Test Lab',
            patientId: 'patient1',
            description: 'Test description',
            value: 200,
            entryDate: '2024-01-15',
            expectedDeliveryDate: '2024-01-20',
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

// Mock exportLabworks so the export button test doesn't hit apiClient/the DOM download path
const mockExportLabworks = vi.fn()
vi.mock('@/lib/labwork-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/labwork-api')>('@/lib/labwork-api')
  return {
    ...actual,
    exportLabworks: (...args: unknown[]) => mockExportLabworks(...args),
  }
})

// Import after mocks
import { LabworksPage } from './LabworksPage'

function renderLabworksPage() {
  return render(
    <MemoryRouter>
      <LabworksPage />
    </MemoryRouter>
  )
}

// Sample data
const mockLabwork1: Labwork = {
  id: '1',
  tenantId: 'tenant1',
  lab: 'Premium Lab',
  patientId: 'patient1',
  patientName: 'John Doe',
  description: 'Crown',
  value: 300,
  entryDate: '2024-01-15',
  expectedDeliveryDate: '2024-01-20',
  isPaid: false,
  isDelivered: false,
  isActive: true,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
}

const mockLabwork2: Labwork = {
  id: '2',
  tenantId: 'tenant1',
  lab: 'Fast Lab',
  patientId: 'patient2',
  patientName: 'Jane Smith',
  description: 'Bridge',
  value: 500,
  entryDate: '2024-01-16',
  expectedDeliveryDate: '2024-01-21',
  isPaid: true,
  isDelivered: true,
  isActive: true,
  createdAt: '2024-01-02T00:00:00Z',
  updatedAt: '2024-01-02T00:00:00Z',
}

const mockInactiveLabwork: Labwork = {
  id: '3',
  tenantId: 'tenant1',
  lab: 'Old Lab',
  patientId: 'patient3',
  patientName: 'Bob Johnson',
  description: 'Implant',
  value: 1000,
  entryDate: '2024-01-17',
  expectedDeliveryDate: '2024-01-22',
  isPaid: false,
  isDelivered: false,
  isActive: false,
  createdAt: '2024-01-03T00:00:00Z',
  updatedAt: '2024-01-03T00:00:00Z',
}

const mockStats: LabworksStats = {
  total: 3,
  pending: 2,
  delivered: 1,
  unpaid: 2,
  overdue: 1,
  totalValue: 1800,
}

describe('LabworksPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mockLabworksState.labworks = []
    mockLabworksState.stats = null
    mockLabworksState.total = 0
    mockLabworksState.loading = false
    mockLabworksState.error = null
    mockLabworksState.filters = {
      isPaid: undefined,
      isDelivered: undefined,
      overdue: undefined,
      from: undefined,
      to: undefined,
    }
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  describe('rendering', () => {
    it('should render the page title', () => {
      mockLabworksState.labworks = [mockLabwork1]
      renderLabworksPage()

      expect(screen.getByRole('heading', { name: /^trabajos de laboratorio$/i })).toBeInTheDocument()
      expect(screen.getByText(/gestiona los trabajos enviados a laboratorio/i)).toBeInTheDocument()
    })

    it('should render \"Nuevo Trabajo\" button', () => {
      renderLabworksPage()

      expect(screen.getByRole('button', { name: /nuevo trabajo/i })).toBeInTheDocument()
    })

    it('should display stats when available', () => {
      mockLabworksState.stats = mockStats
      mockLabworksState.labworks = [mockLabwork1]
      renderLabworksPage()

      expect(screen.getByText(/3 trabajos/i)).toBeInTheDocument()
      expect(screen.getAllByText(/1,800\.00/).length).toBeGreaterThan(0)
    })

    it('should render stats cards', () => {
      mockLabworksState.stats = mockStats
      mockLabworksState.labworks = [mockLabwork1]
      renderLabworksPage()

      expect(screen.getAllByText(/total/i).length).toBeGreaterThan(0)
      expect(screen.getByText(/por pagar/i)).toBeInTheDocument()
      expect(screen.getByText(/por entregar/i)).toBeInTheDocument()
      expect(screen.getByText(/valor total/i)).toBeInTheDocument()
    })

    it('should render the overdue stat card with the count from stats.overdue', () => {
      mockLabworksState.stats = mockStats
      mockLabworksState.labworks = [mockLabwork1]
      renderLabworksPage()

      expect(screen.getByText('labworks.status.overdue')).toBeInTheDocument()
      // mockStats.overdue is 1; scope to the stat card value next to the label
      // to avoid ambiguity with the (unrelated) "1" that could appear elsewhere.
      const overdueLabel = screen.getByText('labworks.status.overdue')
      const overdueCard = overdueLabel.closest('div.bg-white')
      expect(overdueCard).not.toBeNull()
      expect(overdueCard).toHaveTextContent('1')
    })
  })

  describe('data fetching', () => {
    it('should fetch labworks and stats on mount', () => {
      renderLabworksPage()

      expect(mockFetchLabworks).toHaveBeenCalled()
      expect(mockFetchStats).toHaveBeenCalled()
    })

    it('should debounce search', async () => {
      renderLabworksPage()

      mockFetchLabworks.mockClear()

      const searchInput = screen.getByPlaceholderText(/buscar por laboratorio o paciente/i)
      fireEvent.change(searchInput, { target: { value: 'Premium' } })

      expect(mockFetchLabworks).not.toHaveBeenCalled()

      await act(async () => {
        vi.advanceTimersByTime(300)
      })

      expect(mockFetchLabworks).toHaveBeenCalledWith({ search: 'Premium' })
    })
  })

  describe('filters', () => {
    it('should toggle filters panel', () => {
      renderLabworksPage()

      const filterButton = screen.getByRole('button', { name: /filtros/i })
      fireEvent.click(filterButton)

      expect(screen.getByText(/estado de pago/i)).toBeInTheDocument()
      expect(screen.getByText(/estado de entrega/i)).toBeInTheDocument()
    })

    it('should filter by paid status', () => {
      renderLabworksPage()

      fireEvent.click(screen.getByRole('button', { name: /filtros/i }))

      const paidButton = screen.getAllByRole('button', { name: /^pagados$/i })[0]
      fireEvent.click(paidButton)

      expect(mockSetFilters).toHaveBeenCalledWith({ isPaid: true })
    })

    it('should filter by delivery status', () => {
      renderLabworksPage()

      fireEvent.click(screen.getByRole('button', { name: /filtros/i }))

      const deliveredButton = screen.getByRole('button', { name: /^entregados$/i })
      fireEvent.click(deliveredButton)

      expect(mockSetFilters).toHaveBeenCalledWith({ isDelivered: true })
    })

    it('should clear the overdue filter when the delivery status filter is changed (mutually exclusive)', () => {
      mockLabworksState.filters = {
        isPaid: undefined,
        isDelivered: undefined,
        overdue: true,
        from: undefined,
        to: undefined,
      }
      renderLabworksPage()

      fireEvent.click(screen.getByRole('button', { name: /filtros/i }))

      const deliveredButton = screen.getByRole('button', { name: /^entregados$/i })
      fireEvent.click(deliveredButton)

      expect(mockSetFilters).toHaveBeenCalledWith({ isDelivered: true, overdue: undefined })
    })

    it('should activate the overdue filter and clear the delivery status filter when "Atrasados" is clicked', () => {
      mockLabworksState.filters = {
        isPaid: undefined,
        isDelivered: true,
        overdue: undefined,
        from: undefined,
        to: undefined,
      }
      renderLabworksPage()

      fireEvent.click(screen.getByRole('button', { name: /filtros/i }))

      const overdueButton = screen.getByRole('button', { name: 'labworks.status.overdue' })
      fireEvent.click(overdueButton)

      expect(mockSetFilters).toHaveBeenCalledWith({ overdue: true, isDelivered: undefined })
    })

    it('should toggle the overdue filter off when "Atrasados" is clicked while already active', () => {
      mockLabworksState.filters = {
        isPaid: undefined,
        isDelivered: undefined,
        overdue: true,
        from: undefined,
        to: undefined,
      }
      renderLabworksPage()

      fireEvent.click(screen.getByRole('button', { name: /filtros/i }))

      const overdueButton = screen.getByRole('button', { name: 'labworks.status.overdue' })
      fireEvent.click(overdueButton)

      expect(mockSetFilters).toHaveBeenCalledWith({ overdue: undefined, isDelivered: undefined })
    })

    it('should highlight the "Filtros" button and count as an active filter when only overdue is set', () => {
      mockLabworksState.filters = {
        isPaid: undefined,
        isDelivered: undefined,
        overdue: true,
        from: undefined,
        to: undefined,
      }
      mockLabworksState.labworks = []
      renderLabworksPage()

      const filterButton = screen.getByRole('button', { name: /filtros/i })
      expect(filterButton.className).toMatch(/bg-blue-50/)
      expect(screen.getByText(/no se encontraron trabajos con los filtros aplicados/i)).toBeInTheDocument()
    })

    it('should clear all filters', () => {
      renderLabworksPage()

      fireEvent.click(screen.getByRole('button', { name: /filtros/i }))

      const allButton = screen.getAllByRole('button', { name: /^todos$/i })[0]
      fireEvent.click(allButton)

      expect(mockSetFilters).toHaveBeenCalledWith({ isPaid: undefined })
    })

    it('should render date range inputs with labeled fields', () => {
      renderLabworksPage()

      fireEvent.click(screen.getByRole('button', { name: /filtros/i }))

      expect(screen.getByText('labworks.dateRange')).toBeInTheDocument()
      expect(screen.getByLabelText('labworks.dateFrom')).toBeInTheDocument()
      expect(screen.getByLabelText('labworks.dateTo')).toBeInTheDocument()
    })

    it('should filter by "from" date', () => {
      renderLabworksPage()

      fireEvent.click(screen.getByRole('button', { name: /filtros/i }))

      const fromInput = screen.getByLabelText('labworks.dateFrom')
      fireEvent.change(fromInput, { target: { value: '2024-01-01' } })

      expect(mockSetFilters).toHaveBeenCalledWith({ from: '2024-01-01' })
    })

    it('should filter by "to" date', () => {
      renderLabworksPage()

      fireEvent.click(screen.getByRole('button', { name: /filtros/i }))

      const toInput = screen.getByLabelText('labworks.dateTo')
      fireEvent.change(toInput, { target: { value: '2024-01-31' } })

      expect(mockSetFilters).toHaveBeenCalledWith({ to: '2024-01-31' })
    })

    it('should clear the "from" date filter when the input is emptied', () => {
      mockLabworksState.filters = { isPaid: undefined, isDelivered: undefined, overdue: undefined, from: '2024-01-01', to: undefined }
      renderLabworksPage()

      fireEvent.click(screen.getByRole('button', { name: /filtros/i }))

      const fromInput = screen.getByLabelText('labworks.dateFrom')
      expect(fromInput).toHaveValue('2024-01-01')
      fireEvent.change(fromInput, { target: { value: '' } })

      expect(mockSetFilters).toHaveBeenCalledWith({ from: undefined })
    })

    it('should clear the "to" date filter when the input is emptied', () => {
      mockLabworksState.filters = { isPaid: undefined, isDelivered: undefined, overdue: undefined, from: undefined, to: '2024-01-31' }
      renderLabworksPage()

      fireEvent.click(screen.getByRole('button', { name: /filtros/i }))

      const toInput = screen.getByLabelText('labworks.dateTo')
      expect(toInput).toHaveValue('2024-01-31')
      fireEvent.change(toInput, { target: { value: '' } })

      expect(mockSetFilters).toHaveBeenCalledWith({ to: undefined })
    })

    it('should combine date range filter with existing isPaid/isDelivered filters without clobbering them', () => {
      mockLabworksState.filters = { isPaid: true, isDelivered: false, overdue: undefined, from: undefined, to: undefined }
      renderLabworksPage()

      fireEvent.click(screen.getByRole('button', { name: /filtros/i }))

      const fromInput = screen.getByLabelText('labworks.dateFrom')
      fireEvent.change(fromInput, { target: { value: '2024-01-01' } })

      // setFilters is called with only the changed key; the store itself
      // is responsible for merging it with the pre-existing isPaid/isDelivered
      // state (mirrored by mockSetFilters below since we mock the store).
      expect(mockSetFilters).toHaveBeenCalledWith({ from: '2024-01-01' })
      expect(mockSetFilters).not.toHaveBeenCalledWith(
        expect.objectContaining({ isPaid: expect.anything() })
      )
      expect(mockSetFilters).not.toHaveBeenCalledWith(
        expect.objectContaining({ isDelivered: expect.anything() })
      )
    })

    it('should highlight the "Filtros" button and show filtered empty-state copy when only a date range is active', () => {
      mockLabworksState.filters = { isPaid: undefined, isDelivered: undefined, overdue: undefined, from: '2024-01-01', to: undefined }
      mockLabworksState.labworks = []
      renderLabworksPage()

      const filterButton = screen.getByRole('button', { name: /filtros/i })
      expect(filterButton.className).toMatch(/bg-blue-50/)
      expect(screen.getByText(/no se encontraron trabajos con los filtros aplicados/i)).toBeInTheDocument()
    })
  })

  describe('loading state', () => {
    it('should show loading spinner', () => {
      mockLabworksState.loading = true
      mockLabworksState.labworks = []
      renderLabworksPage()

      const spinner = document.querySelector('.animate-spin')
      expect(spinner).toBeInTheDocument()
    })
  })

  describe('empty state', () => {
    it('should show empty state', () => {
      mockLabworksState.labworks = []
      renderLabworksPage()

      expect(screen.getByText(/no hay trabajos de laboratorio/i)).toBeInTheDocument()
      expect(screen.getByText(/comienza creando tu primer trabajo de laboratorio/i)).toBeInTheDocument()
    })
  })

  describe('labwork list', () => {
    it('should render list of labworks', () => {
      mockLabworksState.labworks = [mockLabwork1, mockLabwork2]
      renderLabworksPage()

      expect(screen.getByTestId('labwork-card-1')).toBeInTheDocument()
      expect(screen.getByTestId('labwork-card-2')).toBeInTheDocument()
    })
  })

  describe('export', () => {
    it('renders the export button', () => {
      renderLabworksPage()

      expect(screen.getByRole('button', { name: 'labworks.exportCsv' })).toBeInTheDocument()
    })

    it('calls exportLabworks with the current filters and search query when clicked', async () => {
      vi.useRealTimers()
      mockLabworksState.filters = { isPaid: true, isDelivered: undefined, overdue: undefined, from: '2024-01-01', to: undefined }
      mockExportLabworks.mockResolvedValue(undefined)
      renderLabworksPage()

      const searchInput = screen.getByPlaceholderText(/buscar por laboratorio o paciente/i)
      fireEvent.change(searchInput, { target: { value: 'Premium' } })

      const exportButton = screen.getByRole('button', { name: 'labworks.exportCsv' })
      await act(async () => {
        fireEvent.click(exportButton)
        await new Promise((resolve) => setTimeout(resolve, 10))
      })

      expect(mockExportLabworks).toHaveBeenCalledWith({
        isPaid: true,
        isDelivered: undefined,
        overdue: undefined,
        from: '2024-01-01',
        to: undefined,
        search: 'Premium',
      })

      vi.useFakeTimers()
    })

    it('omits search from the exportLabworks call when the search box is empty', async () => {
      vi.useRealTimers()
      mockExportLabworks.mockResolvedValue(undefined)
      renderLabworksPage()

      const exportButton = screen.getByRole('button', { name: 'labworks.exportCsv' })
      await act(async () => {
        fireEvent.click(exportButton)
        await new Promise((resolve) => setTimeout(resolve, 10))
      })

      expect(mockExportLabworks).toHaveBeenCalledWith(
        expect.objectContaining({ search: undefined })
      )

      vi.useFakeTimers()
    })

    it('does not throw or crash the page when exportLabworks rejects', async () => {
      vi.useRealTimers()
      mockExportLabworks.mockRejectedValue(new Error('Network error'))
      renderLabworksPage()

      const exportButton = screen.getByRole('button', { name: 'labworks.exportCsv' })
      await act(async () => {
        fireEvent.click(exportButton)
        await new Promise((resolve) => setTimeout(resolve, 10))
      })

      expect(mockExportLabworks).toHaveBeenCalled()
      expect(exportButton).toBeInTheDocument()

      vi.useFakeTimers()
    })
  })

  describe('create labwork', () => {
    it('should open create modal', () => {
      renderLabworksPage()

      fireEvent.click(screen.getByRole('button', { name: /nuevo trabajo/i }))

      expect(screen.getByTestId('labwork-form-modal')).toBeInTheDocument()
    })

    it('should call createLabwork', async () => {
      vi.useRealTimers()
      mockCreateLabwork.mockResolvedValue(undefined)
      renderLabworksPage()

      fireEvent.click(screen.getByRole('button', { name: /nuevo trabajo/i }))

      const saveButton = screen.getByRole('button', { name: /guardar/i })
      await act(async () => {
        fireEvent.click(saveButton)
        await new Promise(resolve => setTimeout(resolve, 50))
      })

      expect(mockCreateLabwork).toHaveBeenCalled()

      vi.useFakeTimers()
    })
  })

  describe('edit labwork', () => {
    it('should open edit modal', () => {
      mockLabworksState.labworks = [mockLabwork1]
      renderLabworksPage()

      const editButton = screen.getAllByRole('button', { name: /editar/i })[0]
      fireEvent.click(editButton)

      expect(screen.getByTestId('labwork-form-modal')).toBeInTheDocument()
    })

    it('should call updateLabwork', async () => {
      vi.useRealTimers()
      mockLabworksState.labworks = [mockLabwork1]
      mockUpdateLabwork.mockResolvedValue(undefined)
      renderLabworksPage()

      fireEvent.click(screen.getAllByRole('button', { name: /editar/i })[0])

      const saveButton = screen.getByRole('button', { name: /guardar/i })
      await act(async () => {
        fireEvent.click(saveButton)
        await new Promise(resolve => setTimeout(resolve, 50))
      })

      expect(mockUpdateLabwork).toHaveBeenCalled()

      vi.useFakeTimers()
    })
  })

  describe('delete labwork', () => {
    it('should open confirm dialog', () => {
      mockLabworksState.labworks = [mockLabwork1]
      renderLabworksPage()

      const deleteButton = screen.getAllByRole('button', { name: /eliminar/i })[0]
      fireEvent.click(deleteButton)

      expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument()
    })

    it('should call deleteLabwork', async () => {
      vi.useRealTimers()
      mockLabworksState.labworks = [mockLabwork1]
      mockDeleteLabwork.mockResolvedValue(undefined)
      renderLabworksPage()

      fireEvent.click(screen.getAllByRole('button', { name: /eliminar/i })[0])

      const confirmButton = screen.getByRole('button', { name: /confirmar/i })
      await act(async () => {
        fireEvent.click(confirmButton)
        await new Promise(resolve => setTimeout(resolve, 50))
      })

      expect(mockDeleteLabwork).toHaveBeenCalledWith('1')

      vi.useFakeTimers()
    })
  })

  describe('restore labwork', () => {
    it('should call restoreLabwork', async () => {
      vi.useRealTimers()
      mockLabworksState.labworks = [mockInactiveLabwork]
      mockRestoreLabwork.mockResolvedValue(undefined)
      renderLabworksPage()

      const restoreButton = screen.getByRole('button', { name: /restaurar/i })
      await act(async () => {
        fireEvent.click(restoreButton)
        await new Promise(resolve => setTimeout(resolve, 50))
      })

      expect(mockRestoreLabwork).toHaveBeenCalledWith('3')

      vi.useFakeTimers()
    })
  })

  describe('toggle paid', () => {
    it('should call updateLabwork with isPaid toggle', async () => {
      vi.useRealTimers()
      mockLabworksState.labworks = [mockLabwork1]
      mockUpdateLabwork.mockResolvedValue(undefined)
      renderLabworksPage()

      const toggleButton = screen.getByRole('button', { name: /toggle paid/i })
      await act(async () => {
        fireEvent.click(toggleButton)
        await new Promise(resolve => setTimeout(resolve, 50))
      })

      expect(mockUpdateLabwork).toHaveBeenCalledWith('1', { isPaid: true })

      vi.useFakeTimers()
    })
  })

  describe('toggle delivered', () => {
    it('should call updateLabwork with isDelivered toggle', async () => {
      vi.useRealTimers()
      mockLabworksState.labworks = [mockLabwork1]
      mockUpdateLabwork.mockResolvedValue(undefined)
      renderLabworksPage()

      const toggleButton = screen.getByRole('button', { name: /toggle delivered/i })
      await act(async () => {
        fireEvent.click(toggleButton)
        await new Promise(resolve => setTimeout(resolve, 50))
      })

      expect(mockUpdateLabwork).toHaveBeenCalledWith('1', { isDelivered: true })

      vi.useFakeTimers()
    })
  })

  describe('error handling', () => {
    it('should display error message', () => {
      mockLabworksState.error = 'Error loading labworks'
      renderLabworksPage()

      expect(screen.getByText(/error loading labworks/i)).toBeInTheDocument()
    })

    it('should clear error', () => {
      mockLabworksState.error = 'Error loading labworks'
      renderLabworksPage()

      const closeButton = screen.getByRole('button', { name: /cerrar/i })
      fireEvent.click(closeButton)

      expect(mockClearError).toHaveBeenCalled()
    })
  })
})
