import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import i18n from 'i18next'
import '@/i18n'
import { PaymentMovementsSection } from './PaymentMovementsSection'
import type { PaymentMovement } from '@/lib/payment-api'

beforeAll(async () => {
  await i18n.changeLanguage('es')
})

// ============================================================================
// Mocks
// ============================================================================

const getPatientPaymentMovementsMock = vi.fn()

vi.mock('@/lib/payment-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/payment-api')>('@/lib/payment-api')
  return {
    ...actual,
    getPatientPaymentMovements: (...args: unknown[]) => getPatientPaymentMovementsMock(...args),
  }
})

vi.mock('@/stores/auth.store', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) => selector({ user: { tenant: { currency: 'USD' } } }),
}))

// ============================================================================
// Test data
// ============================================================================

function makeMovement(overrides: Partial<PaymentMovement> = {}): PaymentMovement {
  return {
    type: 'RECEIVED',
    at: '2026-05-05T10:00:00.000Z',
    amount: 80,
    paymentId: 'payment-1',
    appointmentId: null,
    appointmentDate: null,
    actor: null,
    reason: null,
    ...overrides,
  }
}

// The component formats dates with the real Intl call — mirror it here rather
// than hardcoding a string, so the expectation does not depend on this
// machine's ICU data producing exactly one particular rendering.
function fmtDate(value: string): string {
  return new Date(value).toLocaleDateString('es', { year: 'numeric', month: 'short', day: 'numeric' })
}

// The component converts a bare <input type="date"> value to a local-time
// start/end-of-day ISO instant before calling the API client (#453 review
// fix). Computed independently from the component's own helpers, from the
// y/m/d parts, so the expectation is TZ-independent rather than a restatement
// of the implementation.
function expectedStartOfLocalDayISO(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number)
  return new Date(year, month - 1, day, 0, 0, 0, 0).toISOString()
}

function expectedEndOfLocalDayISO(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number)
  return new Date(year, month - 1, day, 23, 59, 59, 999).toISOString()
}

function renderSection(props: Partial<Parameters<typeof PaymentMovementsSection>[0]> = {}) {
  return render(<PaymentMovementsSection patientId="patient-1" {...props} />)
}

// ============================================================================
// Tests
// ============================================================================

