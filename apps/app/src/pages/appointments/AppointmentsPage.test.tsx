import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import type { Appointment, AppointmentsStats } from '@/lib/appointment-api'

// Mutable i18n language – mutated by locale regression tests (task #211)
// Must be declared before vi.mock so the factory's inner closure can read it at render time.
const mockI18nState = { language: 'es' }

// Mock i18n
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'appointments.title': 'Citas',
        'appointments.subtitle': 'Gestiona las citas de tu clínica',
        'appointments.scheduled': 'programadas',
        'appointments.completed': 'completadas',
        'appointments.newAppointment': 'Nueva Cita',
        'appointments.addAppointment': 'Agregar Cita',
        'appointments.noAppointments': 'No hay citas',
        'appointments.noAppointmentsInMonth': 'No hay citas en este mes',
        'appointments.statusLabel': 'Estado',
        'appointments.allStatuses': 'Todos los estados',
        'appointments.showCancelled': 'Mostrar canceladas',
        'appointments.previousMonth': 'Mes anterior',
        'appointments.nextMonth': 'Mes siguiente',
        'appointments.appointmentCreated': 'Cita creada exitosamente',
        'appointments.appointmentUpdated': 'Cita actualizada exitosamente',
        'appointments.appointmentCancelled': 'Cita cancelada',
        'appointments.appointmentRestored': 'Cita restaurada',
        'appointments.appointmentCompleted': 'Cita completada',
        'appointments.cancelAppointment': 'Cancelar Cita',
        'appointments.confirmCancel': '¿Estás seguro de que deseas cancelar esta cita?',
        'appointments.keep': 'Mantener',
        'common.today': 'Hoy',
        'common.close': 'Cerrar',
        'common.filter': 'Filtrar',
        'common.clearFilters': 'Limpiar filtros',
        'dates.tomorrow': 'Mañana',
      }
      return translations[key] || key
    },
    i18n: mockI18nState,
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}))

// Mock functions defined before vi.mock
const mockFetchAppointments = vi.fn()
const mockFetchStats = vi.fn()
const mockAddAppointment = vi.fn()
const mockEditAppointment = vi.fn()
const mockRemoveAppointment = vi.fn()
const mockRestoreDeletedAppointment = vi.fn()
const mockCompleteAppointment = vi.fn()
const mockSetSelectedDoctorId = vi.fn()
const mockSetSelectedStatus = vi.fn()
const mockSetShowInactive = vi.fn()
const mockSetCurrentDate = vi.fn()
const mockClearError = vi.fn()

// Mutable state for mocks
const mockAppointmentsState = {
  appointments: [] as Appointment[],
  stats: null as AppointmentsStats | null,
  isLoading: false,
  error: null as string | null,
  selectedDoctorId: null as string | null,
  selectedStatus: null,
  showInactive: false,
  currentDate: new Date('2024-01-15'),
}

// Mock the store
vi.mock('@/stores/appointments.store', () => ({
  useAppointmentsStore: () => ({
    appointments: mockAppointmentsState.appointments,
    stats: mockAppointmentsState.stats,
    isLoading: mockAppointmentsState.isLoading,
    error: mockAppointmentsState.error,
    selectedDoctorId: mockAppointmentsState.selectedDoctorId,
    selectedStatus: mockAppointmentsState.selectedStatus,
    showInactive: mockAppointmentsState.showInactive,
    currentDate: mockAppointmentsState.currentDate,
    fetchAppointments: mockFetchAppointments,
    fetchStats: mockFetchStats,
    addAppointment: mockAddAppointment,
    editAppointment: mockEditAppointment,
    removeAppointment: mockRemoveAppointment,
    restoreDeletedAppointment: mockRestoreDeletedAppointment,
    completeAppointment: mockCompleteAppointment,
    setSelectedDoctorId: mockSetSelectedDoctorId,
    setSelectedStatus: mockSetSelectedStatus,
    setShowInactive: mockSetShowInactive,
    setCurrentDate: mockSetCurrentDate,
    clearError: mockClearError,
  }),
}))

