import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import { Permission } from '@dental/shared'
import { PatientAppointmentsSection } from './PatientAppointmentsSection'
import type { Appointment } from '@/lib/appointment-api'

// ============================================================================
// Mocks
// ============================================================================

const mockGetAppointmentsByPatient = vi.fn()
const mockMarkAppointmentDone = vi.fn()
const mockDeleteAppointment = vi.fn()
const mockDeletePayment = vi.fn()

vi.mock('@/lib/payment-api', () => ({
  deletePayment: (...args: unknown[]) => mockDeletePayment(...args),
}))

vi.mock('@/lib/appointment-api', () => ({
  getAppointmentsByPatient: (...args: unknown[]) => mockGetAppointmentsByPatient(...args),
  markAppointmentDone: (...args: unknown[]) => mockMarkAppointmentDone(...args),
  deleteAppointment: (...args: unknown[]) => mockDeleteAppointment(...args),
  getStatusBadgeClasses: () => 'bg-blue-100 text-blue-800',
  formatTimeRange: (start: string, end: string) => {
    const s = new Date(start)
    const e = new Date(end)
    return `${s.getHours()}:${String(s.getMinutes()).padStart(2, '0')} - ${e.getHours()}:${String(e.getMinutes()).padStart(2, '0')}`
  },
  getAppointmentDoctorName: (a: Appointment) =>
    a.doctor ? `${a.doctor.firstName} ${a.doctor.lastName}` : 'Unknown',
  getStatusI18nKey: (status: string) => status.toLowerCase(),
}))

// PR D-3: "Completar" now opens AppointmentCompleteModal instead of the
// shared inline confirm dialog — that modal's own behavior (budget item
// toggles, notes, completeAppointment payload) is covered by
// AppointmentCompleteModal.test.tsx. Stub it here to a minimal dialog so this
// page's tests can assert it opens for the right appointment and that
// onCompleted triggers a refresh.
vi.mock('@/components/appointments/AppointmentCompleteModal', () => ({
  AppointmentCompleteModal: ({ isOpen, appointmentId, onCompleted }: any) => {
    if (!isOpen) return null
    return (
      <div data-testid="appointment-complete-modal" role="dialog">
        <span data-testid="complete-modal-appointment-id">{appointmentId}</span>
        <button onClick={onCompleted}>Confirmar completar</button>
      </div>
    )
  },
}))

vi.mock('@/lib/pdf-api', () => ({
  downloadAppointmentPdf: vi.fn(),
}))

vi.mock('@/lib/format', () => ({
  formatCurrency: (amount: number) => `$${amount}`,
}))

let mockCanPermission = true
// #384: independently controls Permission.PAYMENTS_DELETE, gating the
// "Revertir pago de consulta" kebab-menu item. Defaults to granted so
// existing tests (which never touch payment reversal) are unaffected.
let mockCanDeletePayments = true
vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => ({
    can: (permission: string) => {
      if (permission === Permission.APPOINTMENTS_CREATE) return mockCanPermission
      if (permission === Permission.PAYMENTS_DELETE) return mockCanDeletePayments
      return false
    },
  }),
}))

vi.mock('@/stores/auth.store', () => ({
  useAuthStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ user: { tenant: { currency: 'USD' } } }),
}))

// #391: t() now receives an interpolation options object for
// payments.cancelWithRecordedPayment (and payment.appliedOf already did).
// Serialize options into the returned string so cancel-warning tests can
// assert on the exact amount that was passed, instead of the raw key.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => (options ? `${key}:${JSON.stringify(options)}` : key),
    i18n: { language: 'es' },
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}))

vi.mock('@/i18n', () => ({
  default: { language: 'es' },
}))

// ============================================================================
// Test Data
// ============================================================================

function futureDate(daysFromNow: number): string {
  const d = new Date()
  d.setDate(d.getDate() + daysFromNow)
  d.setHours(10, 0, 0, 0)
  return d.toISOString()
}

function futureEndDate(daysFromNow: number): string {
  const d = new Date()
  d.setDate(d.getDate() + daysFromNow)
  d.setHours(11, 0, 0, 0)
  return d.toISOString()
}