describe('PaymentMovementsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getPatientPaymentMovementsMock.mockResolvedValue([])
  })

  describe('empty state', () => {
    it('shows the empty-range message when there are no movements', async () => {
      renderSection()

      await waitFor(() => {
        expect(screen.getByText('No hay movimientos en el rango seleccionado')).toBeInTheDocument()
      })
    })
  })

  describe('rendering per type', () => {
    it('renders a RECEIVED row with its type label and amount', async () => {
      getPatientPaymentMovementsMock.mockResolvedValue([
        makeMovement({ type: 'RECEIVED', amount: 80, at: '2026-05-05T10:00:00.000Z' }),
      ])
      renderSection()

      await waitFor(() => {
        expect(screen.getByText('Entrega recibida · USD 80.00')).toBeInTheDocument()
      })
      expect(screen.getByText(fmtDate('2026-05-05T10:00:00.000Z'))).toBeInTheDocument()
    })

    it('renders a REVERSED row with its type label, amount, and reason', async () => {
      getPatientPaymentMovementsMock.mockResolvedValue([
        makeMovement({
          type: 'REVERSED',
          amount: 45.5,
          at: '2026-05-10T09:00:00.000Z',
          reason: 'Cobrado por error',
        }),
      ])
      renderSection()

      await waitFor(() => {
        expect(screen.getByText('Entrega revertida · USD 45.50')).toBeInTheDocument()
      })
      expect(screen.getByText('Cobrado por error')).toBeInTheDocument()
    })

    it('renders a CONVERTED_TO_ADVANCE row with its type label and amount', async () => {
      getPatientPaymentMovementsMock.mockResolvedValue([
        makeMovement({ type: 'CONVERTED_TO_ADVANCE', amount: 100, at: '2026-05-12T09:00:00.000Z' }),
      ])
      renderSection()

      await waitFor(() => {
        expect(screen.getByText('Convertida a entrega · USD 100.00')).toBeInTheDocument()
      })
    })

    it('renders a RESTORED_TO_APPOINTMENT row with its type label and amount', async () => {
      getPatientPaymentMovementsMock.mockResolvedValue([
        makeMovement({ type: 'RESTORED_TO_APPOINTMENT', amount: 100, at: '2026-05-13T09:00:00.000Z' }),
      ])
      renderSection()

      await waitFor(() => {
        expect(screen.getByText('Restaurada a pago de consulta · USD 100.00')).toBeInTheDocument()
      })
    })

    it('renders more than one row at once, each with its own type label', async () => {
      getPatientPaymentMovementsMock.mockResolvedValue([
        makeMovement({ type: 'REVERSED', amount: 30, at: '2026-05-15T09:00:00.000Z', paymentId: 'p-a' }),
        makeMovement({ type: 'RECEIVED', amount: 30, at: '2026-05-01T09:00:00.000Z', paymentId: 'p-b' }),
      ])
      renderSection()

      await waitFor(() => {
        expect(screen.getByText('Entrega revertida · USD 30.00')).toBeInTheDocument()
      })
      expect(screen.getByText('Entrega recibida · USD 30.00')).toBeInTheDocument()
    })
  })

  describe('actor via formatActor (task #461)', () => {
    it('shows the actor by name when active', async () => {
      getPatientPaymentMovementsMock.mockResolvedValue([
        makeMovement({ actor: { kind: 'user', name: 'Ana Pérez', active: true } }),
      ])
      renderSection()

      await waitFor(() => {
        expect(screen.getByText('por Ana Pérez')).toBeInTheDocument()
      })
    })

    it('marks a deactivated user distinctly from an active one', async () => {
      getPatientPaymentMovementsMock.mockResolvedValue([
        makeMovement({ actor: { kind: 'user', name: 'Luis Gómez', active: false } }),
      ])
      renderSection()

      await waitFor(() => {
        expect(screen.getByText('por Luis Gómez (usuario desactivado)')).toBeInTheDocument()
      })
    })

    it('renders a removed actor without a name', async () => {
      getPatientPaymentMovementsMock.mockResolvedValue([makeMovement({ actor: { kind: 'removed' } })])
      renderSection()

      await waitFor(() => {
        expect(screen.getByText('por un usuario eliminado')).toBeInTheDocument()
      })
    })

    it('renders the system actor for a system-attributed row', async () => {
      getPatientPaymentMovementsMock.mockResolvedValue([makeMovement({ actor: { kind: 'system' } })])
      renderSection()

      await waitFor(() => {
        expect(screen.getByText('por el sistema')).toBeInTheDocument()
      })
    })

    it('renders no actor text when the actor was never recorded', async () => {
      getPatientPaymentMovementsMock.mockResolvedValue([
        makeMovement({ type: 'RECEIVED', amount: 20, actor: null }),
      ])
      renderSection()

      await waitFor(() => {
        expect(screen.getByText('Entrega recibida · USD 20.00')).toBeInTheDocument()
      })
      expect(screen.queryByText(/^por /)).not.toBeInTheDocument()
    })
  })

  describe("the conversion's origin appointment date + cancelled wording", () => {
    it("shows the origin appointment's date marked cancelled on a CONVERTED_TO_ADVANCE row", async () => {
      getPatientPaymentMovementsMock.mockResolvedValue([
        makeMovement({
          type: 'CONVERTED_TO_ADVANCE',
          appointmentId: 'appt-1',
          appointmentDate: '2026-04-01T09:00:00.000Z',
        }),
      ])
      renderSection()

      const expected = `Cita del ${fmtDate('2026-04-01T09:00:00.000Z')} (cancelada)`
      await waitFor(() => {
        expect(screen.getByText(expected)).toBeInTheDocument()
      })
    })

    it("shows the origin appointment's date WITHOUT the cancelled wording on a RESTORED_TO_APPOINTMENT row", async () => {
      getPatientPaymentMovementsMock.mockResolvedValue([
        makeMovement({
          type: 'RESTORED_TO_APPOINTMENT',
          appointmentId: 'appt-1',
          appointmentDate: '2026-04-02T09:00:00.000Z',
        }),
      ])
      renderSection()

      const expected = `Cita del ${fmtDate('2026-04-02T09:00:00.000Z')}`
      await waitFor(() => {
        expect(screen.getByText(expected)).toBeInTheDocument()
      })
      // And NOT the cancelled variant — the pair is the point.
      expect(screen.queryByText(`${expected} (cancelada)`)).not.toBeInTheDocument()
    })

    it('does NOT show the origin appointment text on a RECEIVED row even when it carries an appointmentId/appointmentDate', async () => {
      // A kind=APPOINTMENT payment's own receipt also carries an
      // appointmentId — that appointment is not "what happened here" the way
      // a conversion/restore's origin is, so the origin line must stay silent.
      getPatientPaymentMovementsMock.mockResolvedValue([
        makeMovement({
          type: 'RECEIVED',
          appointmentId: 'appt-1',
          appointmentDate: '2026-04-01T09:00:00.000Z',
        }),
      ])
      renderSection()

      await waitFor(() => {
        expect(screen.getByText('Entrega recibida · USD 80.00')).toBeInTheDocument()
      })
      expect(screen.queryByText(/^Cita del /)).not.toBeInTheDocument()
    })

    it('does NOT show the origin appointment text on a REVERSED row even when it carries an appointmentId/appointmentDate', async () => {
      getPatientPaymentMovementsMock.mockResolvedValue([
        makeMovement({
          type: 'REVERSED',
          appointmentId: 'appt-1',
          appointmentDate: '2026-04-01T09:00:00.000Z',
        }),
      ])
      renderSection()

      await waitFor(() => {
        expect(screen.getByText('Entrega revertida · USD 80.00')).toBeInTheDocument()
      })
      expect(screen.queryByText(/^Cita del /)).not.toBeInTheDocument()
    })
  })

  describe('no FIFO allocation rendered', () => {
    it('renders nothing about allocation, outstanding balance, or paid status', async () => {
      getPatientPaymentMovementsMock.mockResolvedValue([
        makeMovement({ type: 'RECEIVED', amount: 80 }),
      ])
      const { container } = renderSection()

      await waitFor(() => {
        expect(screen.getByText('Entrega recibida · USD 80.00')).toBeInTheDocument()
      })
      const text = container.textContent ?? ''
      expect(text).not.toMatch(/outstanding|saldo|paidAmount|isPaid|allocation/i)
    })
  })

  describe('date-range params passed to the API client', () => {
    it('fetches with no params on first render', async () => {
      renderSection()

      await waitFor(() => {
        expect(getPatientPaymentMovementsMock).toHaveBeenCalledWith('patient-1', {
          from: undefined,
          to: undefined,
        })
      })
    })

    it('refetches with the `from` value converted to a local start-of-day ISO instant once the From input changes', async () => {
      renderSection()
      await waitFor(() => expect(getPatientPaymentMovementsMock).toHaveBeenCalledTimes(1))

      fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-05-01' } })

      await waitFor(() => {
        expect(getPatientPaymentMovementsMock).toHaveBeenLastCalledWith('patient-1', {
          from: expectedStartOfLocalDayISO('2026-05-01'),
          to: undefined,
        })
      })
    })

    it('refetches with `from`/`to` converted to local start/end-of-day ISO instants once both inputs are set', async () => {
      renderSection()
      await waitFor(() => expect(getPatientPaymentMovementsMock).toHaveBeenCalledTimes(1))

      fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-05-01' } })
      fireEvent.change(screen.getByLabelText('Hasta'), { target: { value: '2026-05-31' } })

      await waitFor(() => {
        expect(getPatientPaymentMovementsMock).toHaveBeenLastCalledWith('patient-1', {
          from: expectedStartOfLocalDayISO('2026-05-01'),
          to: expectedEndOfLocalDayISO('2026-05-31'),
        })
      })
    })

    it('refetches when refreshKey changes, with the patientId and current range unchanged', async () => {
      const { rerender } = renderSection({ refreshKey: 0 })
      await waitFor(() => expect(getPatientPaymentMovementsMock).toHaveBeenCalledTimes(1))

      rerender(<PaymentMovementsSection patientId="patient-1" refreshKey={1} />)

      await waitFor(() => {
        expect(getPatientPaymentMovementsMock).toHaveBeenCalledTimes(2)
      })
      expect(getPatientPaymentMovementsMock).toHaveBeenLastCalledWith('patient-1', {
        from: undefined,
        to: undefined,
      })
    })
  })

  describe('error handling', () => {
    it('shows the error message when the fetch rejects with an Error', async () => {
      getPatientPaymentMovementsMock.mockRejectedValue(new Error('Network down'))
      renderSection()

      await waitFor(() => {
        expect(screen.getByText('Network down')).toBeInTheDocument()
      })
    })
  })
})
