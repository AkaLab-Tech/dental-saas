import { describe, it, expect, vi, beforeEach, beforeAll, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import i18n from 'i18next'
import '@/i18n'
import type { Doctor, DoctorsStats } from '@/lib/doctor-api'

// DoctorsPage now renders every user-facing string through t(). Initialize
// the real i18n instance (Spanish, the app default) so assertions exercise
// the actual translated/interpolated output rather than raw keys — mirrors
// the pattern used by PatientsPage.test.tsx for the same reason (task #324).
beforeAll(async () => {
  await i18n.changeLanguage('es')
})

// Mock functions defined before vi.mock
const mockFetchDoctors = vi.fn()
const mockFetchStats = vi.fn()
const mockAddDoctor = vi.fn()
const mockEditDoctor = vi.fn()
const mockRemoveDoctor = vi.fn()
const mockRestoreDeletedDoctor = vi.fn()
const mockSetSearchQuery = vi.fn()
const mockSetShowInactive = vi.fn()
const mockClearError = vi.fn()

// Mutable state for mocks
const mockDoctorsState = {
  doctors: [] as Doctor[],
  stats: null as DoctorsStats | null,
  isLoading: false,
  error: null as string | null,
  searchQuery: '',
  showInactive: false,
}

// Mock the store
vi.mock('@/stores/doctors.store', () => ({
  useDoctorsStore: () => ({
    doctors: mockDoctorsState.doctors,
    stats: mockDoctorsState.stats,
    isLoading: mockDoctorsState.isLoading,
    error: mockDoctorsState.error,
    searchQuery: mockDoctorsState.searchQuery,
    showInactive: mockDoctorsState.showInactive,
    fetchDoctors: mockFetchDoctors,
    fetchStats: mockFetchStats,
    addDoctor: mockAddDoctor,
    editDoctor: mockEditDoctor,
    removeDoctor: mockRemoveDoctor,
    restoreDeletedDoctor: mockRestoreDeletedDoctor,
    setSearchQuery: mockSetSearchQuery,
    setShowInactive: mockSetShowInactive,
    clearError: mockClearError,
  }),
}))

// Mock DoctorsListView component
vi.mock('@/components/doctors/DoctorsListView', () => ({
  DoctorsListView: ({ doctors, onEdit, onDelete, onRestore }: any) => (
    <div data-testid="doctors-list-view">
      {doctors.map((doctor: any) => (
        <div key={doctor.id} data-testid={`doctor-row-${doctor.id}`}>
          <span>Dr. {doctor.firstName} {doctor.lastName}</span>
          <button onClick={() => onEdit(doctor)}>Editar</button>
          <button onClick={() => onDelete(doctor)}>Eliminar</button>
          {doctor.isActive === false && onRestore && (
            <button onClick={() => onRestore(doctor)}>Restaurar</button>
          )}
        </div>
      ))}
    </div>
  ),
}))

// Mock DoctorFormModal component
vi.mock('@/components/doctors/DoctorFormModal', () => ({
  DoctorFormModal: ({ isOpen, onClose, onSubmit, doctor }: any) => {
    if (!isOpen) return null
    return (
      <div data-testid="doctor-form-modal" role="dialog">
        <h2>{doctor ? 'Editar Doctor' : 'Nuevo Doctor'}</h2>
        <button onClick={onClose}>Cerrar</button>
        <button onClick={async () => {
          await onSubmit({
            firstName: 'Test',
            lastName: 'Doctor',
            specialty: 'General',
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
import { DoctorsPage } from './DoctorsPage'

function renderDoctorsPage() {
  return render(
    <MemoryRouter>
      <DoctorsPage />
    </MemoryRouter>
  )
}

// Sample doctors data
const mockDoctor1: Doctor = {
  id: '1',
  tenantId: 'tenant1',
  firstName: 'Juan',
  lastName: 'Pérez',
  email: 'juan@example.com',
  phone: '+1234567890',
  specialty: 'Ortodoncia',
  licenseNumber: 'LIC123',
  isActive: true,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
}

const mockDoctor2: Doctor = {
  id: '2',
  tenantId: 'tenant1',
  firstName: 'María',
  lastName: 'García',
  email: 'maria@example.com',
  phone: '+9876543210',
  specialty: 'Endodoncia',
  licenseNumber: 'LIC456',
  isActive: true,
  createdAt: '2024-01-02T00:00:00Z',
  updatedAt: '2024-01-02T00:00:00Z',
}

const mockInactiveDoctor: Doctor = {
  id: '3',
  tenantId: 'tenant1',
  firstName: 'Carlos',
  lastName: 'López',
  email: 'carlos@example.com',
  phone: null,
  specialty: 'General',
  licenseNumber: null,
  isActive: false,
  createdAt: '2024-01-03T00:00:00Z',
  updatedAt: '2024-01-03T00:00:00Z',
}

const mockStats: DoctorsStats = {
  active: 2,
  inactive: 1,
  total: 3,
  limit: 10,
  remaining: 8,
}

describe('DoctorsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mockDoctorsState.doctors = []
    mockDoctorsState.stats = null
    mockDoctorsState.isLoading = false
    mockDoctorsState.error = null
    mockDoctorsState.searchQuery = ''
    mockDoctorsState.showInactive = false
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  describe('rendering', () => {
    it('should render the page title and subtitle', () => {
      mockDoctorsState.doctors = [mockDoctor1] // Avoid empty state
      renderDoctorsPage()

      expect(screen.getByRole('heading', { name: /^doctores$/i })).toBeInTheDocument()
      expect(screen.getByText(/gestiona los doctores de tu clínica/i)).toBeInTheDocument()
    })

    it('should render the "Nuevo Doctor" button', () => {
      mockDoctorsState.stats = mockStats
      mockDoctorsState.doctors = [mockDoctor1] // Avoid empty state
      renderDoctorsPage()

      const button = screen.getByRole('button', { name: /nuevo doctor/i })
      expect(button).toBeInTheDocument()
    })

    it('should render search input and filters', () => {
      mockDoctorsState.doctors = [mockDoctor1] // Avoid empty state
      renderDoctorsPage()

      expect(screen.getByPlaceholderText(/buscar por nombre, email o especialidad/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/mostrar inactivos/i)).toBeInTheDocument()
    })

    it('should display stats in subtitle', () => {
      mockDoctorsState.stats = mockStats
      mockDoctorsState.doctors = [mockDoctor1] // Avoid empty state
      renderDoctorsPage()

      expect(screen.getByText(/\(2 de 10 disponibles\)/i)).toBeInTheDocument()
    })
  })

  describe('data fetching', () => {
    it('should fetch doctors and stats on mount', () => {
      renderDoctorsPage()

      expect(mockFetchDoctors).toHaveBeenCalledTimes(1)
      expect(mockFetchStats).toHaveBeenCalledTimes(1)
    })

    it('should debounce search query changes', async () => {
      renderDoctorsPage()

      // Clear initial mount call
      mockFetchDoctors.mockClear()

      const searchInput = screen.getByPlaceholderText(/buscar por nombre, email o especialidad/i)

      // Type multiple characters quickly
      fireEvent.change(searchInput, { target: { value: 'J' } })
      expect(mockSetSearchQuery).toHaveBeenCalledWith('J')

      fireEvent.change(searchInput, { target: { value: 'Ju' } })
      expect(mockSetSearchQuery).toHaveBeenCalledWith('Ju')

      fireEvent.change(searchInput, { target: { value: 'Jua' } })
      expect(mockSetSearchQuery).toHaveBeenCalledWith('Jua')

      // Should not fetch immediately
      expect(mockFetchDoctors).not.toHaveBeenCalled()

      // Advance timers by debounce delay (300ms)
      await act(async () => {
        vi.advanceTimersByTime(300)
      })

      // Should fetch once after debounce
      expect(mockFetchDoctors).toHaveBeenCalledTimes(1)
    })

    it('should fetch doctors when showInactive changes', async () => {
      renderDoctorsPage()

      // Clear initial mount call
      mockFetchDoctors.mockClear()

      const checkbox = screen.getByLabelText(/mostrar inactivos/i)
      fireEvent.click(checkbox)

      expect(mockSetShowInactive).toHaveBeenCalledWith(true)

      // Advance debounce timer
      await act(async () => {
        vi.advanceTimersByTime(300)
      })

      expect(mockFetchDoctors).toHaveBeenCalledTimes(1)
    })
  })

  describe('loading state', () => {
    it('should show loading spinner when loading and no doctors', () => {
      mockDoctorsState.isLoading = true
      mockDoctorsState.doctors = []
      renderDoctorsPage()

      const spinner = document.querySelector('.animate-spin')
      expect(spinner).toBeInTheDocument()
    })

    it('should not show loading spinner when doctors exist', () => {
      mockDoctorsState.isLoading = true
      mockDoctorsState.doctors = [mockDoctor1]
      renderDoctorsPage()

      const spinner = document.querySelector('.animate-spin')
      expect(spinner).not.toBeInTheDocument()
    })
  })

  describe('empty states', () => {
    it('should show empty state when no doctors', () => {
      mockDoctorsState.doctors = []
      mockDoctorsState.stats = mockStats
      renderDoctorsPage()

      expect(screen.getByText(/no hay doctores/i)).toBeInTheDocument()
      expect(screen.getByText(/comienza agregando tu primer doctor/i)).toBeInTheDocument()
    })

    it('should show empty search results message', () => {
      mockDoctorsState.doctors = []
      mockDoctorsState.searchQuery = 'nonexistent'
      renderDoctorsPage()

      expect(screen.getByText(/no se encontraron doctores/i)).toBeInTheDocument()
      expect(screen.getByText(/intenta con otros términos de búsqueda/i)).toBeInTheDocument()
    })

    it('should not show "Agregar Doctor" button in empty state when searching', () => {
      mockDoctorsState.doctors = []
      mockDoctorsState.searchQuery = 'search term'
      renderDoctorsPage()

      const addButtons = screen.getAllByRole('button', { name: /nuevo doctor|agregar doctor/i })
      // Only the header button should exist
      expect(addButtons).toHaveLength(1)
    })
  })

  describe('doctor list', () => {
    it('should render list of doctors', () => {
      mockDoctorsState.doctors = [mockDoctor1, mockDoctor2]
      renderDoctorsPage()

      expect(screen.getByTestId('doctor-row-1')).toBeInTheDocument()
      expect(screen.getByTestId('doctor-row-2')).toBeInTheDocument()
      expect(screen.getByText(/dr. juan pérez/i)).toBeInTheDocument()
      expect(screen.getByText(/dr. maría garcía/i)).toBeInTheDocument()
    })

    it('should render inactive doctors with restore button', () => {
      mockDoctorsState.doctors = [mockInactiveDoctor]
      mockDoctorsState.showInactive = true
      renderDoctorsPage()

      expect(screen.getByTestId('doctor-row-3')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /restaurar/i })).toBeInTheDocument()
    })
  })

  describe('search and filters', () => {
    it('should update search query when typing', () => {
      renderDoctorsPage()

      const searchInput = screen.getByPlaceholderText(/buscar por nombre, email o especialidad/i)
      fireEvent.change(searchInput, { target: { value: 'Juan' } })

      expect(mockSetSearchQuery).toHaveBeenCalledWith('Juan')
    })

    it('should toggle showInactive checkbox', () => {
      renderDoctorsPage()

      const checkbox = screen.getByLabelText(/mostrar inactivos/i) as HTMLInputElement
      expect(checkbox.checked).toBe(false)

      fireEvent.click(checkbox)
      expect(mockSetShowInactive).toHaveBeenCalledWith(true)
    })
  })

  describe('create doctor', () => {
    it('should open create modal when clicking "Nuevo Doctor"', () => {
      mockDoctorsState.stats = mockStats
      mockDoctorsState.doctors = [mockDoctor1] // Avoid empty state with button
      renderDoctorsPage()

      const button = screen.getAllByRole('button', { name: /nuevo doctor/i })[0]
      fireEvent.click(button)

      expect(screen.getByTestId('doctor-form-modal')).toBeInTheDocument()
      const modalHeadings = screen.getAllByText(/nuevo doctor/i)
      expect(modalHeadings.length).toBeGreaterThan(0)
    })

    it('should disable "Nuevo Doctor" button when limit reached', () => {
      mockDoctorsState.stats = { ...mockStats, remaining: 0 }
      renderDoctorsPage()

      const button = screen.getByRole('button', { name: /nuevo doctor/i })
      expect(button).toBeDisabled()
    })

    it('should show limit reached banner when limit is 0', () => {
      mockDoctorsState.stats = { ...mockStats, remaining: 0 }
      renderDoctorsPage()

      expect(screen.getByText(/límite de doctores alcanzado/i)).toBeInTheDocument()
      expect(screen.getByText(/tu plan actual permite hasta 10 doctores/i)).toBeInTheDocument()
    })

    it('should call addDoctor when submitting create form', async () => {
      vi.useRealTimers() // Use real timers for async test
      mockDoctorsState.stats = mockStats
      mockDoctorsState.doctors = [mockDoctor1]
      mockAddDoctor.mockResolvedValue(undefined)
      renderDoctorsPage()

      // Open modal
      const newButton = screen.getAllByRole('button', { name: /nuevo doctor/i })[0]
      fireEvent.click(newButton)

      // Submit form
      const saveButton = screen.getByRole('button', { name: /guardar/i })
      await act(async () => {
        fireEvent.click(saveButton)
        await new Promise(resolve => setTimeout(resolve, 50))
      })

      expect(mockAddDoctor).toHaveBeenCalledWith({
        firstName: 'Test',
        lastName: 'Doctor',
        specialty: 'General',
      })

      vi.useFakeTimers() // Restore fake timers
    })

    it('should show the translated "Dr. {name} creado exitosamente" toast after a successful create', async () => {
      vi.useRealTimers() // Use real timers for async test
      mockDoctorsState.stats = mockStats
      mockDoctorsState.doctors = [mockDoctor1]
      mockAddDoctor.mockResolvedValue(undefined)
      renderDoctorsPage()

      fireEvent.click(screen.getAllByRole('button', { name: /nuevo doctor/i })[0])
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /guardar/i }))
        await new Promise(resolve => setTimeout(resolve, 50))
      })

      expect(screen.getByText('Dr. Test Doctor creado exitosamente')).toBeInTheDocument()

      vi.useFakeTimers() // Restore fake timers
    })
  })

  describe('edit doctor', () => {
    it('should open edit modal when clicking edit button', () => {
      mockDoctorsState.doctors = [mockDoctor1]
      renderDoctorsPage()

      const editButton = screen.getAllByRole('button', { name: /editar/i })[0]
      fireEvent.click(editButton)

      expect(screen.getByTestId('doctor-form-modal')).toBeInTheDocument()
      expect(screen.getByText(/editar doctor/i)).toBeInTheDocument()
    })

    it('should call editDoctor when submitting edit form', async () => {
      vi.useRealTimers() // Use real timers for async test
      mockDoctorsState.doctors = [mockDoctor1]
      mockEditDoctor.mockResolvedValue(undefined)
      renderDoctorsPage()

      // Open edit modal
      const editButton = screen.getAllByRole('button', { name: /editar/i })[0]
      fireEvent.click(editButton)

      // Submit form
      const saveButton = screen.getByRole('button', { name: /guardar/i })
      await act(async () => {
        fireEvent.click(saveButton)
        await new Promise(resolve => setTimeout(resolve, 50))
      })

      expect(mockEditDoctor).toHaveBeenCalledWith('1', {
        firstName: 'Test',
        lastName: 'Doctor',
        specialty: 'General',
      })

      vi.useFakeTimers() // Restore fake timers
    })

    it('should show the translated "Dr. {name} actualizado exitosamente" toast after a successful edit', async () => {
      vi.useRealTimers() // Use real timers for async test
      mockDoctorsState.doctors = [mockDoctor1]
      mockEditDoctor.mockResolvedValue(undefined)
      renderDoctorsPage()

      fireEvent.click(screen.getAllByRole('button', { name: /editar/i })[0])
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /guardar/i }))
        await new Promise(resolve => setTimeout(resolve, 50))
      })

      expect(screen.getByText('Dr. Test Doctor actualizado exitosamente')).toBeInTheDocument()

      vi.useFakeTimers() // Restore fake timers
    })
  })

  describe('delete doctor', () => {
    it('should open confirm dialog when clicking delete button', () => {
      mockDoctorsState.doctors = [mockDoctor1]
      renderDoctorsPage()

      const deleteButton = screen.getAllByRole('button', { name: /eliminar/i })[0]
      fireEvent.click(deleteButton)

      expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument()
      expect(screen.getByText(/eliminar doctor/i)).toBeInTheDocument()
    })

    it('should show the translated confirmation message with the doctor\'s name interpolated', () => {
      mockDoctorsState.doctors = [mockDoctor1]
      renderDoctorsPage()

      const deleteButton = screen.getAllByRole('button', { name: /eliminar/i })[0]
      fireEvent.click(deleteButton)

      expect(
        screen.getByText(
          '¿Estás seguro de que deseas eliminar a Dr. Juan Pérez? Esta acción se puede revertir restaurando el doctor posteriormente.'
        )
      ).toBeInTheDocument()
    })

    it('should call removeDoctor when confirming deletion', async () => {
      vi.useRealTimers() // Use real timers for async test
      mockDoctorsState.doctors = [mockDoctor1]
      mockRemoveDoctor.mockResolvedValue(undefined)
      renderDoctorsPage()

      // Open confirm dialog
      const deleteButton = screen.getAllByRole('button', { name: /eliminar/i })[0]
      fireEvent.click(deleteButton)

      // Confirm deletion
      const confirmButton = screen.getByRole('button', { name: /confirmar/i })
      await act(async () => {
        fireEvent.click(confirmButton)
        await new Promise(resolve => setTimeout(resolve, 50))
      })

      expect(mockRemoveDoctor).toHaveBeenCalledWith('1')

      vi.useFakeTimers() // Restore fake timers
    })

    it('should show the translated "Dr. {name} eliminado" toast after a successful deletion', async () => {
      vi.useRealTimers() // Use real timers for async test
      mockDoctorsState.doctors = [mockDoctor1]
      mockRemoveDoctor.mockResolvedValue(undefined)
      renderDoctorsPage()

      fireEvent.click(screen.getAllByRole('button', { name: /eliminar/i })[0])
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /confirmar/i }))
        await new Promise(resolve => setTimeout(resolve, 50))
      })

      expect(screen.getByText('Dr. Juan Pérez eliminado')).toBeInTheDocument()

      vi.useFakeTimers() // Restore fake timers
    })

    it('should close confirm dialog when clicking cancel', () => {
      mockDoctorsState.doctors = [mockDoctor1]
      renderDoctorsPage()

      // Open and cancel
      fireEvent.click(screen.getAllByRole('button', { name: /eliminar/i })[0])
      expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: /cancelar/i }))

      expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument()
    })
  })

  describe('restore doctor', () => {
    it('should call restoreDeletedDoctor when clicking restore button', async () => {
      vi.useRealTimers() // Use real timers for async test
      mockDoctorsState.doctors = [mockInactiveDoctor]
      mockDoctorsState.showInactive = true
      mockRestoreDeletedDoctor.mockResolvedValue(undefined)
      renderDoctorsPage()

      const restoreButton = screen.getByRole('button', { name: /restaurar/i })
      await act(async () => {
        fireEvent.click(restoreButton)
        await new Promise(resolve => setTimeout(resolve, 50))
      })

      expect(mockRestoreDeletedDoctor).toHaveBeenCalledWith('3')

      vi.useFakeTimers() // Restore fake timers
    })

    it('should show the translated "Dr. {name} ha sido restaurado" toast after a successful restore', async () => {
      vi.useRealTimers() // Use real timers for async test
      mockDoctorsState.doctors = [mockInactiveDoctor]
      mockDoctorsState.showInactive = true
      mockRestoreDeletedDoctor.mockResolvedValue(undefined)
      renderDoctorsPage()

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /restaurar/i }))
        await new Promise(resolve => setTimeout(resolve, 50))
      })

      expect(screen.getByText('Dr. Carlos López ha sido restaurado')).toBeInTheDocument()

      vi.useFakeTimers() // Restore fake timers
    })
  })

  describe('error handling', () => {
    it('should display error message from store', () => {
      mockDoctorsState.error = 'Error al cargar doctores'
      renderDoctorsPage()

      expect(screen.getByText(/error al cargar doctores/i)).toBeInTheDocument()
    })

    it('should clear error when clicking close button', () => {
      mockDoctorsState.error = 'Error al cargar doctores'
      renderDoctorsPage()

      const closeButton = screen.getByRole('button', { name: /cerrar/i })
      fireEvent.click(closeButton)

      expect(mockClearError).toHaveBeenCalled()
    })
  })

  describe('modal closing', () => {
    it('should close form modal when clicking close button', () => {
      mockDoctorsState.stats = mockStats
      mockDoctorsState.doctors = [mockDoctor1]
      renderDoctorsPage()

      // Open modal
      fireEvent.click(screen.getAllByRole('button', { name: /nuevo doctor/i })[0])
      expect(screen.getByTestId('doctor-form-modal')).toBeInTheDocument()

      // Close modal
      fireEvent.click(screen.getByRole('button', { name: /cerrar/i }))

      expect(screen.queryByTestId('doctor-form-modal')).not.toBeInTheDocument()
    })
  })
})