function pastDate(daysAgo: number): string {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  d.setHours(10, 0, 0, 0)
  return d.toISOString()
}

function pastEndDate(daysAgo: number): string {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  d.setHours(11, 0, 0, 0)
  return d.toISOString()
}

const mockDoctor = { id: 'd1', firstName: 'Carlos', lastName: 'Lopez', specialty: 'General', email: null }

const upcomingAppointment: Appointment = {
  id: 'a1',
  tenantId: 't1',
  patientId: 'p1',
  doctorId: 'd1',
  startTime: futureDate(3),
  endTime: futureEndDate(3),
  duration: 60,
  status: 'SCHEDULED',
  type: 'Limpieza',
  notes: null,
  privateNotes: null,
  cost: 100,
  isPaid: false,
  isActive: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  doctor: mockDoctor,
}

const pastAppointment: Appointment = {
  ...upcomingAppointment,
  id: 'a2',
  startTime: pastDate(5),
  endTime: pastEndDate(5),
  status: 'COMPLETED',
  type: 'Control',
}

const cancelledAppointment: Appointment = {
  ...upcomingAppointment,
  id: 'a3',
  status: 'CANCELLED',
  type: 'Cancelada',
  isActive: false,
}

const noShowAppointment: Appointment = {
  ...upcomingAppointment,
  id: 'a5',
  startTime: futureDate(2),
  endTime: futureEndDate(2),
  status: 'NO_SHOW',
  type: 'Ausente',
  isActive: true,
}

// #384: an appointment with a recorded (kind=APPOINTMENT) consultation
// payment linked to it.
// #390: the "Cobrado en consulta (reversible)" line is shown only in the
// mixed case (recordedPaidAmount < paidAmount) — see the table in the
// "consultation payment reversal" describe block below. This base fixture
// is deliberately the mixed case: fully-earmarked $75 recorded payment plus
// $25 more from the FIFO pool/advances, covering the full $100 cost.
const paidConsultationAppointment: Appointment = {
  ...upcomingAppointment,
  id: 'a6',
  type: 'Consulta pagada',
  isPaid: true,
  paidAmount: 100,
  hasRecordedPayment: true,
  recordedPaidAmount: 75,
  recordedPaymentId: 'pay-1',
}

// #391: fully paid ONLY through FIFO allocation of older advances — no
// payment recorded directly against this appointment. The cancel warning
// must never show for this shape.
const fifoPaidOnlyAppointment: Appointment = {
  ...upcomingAppointment,
  id: 'a7',
  type: 'Pagada por pool',
  isPaid: true,
  paidAmount: 100,
  hasRecordedPayment: false,
  recordedPaidAmount: 0,
  recordedPaymentId: null,
}

// ============================================================================
// Helpers
// ============================================================================

const defaultProps = {
  patientId: 'p1',
  onNewAppointment: vi.fn(),
  onEditAppointment: vi.fn(),
  refreshKey: 0,
}

function renderSection(props = {}) {
  return render(<PatientAppointmentsSection {...defaultProps} {...props} />)
}

// ============================================================================
// Tests
// ============================================================================

