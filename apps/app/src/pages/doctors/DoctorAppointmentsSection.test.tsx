import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import { DoctorAppointmentsSection } from './DoctorAppointmentsSection'
import type { Appointment } from '@/lib/appointment-api'

// ============================================================================
// Mocks
// ============================================================================

const mockGetAppointmentsByDoctor = vi.fn()
const mockDeleteAppointment = vi.fn()

vi.mock('@/lib/appointment-api', () => ({
  getAppointmentsByDoctor: (...args: unknown[]) => mockGetAppointmentsByDoctor(...args),
  deleteAppointment: (...args: unknown[]) => mockDeleteAppointment(...args),
  getStatusBadgeClasses: () => 'bg-blue-100 text-blue-800',
  formatTimeRange: (start: string, end: string) => {
    const s = new Date(start)
    const e = new Date(end)
    return `${s.getHours()}:${String(s.getMinutes()).padStart(2, '0')} - ${e.getHours()}:${String(e.getMinutes()).padStart(2, '0')}`
  },
  getAppointmentPatientName: (a: Appointment) =>
    a.patient ? `${a.patient.firstName} ${a.patient.lastName}` : 'Unknown',
  getStatusI18nKey: (status: string) => status.toLowerCase(),
}))

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

vi.mock('@/stores/auth.store', () => ({
  useAuthStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ user: { tenant: { currency: 'USD' } } }),
}))

// #391: t() receives an interpolation options object for
// payments.cancelWithRecordedPayment. Serialize options into the returned
// string so the cancel-warning tests can assert on the exact amount passed.
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

const mockPatient = { id: 'p1', firstName: 'Ana', lastName: 'Diaz', email: null, phone: null }

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
  patient: mockPatient,
}

// #391: has a recorded (kind=APPOINTMENT) consultation payment linked to it.
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
// payment recorded directly against this appointment.
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
  doctorId: 'd1',
  onEditAppointment: vi.fn(),
  refreshKey: 0,
}

function renderSection(props = {}) {
  return render(<DoctorAppointmentsSection {...defaultProps} {...props} />)
}

// ============================================================================
// Tests
// ============================================================================

describe('DoctorAppointmentsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    // Expanded by default so cards/menus are reachable without an extra click.
    localStorage.setItem('doctor-appointments-collapsed', 'false')
    mockGetAppointmentsByDoctor.mockResolvedValue([upcomingAppointment])
  })

  it('renders the appointment card with patient name once expanded', async () => {
    renderSection()

    await waitFor(() => {
      expect(screen.getByText('Limpieza')).toBeInTheDocument()
    })
    expect(screen.getByText('Ana Diaz')).toBeInTheDocument()
  })

  // --------------------------------------------------------------------------
  // Cancel warning for a recorded consultation payment (#391)
  // --------------------------------------------------------------------------

  describe('cancel warning for a recorded consultation payment (#391)', () => {
    it('renders the warning with the correctly formatted recorded amount when hasRecordedPayment is true', async () => {
      mockGetAppointmentsByDoctor.mockResolvedValue([paidConsultationAppointment])
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
      mockGetAppointmentsByDoctor.mockResolvedValue([fifoPaidOnlyAppointment])
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
  // Cancel action
  // --------------------------------------------------------------------------

  describe('cancel action', () => {
    it('calls deleteAppointment and refetches on confirm', async () => {
      mockDeleteAppointment.mockResolvedValue(undefined)
      renderSection()

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
        expect(mockDeleteAppointment).toHaveBeenCalledWith('a1')
      })
      expect(mockGetAppointmentsByDoctor).toHaveBeenCalledTimes(2)
    })
  })
})
