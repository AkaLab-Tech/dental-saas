import { describe, it, expect, vi, beforeEach, beforeAll, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import i18n from 'i18next'
import '@/i18n'
import type { Patient, PatientsStats } from '@/lib/patient-api'

// PatientsPage now renders every user-facing string through t(). Initialize
// the real i18n instance (Spanish, the app default) so assertions exercise
// the actual translated/interpolated output rather than raw keys — this
// mirrors the pattern used by AppointmentCard.test.tsx for the same reason.
beforeAll(async () => {
  await i18n.changeLanguage('es')
})

// Mock functions defined before vi.mock
const mockFetchPatients = vi.fn()
const mockFetchStats = vi.fn()
const mockAddPatient = vi.fn()
const mockEditPatient = vi.fn()
const mockRemovePatient = vi.fn()
const mockRestoreDeletedPatient = vi.fn()
const mockSetSearchQuery = vi.fn()
const mockSetShowInactive = vi.fn()
const mockClearError = vi.fn()

// Mutable state for mocks
const mockPatientsState = {
  patients: [] as Patient[],
  stats: null as PatientsStats | null,
  isLoading: false,
  error: null as string | null,
  searchQuery: '',
  showInactive: false,
}

// Mock the store
vi.mock('@/stores/patients.store', () => ({
  usePatientsStore: () => ({
    patients: mockPatientsState.patients,
    stats: mockPatientsState.stats,
    isLoading: mockPatientsState.isLoading,
    error: mockPatientsState.error,
    searchQuery: mockPatientsState.searchQuery,
    showInactive: mockPatientsState.showInactive,
    fetchPatients: mockFetchPatients,
    fetchStats: mockFetchStats,
    addPatient: mockAddPatient,
    editPatient: mockEditPatient,
    removePatient: mockRemovePatient,
    restoreDeletedPatient: mockRestoreDeletedPatient,
    setSearchQuery: mockSetSearchQuery,
    setShowInactive: mockSetShowInactive,
    clearError: mockClearError,
  }),
}))

// Mock PatientsListView component
vi.mock('@/components/patients/PatientsListView', () => ({
  PatientsListView: ({ patients, onEdit, onDelete, onRestore }: any) => (
    <div data-testid="patients-list-view">
      {patients.map((patient: any) => (
        <div key={patient.id} data-testid={`patient-row-${patient.id}`}>
          <span>{patient.firstName} {patient.lastName}</span>
          <button onClick={() => onEdit(patient)}>Editar</button>
          <button onClick={() => onDelete(patient)}>Eliminar</button>
          {patient.isActive === false && onRestore && (
            <button onClick={() => onRestore(patient)}>Restaurar</button>
          )}
        </div>
      ))}
    </div>
  ),
}))

// Mock PatientFormModal component
vi.mock('@/components/patients/PatientFormModal', () => ({
  PatientFormModal: ({ isOpen, onClose, onSubmit, patient }: any) => {
    if (!isOpen) return null
    return (
      <div data-testid="patient-form-modal" role="dialog">
        <h2>{patient ? 'Editar Paciente' : 'Nuevo Paciente'}</h2>
        <button onClick={onClose}>Cerrar</button>
        <button onClick={async () => {
          await onSubmit({
            firstName: 'Test',
            lastName: 'Patient',
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
  ConfirmDialog: ({ isOpen, onClose, onConfirm, title, message }: any) => {
    if (!isOpen) return null
    return (
      <div data-testid="confirm-dialog" role="dialog">
        <h2>{title}</h2>
        <p>{message}</p>
        <button onClick={onClose}>Cancelar</button>
        <button onClick={onConfirm}>Confirmar</button>
      </div>
    )
  },
}))

// Import after mocks
import { PatientsPage } from './PatientsPage'

function renderPatientsPage() {
  return render(
    <MemoryRouter>
      <PatientsPage />
    </MemoryRouter>
  )
}

// Sample patients data
const mockPatient1: Patient = {
  id: '1',
  tenantId: 'tenant1',
  firstName: 'Juan',
  lastName: 'Pérez',
  email: 'juan@example.com',
  phone: '+1234567890',
  dob: '1990-01-01',
  gender: 'male',
  address: 'Calle Principal 123',
  dentalChart: {},
  isActive: true,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
}

const mockPatient2: Patient = {
  id: '2',
  tenantId: 'tenant1',
  firstName: 'María',
  lastName: 'García',
  email: 'maria@example.com',
  phone: '+9876543210',
  dob: '1985-05-15',
  gender: 'female',
  address: null,
  dentalChart: {},
  isActive: true,
  createdAt: '2024-01-02T00:00:00Z',
  updatedAt: '2024-01-02T00:00:00Z',
}

const mockInactivePatient: Patient = {
  id: '3',
  tenantId: 'tenant1',
  firstName: 'Carlos',
  lastName: 'López',
  email: null,
  phone: null,
  dob: null,
  gender: null,
  address: null,
  dentalChart: {},
  isActive: false,
  createdAt: '2024-01-03T00:00:00Z',
  updatedAt: '2024-01-03T00:00:00Z',
}

const mockStats: PatientsStats = {
  active: 2,
  inactive: 1,
  total: 3,
  limit: 15,
  remaining: 13,
}

describe('PatientsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mockPatientsState.patients = []
    mockPatientsState.stats = null
    mockPatientsState.isLoading = false
    mockPatientsState.error = null
    mockPatientsState.searchQuery = ''
    mockPatientsState.showInactive = false
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  describe('rendering', () => {
    it('should render the page title and subtitle', () => {
      mockPatientsState.patients = [mockPatient1] // Avoid empty state heading
      renderPatientsPage()

      expect(screen.getByRole('heading', { name: /^pacientes$/i })).toBeInTheDocument()
      expect(screen.getByText(/gestiona los pacientes de tu clínica/i)).toBeInTheDocument()
    })

    it('should render the "Nuevo Paciente" button', () => {
      mockPatientsState.stats = mockStats
      mockPatientsState.patients = [mockPatient1] // Avoid empty state
      renderPatientsPage()

      const button = screen.getByRole('button', { name: /nuevo paciente/i })
      expect(button).toBeInTheDocument()
    })

    it('should render search input and filters', () => {
      mockPatientsState.patients = [mockPatient1] // Avoid empty state
      renderPatientsPage()

      expect(screen.getByPlaceholderText(/buscar por nombre, email o teléfono/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/mostrar inactivos/i)).toBeInTheDocument()
    })

    it('should display stats in subtitle', () => {
      mockPatientsState.stats = mockStats
      mockPatientsState.patients = [mockPatient1] // Avoid empty state
      renderPatientsPage()

      expect(screen.getByText(/\(2 de 15 disponibles\)/i)).toBeInTheDocument()
    })
  })

  describe('data fetching', () => {
    it('should fetch patients and stats on mount', () => {
      renderPatientsPage()

      expect(mockFetchPatients).toHaveBeenCalledTimes(1)
      expect(mockFetchStats).toHaveBeenCalledTimes(1)
    })

    it('should debounce search query changes', async () => {
      renderPatientsPage()

      // Clear initial mount call
      mockFetchPatients.mockClear()

      const searchInput = screen.getByPlaceholderText(/buscar por nombre, email o teléfono/i)

      // Type multiple characters quickly
      fireEvent.change(searchInput, { target: { value: 'J' } })
      expect(mockSetSearchQuery).toHaveBeenCalledWith('J')

      fireEvent.change(searchInput, { target: { value: 'Ju' } })
      expect(mockSetSearchQuery).toHaveBeenCalledWith('Ju')

      fireEvent.change(searchInput, { target: { value: 'Jua' } })
      expect(mockSetSearchQuery).toHaveBeenCalledWith('Jua')

      // Should not fetch immediately
      expect(mockFetchPatients).not.toHaveBeenCalled()

      // Advance timers by debounce delay (300ms)
      await act(async () => {
        vi.advanceTimersByTime(300)
      })

      // Should fetch once after debounce
      expect(mockFetchPatients).toHaveBeenCalledTimes(1)
    })

    it('should fetch patients when showInactive changes', async () => {
      renderPatientsPage()

      // Clear initial mount call
      mockFetchPatients.mockClear()

      const checkbox = screen.getByLabelText(/mostrar inactivos/i)
      fireEvent.click(checkbox)

      expect(mockSetShowInactive).toHaveBeenCalledWith(true)

      // Advance debounce timer
      await act(async () => {
        vi.advanceTimersByTime(300)
      })

      expect(mockFetchPatients).toHaveBeenCalledTimes(1)
    })
  })

  describe('loading state', () => {
    it('should show loading spinner when loading and no patients', () => {
      mockPatientsState.isLoading = true
      mockPatientsState.patients = []
      renderPatientsPage()

      const spinner = document.querySelector('.animate-spin')
      expect(spinner).toBeInTheDocument()
    })

    it('should not show loading spinner when patients exist', () => {
      mockPatientsState.isLoading = true
      mockPatientsState.patients = [mockPatient1]
      renderPatientsPage()

      const spinner = document.querySelector('.animate-spin')
      expect(spinner).not.toBeInTheDocument()
    })
  })

  describe('empty states', () => {
    it('should show empty state when no patients', () => {
      mockPatientsState.patients = []
      mockPatientsState.stats = mockStats
      renderPatientsPage()

      expect(screen.getByText(/no hay pacientes/i)).toBeInTheDocument()
      expect(screen.getByText(/comienza agregando tu primer paciente/i)).toBeInTheDocument()
    })

    it('should show empty search results message', () => {
      mockPatientsState.patients = []
      mockPatientsState.searchQuery = 'nonexistent'
      renderPatientsPage()

      expect(screen.getByText(/no se encontraron pacientes/i)).toBeInTheDocument()
      expect(screen.getByText(/intenta con otros términos de búsqueda/i)).toBeInTheDocument()
    })

    it('should not show "Agregar Paciente" button in empty state when searching', () => {
      mockPatientsState.patients = []
      mockPatientsState.searchQuery = 'search term'
      renderPatientsPage()

      const addButtons = screen.getAllByRole('button', { name: /nuevo paciente|agregar paciente/i })
      // Only the header button should exist
      expect(addButtons).toHaveLength(1)
    })
  })

  describe('patient list', () => {
    it('should render list of patients', () => {
      mockPatientsState.patients = [mockPatient1, mockPatient2]
      renderPatientsPage()

      expect(screen.getByTestId('patient-row-1')).toBeInTheDocument()
      expect(screen.getByTestId('patient-row-2')).toBeInTheDocument()
      expect(screen.getByText(/juan pérez/i)).toBeInTheDocument()
      expect(screen.getByText(/maría garcía/i)).toBeInTheDocument()
    })

    it('should render inactive patients with restore button', () => {
      mockPatientsState.patients = [mockInactivePatient]
      mockPatientsState.showInactive = true
      renderPatientsPage()

      expect(screen.getByTestId('patient-row-3')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /restaurar/i })).toBeInTheDocument()
    })
  })

  describe('search and filters', () => {
    it('should update search query when typing', () => {
      renderPatientsPage()

      const searchInput = screen.getByPlaceholderText(/buscar por nombre, email o teléfono/i)
      fireEvent.change(searchInput, { target: { value: 'Juan' } })

      expect(mockSetSearchQuery).toHaveBeenCalledWith('Juan')
    })

    it('should toggle showInactive checkbox', () => {
      renderPatientsPage()

      const checkbox = screen.getByLabelText(/mostrar inactivos/i) as HTMLInputElement
      expect(checkbox.checked).toBe(false)

      fireEvent.click(checkbox)
      expect(mockSetShowInactive).toHaveBeenCalledWith(true)
    })
  })

  describe('create patient', () => {
    it('should open create modal when clicking "Nuevo Paciente"', () => {
      mockPatientsState.stats = mockStats
      mockPatientsState.patients = [mockPatient1] // Avoid empty state with button
      renderPatientsPage()

      const button = screen.getAllByRole('button', { name: /nuevo paciente/i })[0]
      fireEvent.click(button)

      expect(screen.getByTestId('patient-form-modal')).toBeInTheDocument()
      const modalHeadings = screen.getAllByText(/nuevo paciente/i)
      expect(modalHeadings.length).toBeGreaterThan(0)
    })

    it('should disable "Nuevo Paciente" button when limit reached', () => {
      mockPatientsState.stats = { ...mockStats, remaining: 0 }
      renderPatientsPage()

      const button = screen.getByRole('button', { name: /nuevo paciente/i })
      expect(button).toBeDisabled()
    })

    it('should show limit reached banner when limit is 0', () => {
      mockPatientsState.stats = { ...mockStats, remaining: 0 }
      renderPatientsPage()

      expect(screen.getByText(/límite de pacientes alcanzado/i)).toBeInTheDocument()
      expect(screen.getByText(/tu plan actual permite hasta 15 pacientes/i)).toBeInTheDocument()
    })

    it('should call addPatient when submitting create form', async () => {
      vi.useRealTimers() // Use real timers for async test
      mockPatientsState.stats = mockStats
      mockPatientsState.patients = [mockPatient1]
      mockAddPatient.mockResolvedValue(undefined)
      renderPatientsPage()

      // Open modal
      const newButton = screen.getAllByRole('button', { name: /nuevo paciente/i })[0]
      fireEvent.click(newButton)

      // Submit form
      const saveButton = screen.getByRole('button', { name: /guardar/i })
      await act(async () => {
        fireEvent.click(saveButton)
        await new Promise(resolve => setTimeout(resolve, 50))
      })

      expect(mockAddPatient).toHaveBeenCalledWith({
        firstName: 'Test',
        lastName: 'Patient',
      })

      vi.useFakeTimers() // Restore fake timers
    })
  })

  describe('edit patient', () => {
    it('should open edit modal when clicking edit button', () => {
      mockPatientsState.patients = [mockPatient1]
      renderPatientsPage()

      const editButton = screen.getAllByRole('button', { name: /editar/i })[0]
      fireEvent.click(editButton)

      expect(screen.getByTestId('patient-form-modal')).toBeInTheDocument()
      expect(screen.getByText(/editar paciente/i)).toBeInTheDocument()
    })

    it('should call editPatient when submitting edit form', async () => {
      vi.useRealTimers() // Use real timers for async test
      mockPatientsState.patients = [mockPatient1]
      mockEditPatient.mockResolvedValue(undefined)
      renderPatientsPage()

      // Open edit modal
      const editButton = screen.getAllByRole('button', { name: /editar/i })[0]
      fireEvent.click(editButton)

      // Submit form
      const saveButton = screen.getByRole('button', { name: /guardar/i })
      await act(async () => {
        fireEvent.click(saveButton)
        await new Promise(resolve => setTimeout(resolve, 50))
      })

      expect(mockEditPatient).toHaveBeenCalledWith('1', {
        firstName: 'Test',
        lastName: 'Patient',
      })

      vi.useFakeTimers() // Restore fake timers
    })
  })

  describe('delete patient', () => {
    it('should open confirm dialog when clicking delete button', () => {
      mockPatientsState.patients = [mockPatient1]
      renderPatientsPage()

      const deleteButton = screen.getAllByRole('button', { name: /eliminar/i })[0]
      fireEvent.click(deleteButton)

      expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument()
      expect(screen.getByText(/eliminar paciente/i)).toBeInTheDocument()
    })

    // Regression coverage for task #324: the confirm message is now built from
    // t('patients.deleteConfirmMessage', { name }) — pins down that the
    // {{name}} placeholder is actually replaced with the patient's name, not
    // left as a literal "{{name}}".
    it('should interpolate the patient name into the delete confirmation message', () => {
      mockPatientsState.patients = [mockPatient1]
      renderPatientsPage()

      fireEvent.click(screen.getAllByRole('button', { name: /eliminar/i })[0])

      expect(
        screen.getByText('¿Estás seguro de que deseas eliminar a Juan Pérez? Esta acción se puede revertir restaurando el paciente posteriormente.')
      ).toBeInTheDocument()
      expect(screen.queryByText(/{{name}}/)).not.toBeInTheDocument()
    })

    it('should call removePatient when confirming deletion', async () => {
      vi.useRealTimers() // Use real timers for async test
      mockPatientsState.patients = [mockPatient1]
      mockRemovePatient.mockResolvedValue(undefined)
      renderPatientsPage()

      // Open confirm dialog
      const deleteButton = screen.getAllByRole('button', { name: /eliminar/i })[0]
      fireEvent.click(deleteButton)

      // Confirm deletion
      const confirmButton = screen.getByRole('button', { name: /confirmar/i })
      await act(async () => {
        fireEvent.click(confirmButton)
        await new Promise(resolve => setTimeout(resolve, 50))
      })

      expect(mockRemovePatient).toHaveBeenCalledWith('1')

      vi.useFakeTimers() // Restore fake timers
    })

    it('should close confirm dialog when clicking cancel', () => {
      mockPatientsState.patients = [mockPatient1]
      renderPatientsPage()

      // Open and cancel
      fireEvent.click(screen.getAllByRole('button', { name: /eliminar/i })[0])
      expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: /cancelar/i }))

      expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument()
    })
  })

  describe('restore patient', () => {
    it('should call restoreDeletedPatient when clicking restore button', async () => {
      vi.useRealTimers() // Use real timers for async test
      mockPatientsState.patients = [mockInactivePatient]
      mockPatientsState.showInactive = true
      mockRestoreDeletedPatient.mockResolvedValue(undefined)
      renderPatientsPage()

      const restoreButton = screen.getByRole('button', { name: /restaurar/i })
      await act(async () => {
        fireEvent.click(restoreButton)
        await new Promise(resolve => setTimeout(resolve, 50))
      })

      expect(mockRestoreDeletedPatient).toHaveBeenCalledWith('3')

      vi.useFakeTimers() // Restore fake timers
    })
  })

  // Regression coverage for task #324: the four success toasts are now built
  // from t('patients.toast.<action>', { name }) instead of a hardcoded
  // string. Each assertion pins down the real interpolated Spanish output —
  // not a literal "{{name}}" — for the actual patient acted upon.
  describe('success toasts (i18n interpolation)', () => {
    it('shows the interpolated "created" toast with the new patient name after adding a patient', async () => {
      vi.useRealTimers()
      mockPatientsState.stats = mockStats
      mockPatientsState.patients = [mockPatient1]
      mockAddPatient.mockResolvedValue(undefined)
      renderPatientsPage()

      fireEvent.click(screen.getAllByRole('button', { name: /nuevo paciente/i })[0])
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /guardar/i }))
        await new Promise(resolve => setTimeout(resolve, 50))
      })

      expect(screen.getByText('Test Patient creado exitosamente')).toBeInTheDocument()

      vi.useFakeTimers()
    })

    it('shows the interpolated "updated" toast with the edited patient name after editing a patient', async () => {
      vi.useRealTimers()
      mockPatientsState.patients = [mockPatient1]
      mockEditPatient.mockResolvedValue(undefined)
      renderPatientsPage()

      fireEvent.click(screen.getAllByRole('button', { name: /editar/i })[0])
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /guardar/i }))
        await new Promise(resolve => setTimeout(resolve, 50))
      })

      expect(screen.getByText('Test Patient actualizado exitosamente')).toBeInTheDocument()

      vi.useFakeTimers()
    })

    it('shows the interpolated "deleted" toast with the deleted patient\'s name after confirming deletion', async () => {
      vi.useRealTimers()
      mockPatientsState.patients = [mockPatient1]
      mockRemovePatient.mockResolvedValue(undefined)
      renderPatientsPage()

      fireEvent.click(screen.getAllByRole('button', { name: /eliminar/i })[0])
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /confirmar/i }))
        await new Promise(resolve => setTimeout(resolve, 50))
      })

      expect(screen.getByText('Juan Pérez eliminado')).toBeInTheDocument()

      vi.useFakeTimers()
    })

    it('shows the interpolated "restored" toast with the restored patient\'s name', async () => {
      vi.useRealTimers()
      mockPatientsState.patients = [mockInactivePatient]
      mockPatientsState.showInactive = true
      mockRestoreDeletedPatient.mockResolvedValue(undefined)
      renderPatientsPage()

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /restaurar/i }))
        await new Promise(resolve => setTimeout(resolve, 50))
      })

      expect(screen.getByText('Carlos López ha sido restaurado')).toBeInTheDocument()

      vi.useFakeTimers()
    })
  })

  // Regression coverage for task #324: the limit-reached banner's "view
  // plans" call-to-action text is a new key (patients.limitBanner.viewPlans);
  // pin it down alongside the title/body already covered above.
  describe('limit banner (i18n)', () => {
    it('renders the translated "view available plans" call to action', () => {
      mockPatientsState.stats = { ...mockStats, remaining: 0 }
      renderPatientsPage()

      expect(screen.getByText('Ver planes disponibles')).toBeInTheDocument()
    })
  })

  describe('error handling', () => {
    it('should display error message from store', () => {
      mockPatientsState.error = 'Error al cargar pacientes'
      renderPatientsPage()

      expect(screen.getByText(/error al cargar pacientes/i)).toBeInTheDocument()
    })

    it('should clear error when clicking close button', () => {
      mockPatientsState.error = 'Error al cargar pacientes'
      renderPatientsPage()

      const closeButton = screen.getByRole('button', { name: /cerrar/i })
      fireEvent.click(closeButton)

      expect(mockClearError).toHaveBeenCalled()
    })
  })

  describe('modal closing', () => {
    it('should close form modal when clicking close button', () => {
      mockPatientsState.stats = mockStats
      renderPatientsPage()

      // Open modal
      fireEvent.click(screen.getByRole('button', { name: /nuevo paciente/i }))
      expect(screen.getByTestId('patient-form-modal')).toBeInTheDocument()

      // Close modal
      fireEvent.click(screen.getByRole('button', { name: /cerrar/i }))

      expect(screen.queryByTestId('patient-form-modal')).not.toBeInTheDocument()
    })
  })
})