describe('PatientAppointmentsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCanPermission = true
    mockCanDeletePayments = true
    localStorage.clear()
    mockGetAppointmentsByPatient.mockResolvedValue([upcomingAppointment])
  })

  // --------------------------------------------------------------------------
  // Collapse behavior
  // --------------------------------------------------------------------------

  describe('collapse behavior', () => {
    it('renders collapsed by default', async () => {
      renderSection()
      await waitFor(() => {
        expect(screen.getByText('patients.appointments.sectionTitle')).toBeInTheDocument()
      })
      // Should NOT show the empty state or cards when collapsed
      expect(screen.queryByText('patients.appointments.noUpcoming')).not.toBeInTheDocument()
    })

    it('expands when clicking the header', async () => {
      renderSection()
      await waitFor(() => {
        expect(mockGetAppointmentsByPatient).toHaveBeenCalled()
      })

      fireEvent.click(screen.getByText('patients.appointments.sectionTitle'))

      await waitFor(() => {
        expect(screen.getByText('Limpieza')).toBeInTheDocument()
      })
    })

    it('persists collapse state to localStorage', async () => {
      renderSection()
      await waitFor(() => {
        expect(mockGetAppointmentsByPatient).toHaveBeenCalled()
      })

      // Expand
      fireEvent.click(screen.getByText('patients.appointments.sectionTitle'))
      expect(localStorage.getItem('patient-appointments-collapsed')).toBe('false')

      // Collapse again
      fireEvent.click(screen.getByText('patients.appointments.sectionTitle'))
      expect(localStorage.getItem('patient-appointments-collapsed')).toBe('true')
    })

    it('starts expanded if localStorage says false', async () => {
      localStorage.setItem('patient-appointments-collapsed', 'false')
      renderSection()

      await waitFor(() => {
        expect(screen.getByText('Limpieza')).toBeInTheDocument()
      })
    })
  })

  // --------------------------------------------------------------------------
  // Data display
  // --------------------------------------------------------------------------

  describe('appointment cards', () => {
    it('shows upcoming appointments ordered by date', async () => {
      const second = {
        ...upcomingAppointment,
        id: 'a4',
        startTime: futureDate(1),
        endTime: futureEndDate(1),
        type: 'Revision',
      }
      mockGetAppointmentsByPatient.mockResolvedValue([upcomingAppointment, second])
      localStorage.setItem('patient-appointments-collapsed', 'false')

      renderSection()

      await waitFor(() => {
        expect(screen.getByText('Revision')).toBeInTheDocument()
        expect(screen.getByText('Limpieza')).toBeInTheDocument()
      })

      // Revision (1 day) should appear before Limpieza (3 days)
      const cards = screen.getAllByText(/Revision|Limpieza/)
      expect(cards[0].textContent).toBe('Revision')
      expect(cards[1].textContent).toBe('Limpieza')
    })

    it('shows doctor name on cards', async () => {
      localStorage.setItem('patient-appointments-collapsed', 'false')
      renderSection()

      await waitFor(() => {
        expect(screen.getByText('Carlos Lopez')).toBeInTheDocument()
      })
    })

    it('shows cost with paid/pending indicator', async () => {
      localStorage.setItem('patient-appointments-collapsed', 'false')
      renderSection()

      await waitFor(() => {
        expect(screen.getByText('$100')).toBeInTheDocument()
        expect(screen.getByText('(payment.pending)')).toBeInTheDocument()
      })
    })

    it('shows empty state when no upcoming appointments', async () => {
      mockGetAppointmentsByPatient.mockResolvedValue([pastAppointment])
      localStorage.setItem('patient-appointments-collapsed', 'false')

      renderSection()

      await waitFor(() => {
        expect(screen.getByText('patients.appointments.noUpcoming')).toBeInTheDocument()
      })
    })

    it('shows upcoming count badge in header', async () => {
      renderSection()

      await waitFor(() => {
        expect(screen.getByText('1')).toBeInTheDocument()
      })
    })
  })

  // --------------------------------------------------------------------------
  // Permissions
  // --------------------------------------------------------------------------

  describe('permissions', () => {
    it('shows New Appointment button with APPOINTMENTS_CREATE permission', async () => {
      renderSection()

      await waitFor(() => {
        expect(screen.getByText('appointments.newAppointment')).toBeInTheDocument()
      })
    })

    it('hides New Appointment button without permission', async () => {
      mockCanPermission = false
      renderSection()

      await waitFor(() => {
        expect(mockGetAppointmentsByPatient).toHaveBeenCalled()
      })
      expect(screen.queryByText('appointments.newAppointment')).not.toBeInTheDocument()
    })

    it('calls onNewAppointment when button is clicked', async () => {
      renderSection()

      await waitFor(() => {
        expect(screen.getByText('appointments.newAppointment')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('appointments.newAppointment'))
      expect(defaultProps.onNewAppointment).toHaveBeenCalled()
    })
  })

  // --------------------------------------------------------------------------
  // Filters
  // --------------------------------------------------------------------------

  describe('filters', () => {
    beforeEach(() => {
      localStorage.setItem('patient-appointments-collapsed', 'false')
      mockGetAppointmentsByPatient.mockResolvedValue([
        upcomingAppointment,
        pastAppointment,
        cancelledAppointment,
      ])
    })

    it('shows filter options when expanded', async () => {
      renderSection()

      await waitFor(() => {
        expect(screen.getByText('patients.appointments.upcoming')).toBeInTheDocument()
        expect(screen.getByText('patients.appointments.past')).toBeInTheDocument()
        expect(screen.getByText('patients.appointments.all')).toBeInTheDocument()
      })
    })

    it('switches to past view and shows past appointments', async () => {
      renderSection()

      await waitFor(() => {
        expect(screen.getByText('Limpieza')).toBeInTheDocument()
      })

      // Switch to past
      fireEvent.click(screen.getByText('patients.appointments.past'))

      await waitFor(() => {
        expect(screen.getByText('Control')).toBeInTheDocument()
      })
      expect(screen.queryByText('Limpieza')).not.toBeInTheDocument()
    })

    it('shows all appointments when "all" is selected', async () => {
      renderSection()

      await waitFor(() => {
        expect(screen.getAllByText('Limpieza').length).toBeGreaterThan(0)
      })

      fireEvent.click(screen.getByText('patients.appointments.all'))

      await waitFor(() => {
        expect(screen.getAllByText('Limpieza').length).toBeGreaterThanOrEqual(1)
        expect(screen.getByText('Control')).toBeInTheDocument()
      })
    })

    it('shows clear filters link when filters are active', async () => {
      renderSection()

      await waitFor(() => {
        expect(screen.getByText('patients.appointments.upcoming')).toBeInTheDocument()
      })

      // Default is 'upcoming', so clearFilters should not be shown initially
      // Switch to 'past' to activate a filter
      fireEvent.click(screen.getByText('patients.appointments.past'))

      expect(screen.getByText('patients.appointments.clearFilters')).toBeInTheDocument()

      // Click clear
      fireEvent.click(screen.getByText('patients.appointments.clearFilters'))

      // Should be back to upcoming (default)
      await waitFor(() => {
        expect(screen.getByText('Limpieza')).toBeInTheDocument()
      })
    })

    it('hides cancelled appointments by default in the "all" period', async () => {
      renderSection()

      await waitFor(() => {
        expect(screen.getByText('Limpieza')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('patients.appointments.all'))

      await waitFor(() => {
        expect(screen.getByText('Control')).toBeInTheDocument()
      })
      expect(screen.queryByText('Cancelada')).not.toBeInTheDocument()
    })

    it('hides cancelled appointments by default in the "past" period', async () => {
      renderSection()

      await waitFor(() => {
        expect(screen.getByText('Limpieza')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('patients.appointments.past'))

      await waitFor(() => {
        expect(screen.getByText('Control')).toBeInTheDocument()
      })
      expect(screen.queryByText('Cancelada')).not.toBeInTheDocument()
    })

    it('reveals cancelled appointments when the "show cancelled" checkbox is checked, and hides them again when unchecked', async () => {
      renderSection()

      await waitFor(() => {
        expect(screen.getByText('Limpieza')).toBeInTheDocument()
      })

      // Switch to "all" so the cancelled appointment's future startTime is in range.
      fireEvent.click(screen.getByText('patients.appointments.all'))
      await waitFor(() => {
        expect(screen.getByText('Control')).toBeInTheDocument()
      })
      expect(screen.queryByText('Cancelada')).not.toBeInTheDocument()

      const checkbox = screen.getByRole('checkbox', { name: 'appointments.showCancelled' })
      expect(checkbox).not.toBeChecked()

      fireEvent.click(checkbox)

      await waitFor(() => {
        expect(screen.getByText('Cancelada')).toBeInTheDocument()
      })
      expect(checkbox).toBeChecked()

      fireEvent.click(checkbox)

      await waitFor(() => {
        expect(screen.queryByText('Cancelada')).not.toBeInTheDocument()
      })
      expect(checkbox).not.toBeChecked()
    })

    it('does not refetch appointments when toggling the "show cancelled" checkbox', async () => {
      renderSection()

      await waitFor(() => {
        expect(screen.getByText('Limpieza')).toBeInTheDocument()
      })

      const callsBeforeToggle = mockGetAppointmentsByPatient.mock.calls.length

      const checkbox = screen.getByRole('checkbox', { name: 'appointments.showCancelled' })
      fireEvent.click(checkbox)
      fireEvent.click(checkbox)

      expect(mockGetAppointmentsByPatient.mock.calls.length).toBe(callsBeforeToggle)
    })

    it('shows cancelled appointments when CANCELLED is explicitly selected in the status filter, even with the checkbox unchecked', async () => {
      renderSection()

      await waitFor(() => {
        expect(screen.getByText('Limpieza')).toBeInTheDocument()
      })

      const checkbox = screen.getByRole('checkbox', { name: 'appointments.showCancelled' })
      expect(checkbox).not.toBeChecked()

      fireEvent.change(screen.getByDisplayValue('appointments.allStatuses'), {
        target: { value: 'CANCELLED' },
      })

      await waitFor(() => {
        expect(screen.getByText('Cancelada')).toBeInTheDocument()
      })
      expect(checkbox).not.toBeChecked()
    })

    it('keeps a NO_SHOW appointment visible with default filters — only CANCELLED is hidden', async () => {
      mockGetAppointmentsByPatient.mockResolvedValue([
        upcomingAppointment,
        pastAppointment,
        cancelledAppointment,
        noShowAppointment,
      ])

      renderSection()

      await waitFor(() => {
        expect(screen.getByText('Ausente')).toBeInTheDocument()
      })
      expect(screen.queryByText('Cancelada')).not.toBeInTheDocument()
    })

    it('resets the "show cancelled" checkbox via clear filters, and shows the clear-filters link when only the checkbox is checked', async () => {
      renderSection()

      await waitFor(() => {
        expect(screen.getByText('Limpieza')).toBeInTheDocument()
      })

      expect(screen.queryByText('patients.appointments.clearFilters')).not.toBeInTheDocument()

      const checkbox = screen.getByRole('checkbox', { name: 'appointments.showCancelled' })
      fireEvent.click(checkbox)

      expect(checkbox).toBeChecked()
      expect(screen.getByText('patients.appointments.clearFilters')).toBeInTheDocument()

      fireEvent.click(screen.getByText('patients.appointments.clearFilters'))

      expect(checkbox).not.toBeChecked()
      expect(screen.queryByText('patients.appointments.clearFilters')).not.toBeInTheDocument()
    })

    it('renders the "show cancelled" checkbox unchecked on mount', async () => {
      renderSection()

      await waitFor(() => {
        expect(screen.getByText('Limpieza')).toBeInTheDocument()
      })

      expect(screen.getByRole('checkbox', { name: 'appointments.showCancelled' })).not.toBeChecked()
    })
  })

  // --------------------------------------------------------------------------
  // Actions
  // --------------------------------------------------------------------------

  describe('actions', () => {
    beforeEach(() => {
      localStorage.setItem('patient-appointments-collapsed', 'false')
    })

    it('calls onEditAppointment when edit is clicked from card menu', async () => {
      renderSection()

      await waitFor(() => {
        expect(screen.getByText('Limpieza')).toBeInTheDocument()
      })

      // Open menu
      fireEvent.click(screen.getByLabelText('common.options'))
      fireEvent.click(screen.getByText('common.edit'))

      expect(defaultProps.onEditAppointment).toHaveBeenCalledWith(upcomingAppointment)
    })

    it('opens the AppointmentCompleteModal for the right appointment when marking complete', async () => {
      renderSection()

      await waitFor(() => {
        expect(screen.getByText('Limpieza')).toBeInTheDocument()
      })

      expect(screen.queryByTestId('appointment-complete-modal')).not.toBeInTheDocument()

      fireEvent.click(screen.getByLabelText('common.options'))
      fireEvent.click(screen.getByText('appointments.markCompleted'))

      // The completion modal should open, scoped to the clicked appointment —
      // not the shared inline confirm dialog (that's cancel-only now).
      expect(screen.getByTestId('appointment-complete-modal')).toBeInTheDocument()
      expect(screen.getByTestId('complete-modal-appointment-id')).toHaveTextContent('a1')
      expect(mockMarkAppointmentDone).not.toHaveBeenCalled()
    })

    it('refetches appointments once the completion modal reports success', async () => {
      mockGetAppointmentsByPatient.mockResolvedValue([upcomingAppointment])

      renderSection()

      await waitFor(() => {
        expect(screen.getByText('Limpieza')).toBeInTheDocument()
      })

      const callsBeforeComplete = mockGetAppointmentsByPatient.mock.calls.length

      // Open menu, click complete to open the modal
      fireEvent.click(screen.getByLabelText('common.options'))
      fireEvent.click(screen.getByText('appointments.markCompleted'))

      // Simulate the modal reporting a successful completion
      await act(async () => {
        fireEvent.click(screen.getByText('Confirmar completar'))
      })

      expect(screen.queryByTestId('appointment-complete-modal')).not.toBeInTheDocument()
      await waitFor(() => {
        expect(mockGetAppointmentsByPatient.mock.calls.length).toBeGreaterThan(callsBeforeComplete)
      })
      // Should have fetched appointments again for refresh
      expect(mockGetAppointmentsByPatient).toHaveBeenCalledTimes(2)
    })

    it('shows confirmation dialog when cancelling', async () => {
      renderSection()

      await waitFor(() => {
        expect(screen.getByText('Limpieza')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByLabelText('common.options'))
      fireEvent.click(screen.getByText('appointments.cancelAppointment'))

      expect(screen.getByText('appointments.confirmCancel')).toBeInTheDocument()
    })

    it('calls deleteAppointment and refreshes on cancel confirm', async () => {
      mockDeleteAppointment.mockResolvedValue(undefined)
      mockGetAppointmentsByPatient.mockResolvedValue([upcomingAppointment])

      renderSection()

      await waitFor(() => {
        expect(screen.getByText('Limpieza')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByLabelText('common.options'))
      fireEvent.click(screen.getByText('appointments.cancelAppointment'))

      // Confirm cancellation
      const cancelButtons = screen.getAllByText('appointments.cancelAppointment')
      const confirmButton = cancelButtons[cancelButtons.length - 1]
      await act(async () => {
        fireEvent.click(confirmButton)
      })

      await waitFor(() => {
        expect(mockDeleteAppointment).toHaveBeenCalledWith('a1')
      })
      expect(mockGetAppointmentsByPatient).toHaveBeenCalledTimes(2)
    })

    it('calls onPaymentsChange after a successful cancel (#391)', async () => {
      mockDeleteAppointment.mockResolvedValue(undefined)
      mockGetAppointmentsByPatient.mockResolvedValue([upcomingAppointment])
      const onPaymentsChange = vi.fn()

      renderSection({ onPaymentsChange })

      await waitFor(() => {
        expect(screen.getByText('Limpieza')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByLabelText('common.options'))
      fireEvent.click(screen.getByText('appointments.cancelAppointment'))

      const cancelButtons = screen.getAllByText('appointments.cancelAppointment')
      const confirmButton = cancelButtons[cancelButtons.length - 1]
      await act(async () => {
        fireEvent.click(confirmButton)
      })

      await waitFor(() => {
        expect(onPaymentsChange).toHaveBeenCalledTimes(1)
      })
    })
  })

  // --------------------------------------------------------------------------
  // Cancel warning for a recorded consultation payment (#391)
  // --------------------------------------------------------------------------

  describe('cancel warning for a recorded consultation payment (#391)', () => {
    beforeEach(() => {
      localStorage.setItem('patient-appointments-collapsed', 'false')
    })

    it('renders the warning with the correctly formatted recorded amount when hasRecordedPayment is true', async () => {
      mockGetAppointmentsByPatient.mockResolvedValue([paidConsultationAppointment])
      renderSection()

      await waitFor(() => {
        expect(screen.getByText('Consulta pagada')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByLabelText('common.options'))
      fireEvent.click(screen.getByText('appointments.cancelAppointment'))

      // paidConsultationAppointment.recordedPaidAmount === 75; formatCurrency
      // is mocked to `$${amount}`.
      expect(
        screen.getByText('payments.cancelWithRecordedPayment:{"amount":"$75"}')
      ).toBeInTheDocument()
    })

    // Explicit acceptance criterion: an appointment that reads as paid ONLY
    // through FIFO allocation of older advances (isPaid true, hasRecordedPayment
    // false) must show NO warning.
    it('shows no warning when isPaid is true only via FIFO pool allocation (hasRecordedPayment false)', async () => {
      mockGetAppointmentsByPatient.mockResolvedValue([fifoPaidOnlyAppointment])
      renderSection()

      await waitFor(() => {
        expect(screen.getByText('Pagada por pool')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByLabelText('common.options'))
      fireEvent.click(screen.getByText('appointments.cancelAppointment'))

      expect(screen.getByText('appointments.confirmCancel')).toBeInTheDocument()
      expect(screen.queryByText(/payments\.cancelWithRecordedPayment/)).not.toBeInTheDocument()
    })

    it('shows no warning for an appointment with no recorded payment at all', async () => {
      mockGetAppointmentsByPatient.mockResolvedValue([upcomingAppointment])
      renderSection()

      await waitFor(() => {
        expect(screen.getByText('Limpieza')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByLabelText('common.options'))
      fireEvent.click(screen.getByText('appointments.cancelAppointment'))

      expect(screen.queryByText(/payments\.cancelWithRecordedPayment/)).not.toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Consultation payment reversal (#384)
  // --------------------------------------------------------------------------

  describe('consultation payment reversal', () => {
    beforeEach(() => {
      localStorage.setItem('patient-appointments-collapsed', 'false')
      mockGetAppointmentsByPatient.mockResolvedValue([paidConsultationAppointment])
    })

    // #390: computeFifoAllocation now earmarks a kind=APPOINTMENT payment to
    // its own appointment first, so `paidAmount` and `recordedPaidAmount`
    // usually agree — the line would just repeat the figure already shown by
    // the cost/paid breakdown above it. It is shown only in the mixed case,
    // where pool/advance money on top of the recorded payment pushes
    // `paidAmount` past `recordedPaidAmount`.
    it('renders the "Cobrado en consulta (reversible)" line when the item is also covered by pool/advance money (mixed case)', async () => {
      renderSection()

      await waitFor(() => {
        expect(screen.getByText('Consulta pagada')).toBeInTheDocument()
      })

      // paidConsultationAppointment: recordedPaidAmount 75 < paidAmount 100.
      expect(
        screen.getByText(
          (_content, element) => element?.textContent === 'payments.consultationPayment: $75'
        )
      ).toBeInTheDocument()
    })

    it('hides the line when fully covered by its own consultation payment (recordedPaidAmount === paidAmount === cost)', async () => {
      mockGetAppointmentsByPatient.mockResolvedValue([
        {
          ...paidConsultationAppointment,
          isPaid: true,
          paidAmount: 100,
          recordedPaidAmount: 100,
        },
      ])
      renderSection()

      await waitFor(() => {
        expect(screen.getByText('Consulta pagada')).toBeInTheDocument()
      })

      expect(screen.queryByText(/payments\.consultationPayment/)).not.toBeInTheDocument()
    })

    it('hides the line when partially paid but funded only by its own consultation payment (recordedPaidAmount === paidAmount < cost)', async () => {
      mockGetAppointmentsByPatient.mockResolvedValue([
        {
          ...paidConsultationAppointment,
          isPaid: false,
          paidAmount: 40,
          recordedPaidAmount: 40,
        },
      ])
      renderSection()

      await waitFor(() => {
        expect(screen.getByText('Consulta pagada')).toBeInTheDocument()
      })

      expect(screen.queryByText(/payments\.consultationPayment/)).not.toBeInTheDocument()
    })

    it('does not render the payment line when hasRecordedPayment is false (no linked payment, advances only)', async () => {
      mockGetAppointmentsByPatient.mockResolvedValue([upcomingAppointment])
      renderSection()

      await waitFor(() => {
        expect(screen.getByText('Limpieza')).toBeInTheDocument()
      })

      expect(screen.queryByText(/payments\.consultationPayment/)).not.toBeInTheDocument()
    })

    it('hides the reversal menu item when the user lacks PAYMENTS_DELETE', async () => {
      mockCanDeletePayments = false
      renderSection()

      await waitFor(() => {
        expect(screen.getByText('Consulta pagada')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByLabelText('common.options'))
      expect(screen.queryByText('payments.reverseConsultationPayment')).not.toBeInTheDocument()
    })

    it('shows the reversal menu item for a holder of PAYMENTS_DELETE', async () => {
      renderSection()

      await waitFor(() => {
        expect(screen.getByText('Consulta pagada')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByLabelText('common.options'))
      expect(screen.getByText('payments.reverseConsultationPayment')).toBeInTheDocument()
    })

    it('cancelling the confirm dialog does not call deletePayment', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(false)
      renderSection()

      await waitFor(() => {
        expect(screen.getByText('Consulta pagada')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByLabelText('common.options'))
      fireEvent.click(screen.getByText('payments.reverseConsultationPayment'))

      expect(window.confirm).toHaveBeenCalledWith('payments.reverseConsultationConfirm')
      expect(mockDeletePayment).not.toHaveBeenCalled()
    })

    it('confirming calls deletePayment with the patient and recorded payment ids, then refreshes and bubbles onPaymentsChange', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true)
      mockDeletePayment.mockResolvedValue(undefined)
      const onPaymentsChange = vi.fn()

      renderSection({ onPaymentsChange })

      await waitFor(() => {
        expect(screen.getByText('Consulta pagada')).toBeInTheDocument()
      })

      const callsBeforeReversal = mockGetAppointmentsByPatient.mock.calls.length

      fireEvent.click(screen.getByLabelText('common.options'))
      await act(async () => {
        fireEvent.click(screen.getByText('payments.reverseConsultationPayment'))
      })

      expect(mockDeletePayment).toHaveBeenCalledWith('p1', 'pay-1')
      await waitFor(() => {
        expect(onPaymentsChange).toHaveBeenCalledTimes(1)
      })
      // The card's own appointments list is re-fetched (feeds the "Pago en
      // consulta" line / hasRecordedPayment), independent of onPaymentsChange
      // (which only refreshes the sibling payments tab).
      expect(mockGetAppointmentsByPatient.mock.calls.length).toBeGreaterThan(callsBeforeReversal)
    })

    it('a rejected deletePayment surfaces the error via onError and does not fire onPaymentsChange', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true)
      mockDeletePayment.mockRejectedValue(new Error('Cannot reverse payment'))
      const onPaymentsChange = vi.fn()

      renderSection({ onPaymentsChange })

      await waitFor(() => {
        expect(screen.getByText('Consulta pagada')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByLabelText('common.options'))
      await act(async () => {
        fireEvent.click(screen.getByText('payments.reverseConsultationPayment'))
      })

      await waitFor(() => {
        expect(screen.getByText('Cannot reverse payment')).toBeInTheDocument()
      })
      expect(onPaymentsChange).not.toHaveBeenCalled()
    })
  })

  // --------------------------------------------------------------------------
  // Error handling
  // --------------------------------------------------------------------------

  describe('error handling', () => {
    it('shows error message when fetch fails', async () => {
      mockGetAppointmentsByPatient.mockRejectedValue(new Error('Network error'))
      localStorage.setItem('patient-appointments-collapsed', 'false')

      renderSection()

      await waitFor(() => {
        expect(screen.getByText('Network error')).toBeInTheDocument()
      })
    })
  })

  // --------------------------------------------------------------------------
  // Refresh
  // --------------------------------------------------------------------------

  describe('refresh behavior', () => {
    it('refetches when refreshKey changes', async () => {
      const { rerender } = renderSection()

      await waitFor(() => {
        expect(mockGetAppointmentsByPatient).toHaveBeenCalledTimes(1)
      })

      rerender(<PatientAppointmentsSection {...defaultProps} refreshKey={1} />)

      await waitFor(() => {
        expect(mockGetAppointmentsByPatient).toHaveBeenCalledTimes(2)
      })
    })
  })
})