// Mock AppointmentCard component
vi.mock('@/components/appointments/AppointmentCard', () => ({
  AppointmentCard: ({ appointment, onEdit, onDelete, onRestore, onComplete }: any) => (
    <div data-testid={`appointment-card-${appointment.id}`}>
      <span>Appointment {appointment.id}</span>
      <button onClick={() => onEdit(appointment)}>Editar</button>
      <button onClick={() => onDelete(appointment)}>Eliminar</button>
      {appointment.status === 'CANCELLED' && onRestore && (
        <button onClick={() => onRestore(appointment)}>Restaurar</button>
      )}
      {appointment.status === 'CONFIRMED' && onComplete && (
        <button onClick={() => onComplete(appointment)}>Completar</button>
      )}
    </div>
  ),
}))

// Mock AppointmentFormModal component
vi.mock('@/components/appointments/AppointmentFormModal', () => ({
  AppointmentFormModal: ({ isOpen, onClose, onSubmit, appointment, error }: any) => {
    if (!isOpen) return null
    return (
      <div data-testid="appointment-form-modal" role="dialog">
        <h2>{appointment ? 'Editar Cita' : 'Nueva Cita'}</h2>
        {error && <div data-testid="modal-error">{error}</div>}
        <button onClick={onClose}>Cerrar</button>
        <button onClick={async () => {
          await onSubmit({
            patientId: 'patient1',
            doctorId: 'doctor1',
            startTime: '2024-01-15T10:00:00Z',
            endTime: '2024-01-15T11:00:00Z',
            reason: 'Test appointment',
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
  ConfirmDialog: ({ isOpen, onClose, onConfirm, title }: any) => {
    if (!isOpen) return null
    return (
      <div data-testid="confirm-dialog" role="dialog">
        <h2>{title}</h2>
        <button onClick={onClose}>Mantener</button>
        <button onClick={onConfirm}>Confirmar</button>
      </div>
    )
  },
}))

// Import after mocks
import { AppointmentsPage } from './AppointmentsPage'

function renderAppointmentsPage() {
  return render(
    <MemoryRouter>
      <AppointmentsPage />
    </MemoryRouter>
  )
}

// Sample appointments data
const mockAppointment1: Appointment = {
  id: '1',
  tenantId: 'tenant1',
  patientId: 'patient1',
  doctorId: 'doctor1',
  startTime: '2024-01-15T10:00:00Z',
  endTime: '2024-01-15T11:00:00Z',
  status: 'SCHEDULED',
  reason: 'Checkup',
  notes: null,
  isActive: true,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  patient: {
    id: 'patient1',
    firstName: 'Juan',
    lastName: 'Pérez',
  },
  doctor: {
    id: 'doctor1',
    firstName: 'Dr. María',
    lastName: 'García',
  },
}

const mockAppointment2: Appointment = {
  id: '2',
  tenantId: 'tenant1',
  patientId: 'patient2',
  doctorId: 'doctor1',
  startTime: '2024-01-16T14:00:00Z',
  endTime: '2024-01-16T15:00:00Z',
  status: 'CONFIRMED',
  reason: 'Follow-up',
  notes: null,
  isActive: true,
  createdAt: '2024-01-02T00:00:00Z',
  updatedAt: '2024-01-02T00:00:00Z',
  patient: {
    id: 'patient2',
    firstName: 'Ana',
    lastName: 'López',
  },
  doctor: {
    id: 'doctor1',
    firstName: 'Dr. María',
    lastName: 'García',
  },
}

const mockCancelledAppointment: Appointment = {
  id: '3',
  tenantId: 'tenant1',
  patientId: 'patient1',
  doctorId: 'doctor1',
  startTime: '2024-01-17T09:00:00Z',
  endTime: '2024-01-17T10:00:00Z',
  status: 'CANCELLED',
  reason: 'Cleaning',
  notes: null,
  isActive: false,
  createdAt: '2024-01-03T00:00:00Z',
  updatedAt: '2024-01-03T00:00:00Z',
  patient: {
    id: 'patient1',
    firstName: 'Juan',
    lastName: 'Pérez',
  },
  doctor: {
    id: 'doctor1',
    firstName: 'Dr. María',
    lastName: 'García',
  },
}

// Appointment on Wed 2024-01-10 (noon UTC) – far enough from midnight to be safe in
// any timezone.  Neither "today" (Jan 15) nor "tomorrow" (Jan 16), so formatDateHeader
// falls through to toLocaleDateString and returns "miércoles, 10 de enero" in ES.
const mockAppointmentPastDate: Appointment = {
  id: '4',
  tenantId: 'tenant1',
  patientId: 'patient1',
  doctorId: 'doctor1',
  startTime: '2024-01-10T12:00:00Z',
  endTime: '2024-01-10T13:00:00Z',
  status: 'COMPLETED',
  reason: 'Past appointment',
  notes: null,
  isActive: true,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  patient: {
    id: 'patient1',
    firstName: 'Juan',
    lastName: 'Pérez',
  },
  doctor: {
    id: 'doctor1',
    firstName: 'Dr. María',
    lastName: 'García',
  },
}

const mockStats: AppointmentsStats = {
  scheduled: 5,
  confirmed: 3,
  inProgress: 0,
  completed: 10,
  cancelled: 2,
  noShow: 1,
  rescheduled: 0,
  total: 21,
}

describe('AppointmentsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-15'))
    mockI18nState.language = 'es'
    mockAppointmentsState.appointments = []
    mockAppointmentsState.stats = null
    mockAppointmentsState.isLoading = false
    mockAppointmentsState.error = null
    mockAppointmentsState.selectedDoctorId = null
    mockAppointmentsState.selectedStatus = null
    mockAppointmentsState.showInactive = false
    mockAppointmentsState.currentDate = new Date('2024-01-15')
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  describe('rendering', () => {
    it('should render the page title and subtitle', () => {
      mockAppointmentsState.appointments = [mockAppointment1] // Avoid empty state
      renderAppointmentsPage()

      expect(screen.getByRole('heading', { name: /^citas$/i })).toBeInTheDocument()
      expect(screen.getByText(/gestiona las citas de tu clínica/i)).toBeInTheDocument()
    })

    it('should render the "Nueva Cita" button', () => {
      mockAppointmentsState.appointments = [mockAppointment1] // Avoid empty state
      renderAppointmentsPage()

      const buttons = screen.getAllByRole('button', { name: /nueva cita/i })
      expect(buttons.length).toBeGreaterThan(0)
    })

    it('should display stats when available', () => {
      mockAppointmentsState.stats = mockStats
      mockAppointmentsState.appointments = [mockAppointment1] // Avoid empty state
      renderAppointmentsPage()

      expect(screen.getByText(/5 programadas, 10 completadas/i)).toBeInTheDocument()
    })

    it('should render calendar navigation', () => {
      mockAppointmentsState.appointments = [mockAppointment1] // Avoid empty state
      renderAppointmentsPage()

      expect(screen.getByLabelText(/mes anterior/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/mes siguiente/i)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /hoy/i })).toBeInTheDocument()
    })

    it('should display current month and year', () => {
      mockAppointmentsState.appointments = [mockAppointment1] // Avoid empty state
      renderAppointmentsPage()

      expect(screen.getByText(/enero de 2024/i)).toBeInTheDocument()
    })
  })

  describe('data fetching', () => {
    it('should fetch appointments and stats on mount', () => {
      renderAppointmentsPage()

      expect(mockFetchAppointments).toHaveBeenCalledWith({
        from: expect.any(String),
        to: expect.any(String),
      })
      expect(mockFetchStats).toHaveBeenCalledWith({
        from: expect.any(String),
        to: expect.any(String),
      })
    })
  })

  describe('calendar navigation', () => {
    it('should navigate to previous month', () => {
      renderAppointmentsPage()

      const prevButton = screen.getByLabelText(/mes anterior/i)
      fireEvent.click(prevButton)

      expect(mockSetCurrentDate).toHaveBeenCalledWith(expect.any(Date))
    })

    it('should navigate to next month', () => {
      renderAppointmentsPage()

      const nextButton = screen.getByLabelText(/mes siguiente/i)
      fireEvent.click(nextButton)

      expect(mockSetCurrentDate).toHaveBeenCalledWith(expect.any(Date))
    })

    it('should navigate to today', () => {
      renderAppointmentsPage()

      const todayButton = screen.getByRole('button', { name: /hoy/i })
      fireEvent.click(todayButton)

      expect(mockSetCurrentDate).toHaveBeenCalledWith(expect.any(Date))
    })
  })

  describe('filters', () => {
    it('should toggle filters panel', () => {
      renderAppointmentsPage()

      const filterButton = screen.getByRole('button', { name: /filtrar/i })
      fireEvent.click(filterButton)

      const statusLabels = screen.getAllByText(/estado/i)
      expect(statusLabels.length).toBeGreaterThan(0)
      expect(screen.getByLabelText(/mostrar canceladas/i)).toBeInTheDocument()
    })

    it('should show filter count badge when filters are active', () => {
      mockAppointmentsState.selectedStatus = 'SCHEDULED'
      mockAppointmentsState.showInactive = true
      renderAppointmentsPage()

      const filterButton = screen.getByRole('button', { name: /filtrar/i })
      expect(filterButton).toHaveTextContent('2')
    })

    it('should update status filter', () => {
      renderAppointmentsPage()

      // Open filters
      fireEvent.click(screen.getByRole('button', { name: /filtrar/i }))

      // Select status by finding the select element
      const statusSelects = document.querySelectorAll('select')
      const statusSelect = statusSelects[0] // First select is the status filter
      fireEvent.change(statusSelect, { target: { value: 'SCHEDULED' } })

      expect(mockSetSelectedStatus).toHaveBeenCalledWith('SCHEDULED')
    })

    it('should toggle showInactive filter', () => {
      renderAppointmentsPage()

      // Open filters
      fireEvent.click(screen.getByRole('button', { name: /filtrar/i }))

      // Toggle checkbox
      const checkbox = screen.getByLabelText(/mostrar canceladas/i)
      fireEvent.click(checkbox)

      expect(mockSetShowInactive).toHaveBeenCalledWith(true)
    })

    it('should clear all filters', () => {
      mockAppointmentsState.selectedStatus = 'SCHEDULED'
      mockAppointmentsState.showInactive = true
      renderAppointmentsPage()

      // Open filters
      fireEvent.click(screen.getByRole('button', { name: /filtrar/i }))

      // Clear filters
      const clearButton = screen.getByRole('button', { name: /limpiar filtros/i })
      fireEvent.click(clearButton)

      expect(mockSetSelectedDoctorId).toHaveBeenCalledWith(null)
      expect(mockSetSelectedStatus).toHaveBeenCalledWith(null)
      expect(mockSetShowInactive).toHaveBeenCalledWith(false)
    })
  })

  describe('loading state', () => {
    it('should show loading spinner when loading and no appointments', () => {
      mockAppointmentsState.isLoading = true
      mockAppointmentsState.appointments = []
      renderAppointmentsPage()

      const spinner = document.querySelector('.animate-spin')
      expect(spinner).toBeInTheDocument()
    })

    it('should not show loading spinner when appointments exist', () => {
      mockAppointmentsState.isLoading = true
      mockAppointmentsState.appointments = [mockAppointment1]
      renderAppointmentsPage()

      const spinner = document.querySelector('.animate-spin')
      expect(spinner).not.toBeInTheDocument()
    })
  })

  describe('empty state', () => {
    it('should show empty state when no appointments', () => {
      mockAppointmentsState.appointments = []
      renderAppointmentsPage()

      expect(screen.getByRole('heading', { name: /no hay citas/i })).toBeInTheDocument()
      expect(screen.getByText(/no hay citas en este mes/i)).toBeInTheDocument()
    })

    it('should show "Agregar Cita" button in empty state', () => {
      mockAppointmentsState.appointments = []
      renderAppointmentsPage()

      expect(screen.getByRole('button', { name: /agregar cita/i })).toBeInTheDocument()
    })
  })

  describe('appointment list', () => {
    it('should render list of appointments grouped by date', () => {
      mockAppointmentsState.appointments = [mockAppointment1, mockAppointment2]
      renderAppointmentsPage()

      expect(screen.getByTestId('appointment-card-1')).toBeInTheDocument()
      expect(screen.getByTestId('appointment-card-2')).toBeInTheDocument()
    })

    it('should render cancelled appointments with restore button', () => {
      mockAppointmentsState.appointments = [mockCancelledAppointment]
      renderAppointmentsPage()

      expect(screen.getByTestId('appointment-card-3')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /restaurar/i })).toBeInTheDocument()
    })

    it('should render confirmed appointments with complete button', () => {
      mockAppointmentsState.appointments = [mockAppointment2]
      renderAppointmentsPage()

      expect(screen.getByTestId('appointment-card-2')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /completar/i })).toBeInTheDocument()
    })
  })

  describe('create appointment', () => {
    it('should open create modal when clicking "Nueva Cita"', () => {
      renderAppointmentsPage()

      const button = screen.getByRole('button', { name: /nueva cita/i })
      fireEvent.click(button)

      expect(screen.getByTestId('appointment-form-modal')).toBeInTheDocument()
    })

    it('should call addAppointment when submitting create form', async () => {
      vi.useRealTimers()
      mockAddAppointment.mockResolvedValue(undefined)
      renderAppointmentsPage()

      // Open modal
      fireEvent.click(screen.getByRole('button', { name: /nueva cita/i }))

      // Submit form
      const saveButton = screen.getByRole('button', { name: /guardar/i })
      await act(async () => {
        fireEvent.click(saveButton)
        await new Promise(resolve => setTimeout(resolve, 50))
      })

      expect(mockAddAppointment).toHaveBeenCalled()

      vi.useFakeTimers()
    })
  })

  describe('edit appointment', () => {
    it('should open edit modal when clicking edit button', () => {
      mockAppointmentsState.appointments = [mockAppointment1]
      renderAppointmentsPage()

      const editButton = screen.getAllByRole('button', { name: /editar/i })[0]
      fireEvent.click(editButton)

      expect(screen.getByTestId('appointment-form-modal')).toBeInTheDocument()
      expect(screen.getByText(/editar cita/i)).toBeInTheDocument()
    })

    it('should call editAppointment when submitting edit form', async () => {
      vi.useRealTimers()
      mockAppointmentsState.appointments = [mockAppointment1]
      mockEditAppointment.mockResolvedValue(undefined)
      renderAppointmentsPage()

      // Open edit modal
      const editButton = screen.getAllByRole('button', { name: /editar/i })[0]
      fireEvent.click(editButton)

      // Submit form
      const saveButton = screen.getByRole('button', { name: /guardar/i })
      await act(async () => {
        fireEvent.click(saveButton)
        await new Promise(resolve => setTimeout(resolve, 50))
      })

      expect(mockEditAppointment).toHaveBeenCalled()

      vi.useFakeTimers()
    })
  })

  describe('delete appointment', () => {
    it('should open confirm dialog when clicking delete button', () => {
      mockAppointmentsState.appointments = [mockAppointment1]
      renderAppointmentsPage()

      const deleteButton = screen.getAllByRole('button', { name: /eliminar/i })[0]
      fireEvent.click(deleteButton)

      expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument()
      expect(screen.getByText(/cancelar cita/i)).toBeInTheDocument()
    })

    it('should call removeAppointment when confirming deletion', async () => {
      vi.useRealTimers()
      mockAppointmentsState.appointments = [mockAppointment1]
      mockRemoveAppointment.mockResolvedValue(undefined)
      renderAppointmentsPage()

      // Open confirm dialog
      const deleteButton = screen.getAllByRole('button', { name: /eliminar/i })[0]
      fireEvent.click(deleteButton)

      // Confirm deletion
      const confirmButton = screen.getByRole('button', { name: /confirmar/i })
      await act(async () => {
        fireEvent.click(confirmButton)
        await new Promise(resolve => setTimeout(resolve, 50))
      })

      expect(mockRemoveAppointment).toHaveBeenCalledWith('1')

      vi.useFakeTimers()
    })

    it('should close confirm dialog when clicking cancel', () => {
      mockAppointmentsState.appointments = [mockAppointment1]
      renderAppointmentsPage()

      // Open and cancel
      fireEvent.click(screen.getAllByRole('button', { name: /eliminar/i })[0])
      expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: /mantener/i }))

      expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument()
    })
  })

  describe('restore appointment', () => {
    it('should call restoreDeletedAppointment when clicking restore button', async () => {
      vi.useRealTimers()
      mockAppointmentsState.appointments = [mockCancelledAppointment]
      mockRestoreDeletedAppointment.mockResolvedValue(undefined)
      renderAppointmentsPage()

      const restoreButton = screen.getByRole('button', { name: /restaurar/i })
      await act(async () => {
        fireEvent.click(restoreButton)
        await new Promise(resolve => setTimeout(resolve, 50))
      })

      expect(mockRestoreDeletedAppointment).toHaveBeenCalledWith('3')

      vi.useFakeTimers()
    })
  })

  describe('complete appointment', () => {
    it('should call completeAppointment when clicking complete button', async () => {
      vi.useRealTimers()
      mockAppointmentsState.appointments = [mockAppointment2]
      mockCompleteAppointment.mockResolvedValue(undefined)
      renderAppointmentsPage()

      const completeButton = screen.getByRole('button', { name: /completar/i })
      await act(async () => {
        fireEvent.click(completeButton)
        await new Promise(resolve => setTimeout(resolve, 50))
      })

      expect(mockCompleteAppointment).toHaveBeenCalledWith('2')

      vi.useFakeTimers()
    })
  })

  describe('error handling', () => {
    it('should display error message from store', () => {
      mockAppointmentsState.error = 'Error al cargar citas'
      renderAppointmentsPage()

      expect(screen.getByText(/error al cargar citas/i)).toBeInTheDocument()
    })

    it('should clear error when clicking close button', () => {
      mockAppointmentsState.error = 'Error al cargar citas'
      renderAppointmentsPage()

      const closeButton = screen.getByRole('button', { name: /cerrar/i })
      fireEvent.click(closeButton)

      expect(mockClearError).toHaveBeenCalled()
    })

    it('should display error inside modal when form submission fails', async () => {
      mockAddAppointment.mockRejectedValueOnce(new Error('Conflict'))
      mockAppointmentsState.error = 'El doctor ya tiene una cita en este horario'
      renderAppointmentsPage()

      // Open modal
      fireEvent.click(screen.getByRole('button', { name: /nueva cita/i }))

      // Error should be visible inside the modal
      const modal = screen.getByTestId('appointment-form-modal')
      expect(modal).toBeInTheDocument()
      const modalError = screen.getByTestId('modal-error')
      expect(modalError).toHaveTextContent('El doctor ya tiene una cita en este horario')
    })

    it('should clear error when opening the form', () => {
      mockAppointmentsState.error = 'Some error'
      renderAppointmentsPage()

      fireEvent.click(screen.getByRole('button', { name: /nueva cita/i }))

      expect(mockClearError).toHaveBeenCalled()
    })
  })

  describe('modal closing', () => {
    it('should close form modal when clicking close button', () => {
      renderAppointmentsPage()

      // Open modal
      fireEvent.click(screen.getByRole('button', { name: /nueva cita/i }))
      expect(screen.getByTestId('appointment-form-modal')).toBeInTheDocument()

      // Close modal
      fireEvent.click(screen.getByRole('button', { name: /cerrar/i }))

      expect(screen.queryByTestId('appointment-form-modal')).not.toBeInTheDocument()
    })
  })

  // ── task #211 regression: calendar date de-casing ─────────────────────────
  // These tests pin the two fixes shipped in task #211 so neither can silently
  // regress:
  //   1. formatMonthYear now uses i18n.language (not a hardcoded 'es-ES') so
  //      the month-year <h2> localises per the active language.
  //   2. The day-group <h3> lost the `uppercase` / `capitalize` Tailwind classes
  //      and now carries `first-letter:uppercase` only, so the connector "de"
  //      stays lowercase in the source string (CSS handles the visual cap).
  // ──────────────────────────────────────────────────────────────────────────
  describe('date casing and locale regression (task #211)', () => {
    it('Spanish month-year h2 source text has lowercase connector "de", not title-cased "De"', () => {
      // formatMonthYear(new Date('2024-01-15')) with language 'es'
      // → "enero de 2024" (all lowercase; CSS first-letter:uppercase gives visual "E")
      mockAppointmentsState.appointments = [mockAppointment1]
      renderAppointmentsPage()

      const h2 = screen.getByRole('heading', { level: 2 })
      expect(h2.textContent).toMatch(/enero de 2024/)
      // The connector must NOT be title-cased in the DOM source
      expect(h2.textContent).not.toMatch(/ De /)
    })

    it('month-year h2 element carries first-letter:uppercase and lacks standalone capitalize/uppercase classes', () => {
      mockAppointmentsState.appointments = [mockAppointment1]
      renderAppointmentsPage()

      const h2 = screen.getByRole('heading', { level: 2 })
      const classes = h2.className.split(' ')
      // Tailwind utility that visually uppercases only the first letter
      expect(classes).toContain('first-letter:uppercase')
      // These two were removed by the fix and must not reappear
      expect(classes).not.toContain('capitalize')
      expect(classes).not.toContain('uppercase')
    })

    it('day-group h3 source text has lowercase connector "de" for a non-today/tomorrow date', () => {
      // 2024-01-10 is Wednesday – neither today (Jan 15) nor tomorrow (Jan 16).
      // formatDateHeader falls through to toLocaleDateString('es', {weekday,day,month})
      // → "miércoles, 10 de enero"  (lowercase connector "de")
      mockAppointmentsState.appointments = [mockAppointmentPastDate]
      renderAppointmentsPage()

      const h3 = screen.getByRole('heading', { level: 3 })
      expect(h3.textContent).toMatch(/de enero/)
      // Must not be title-cased (old capitalize class) or all-caps (old uppercase class)
      expect(h3.textContent).not.toMatch(/De Enero/)
      expect(h3.textContent).not.toMatch(/DE ENERO/)
    })

    it('day-group h3 element carries first-letter:uppercase and lacks standalone capitalize/uppercase classes', () => {
      mockAppointmentsState.appointments = [mockAppointmentPastDate]
      renderAppointmentsPage()

      const h3 = screen.getByRole('heading', { level: 3 })
      const classes = h3.className.split(' ')
      expect(classes).toContain('first-letter:uppercase')
      // Removed by the fix – must not return
      expect(classes).not.toContain('capitalize')
      expect(classes).not.toContain('uppercase')
    })

    it('month-year localizes to English when language is "en"', () => {
      // formatMonthYear uses i18n.language; switching to 'en' must change the output.
      // toLocaleDateString('en', { month:'long', year:'numeric' }) → "January 2024"
      mockI18nState.language = 'en'
      mockAppointmentsState.appointments = [mockAppointment1]
      renderAppointmentsPage()

      const h2 = screen.getByRole('heading', { level: 2 })
      expect(h2.textContent).toMatch(/January 2024/)
      // Spanish month must not appear when locale is English
      expect(h2.textContent).not.toMatch(/enero/i)
    })

    it('month-year does not show Spanish month name when language is "ar"', () => {
      // Arabic ICU output differs per environment, so we only assert it is NOT Spanish.
      // "يناير 2024" is the expected Arabic output; "enero" must be absent.
      mockI18nState.language = 'ar'
      mockAppointmentsState.appointments = [mockAppointment1]
      renderAppointmentsPage()

      const h2 = screen.getByRole('heading', { level: 2 })
      expect(h2.textContent).not.toMatch(/enero/i)
    })
  })
})
