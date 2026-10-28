import { describe, it, expect, vi, beforeEach, beforeAll, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import i18n from 'i18next'
import '@/i18n'
import { PaymentSection } from './PaymentSection'
import { PaymentMovementsSection } from './PaymentMovementsSection'
import type { Payment, PaymentMovement } from '@/lib/payment-api'

// Task #651. Zone pinned per test with vi.stubEnv('TZ', ...), never inherited.
// Imports only components (no new helper), so the same file also runs against
// the pre-fix code.

beforeAll(async () => {
  await i18n.changeLanguage('es')
})

const getPatientPaymentsMock = vi.fn()
const getPatientPaymentMovementsMock = vi.fn()

vi.mock('@/lib/payment-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/payment-api')>('@/lib/payment-api')
  return {
    ...actual,
    getPatientPayments: (...args: unknown[]) => getPatientPaymentsMock(...args),
    getPatientPaymentMovements: (...args: unknown[]) => getPatientPaymentMovementsMock(...args),
  }
})

vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => ({ can: () => true, canAny: () => false, canAll: () => false }),
}))

vi.mock('@/stores/auth.store', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) => selector({ user: { tenant: { currency: 'USD' } } }),
}))

const CALENDAR_DAY = '2026-10-28T00:00:00.000Z'
const LATE_EVENING_INSTANT = '2026-10-29T01:30:00.000Z' // 22:30 on 28 Oct in Montevideo

function pinZone(zone: string) {
  vi.stubEnv('TZ', zone)
  expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(zone)
}

function makePayment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: 'pay-1',
    tenantId: 't1',
    patientId: 'patient-1',
    amount: 50,
    date: CALENDAR_DAY,
    note: null,
    createdBy: null,
    isActive: true,
    kind: 'ADVANCE',
    appointmentId: null,
    createdAt: '2026-10-28T15:00:00.000Z',
    updatedAt: '2026-10-28T15:00:00.000Z',
    ...overrides,
  }
}

function makeMovement(overrides: Partial<PaymentMovement> = {}): PaymentMovement {
  return {
    type: 'RECEIVED',
    at: CALENDAR_DAY,
    amount: 80,
    paymentId: 'payment-1',
    appointmentId: null,
    appointmentDate: null,
    actor: null,
    reason: null,
    ...overrides,
  }
}

function renderEntregas() {
  return render(
    <PaymentSection
      patientId="patient-1"
      statement={{
        appointmentsDebt: 0,
        advancesCredit: 0,
        remainingBudgetProjection: 0,
        totalBilled: 0,
        totalPaid: 0,
        advancesTotal: 0,
      }}
    />
  )
}

afterEach(() => {
  vi.unstubAllEnvs()
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe.each([
  ['America/Montevideo'],
  ['UTC'],
])('payment dates for a viewer in %s (#651)', (zone) => {
  it('Entregas shows a hand-entered payment on the day it was entered (28 oct)', async () => {
    pinZone(zone)
    getPatientPaymentsMock.mockResolvedValue({
      data: [makePayment()],
      pagination: { total: 1, limit: 50, offset: 0 },
    })
    renderEntregas()
    expect(await screen.findByText(/^28 oct\.? 2026$/)).toBeInTheDocument()
  })

  it('Movimientos shows a RECEIVED hand-entered payment on the day it was entered (28 oct)', async () => {
    pinZone(zone)
    getPatientPaymentMovementsMock.mockResolvedValue([makeMovement()])
    render(<PaymentMovementsSection patientId="patient-1" />)
    await waitFor(() => {
      expect(screen.getByText(/^28 oct\.? 2026$/)).toBeInTheDocument()
    })
  })
})

describe('appointment-origin rows stay instants (#651)', () => {
  it('Entregas: a converted appointment payment at 22:30 Montevideo shows 28 oct, not 29', async () => {
    pinZone('America/Montevideo')
    getPatientPaymentsMock.mockResolvedValue({
      data: [makePayment({ date: LATE_EVENING_INSTANT, appointmentId: 'appt-1' })],
      pagination: { total: 1, limit: 50, offset: 0 },
    })
    renderEntregas()
    expect(await screen.findByText(/^28 oct\.? 2026$/)).toBeInTheDocument()
    expect(screen.queryByText(/^29 oct\.? 2026$/)).not.toBeInTheDocument()
  })

  it('Movimientos: an appointment-origin RECEIVED row at 22:30 Montevideo shows 28 oct, not 29', async () => {
    pinZone('America/Montevideo')
    getPatientPaymentMovementsMock.mockResolvedValue([
      makeMovement({ at: LATE_EVENING_INSTANT, appointmentId: 'appt-1' }),
    ])
    render(<PaymentMovementsSection patientId="patient-1" />)
    await waitFor(() => {
      expect(screen.getByText(/^28 oct\.? 2026$/)).toBeInTheDocument()
    })
    expect(screen.queryByText(/^29 oct\.? 2026$/)).not.toBeInTheDocument()
  })

  it('Movimientos: a REVERSED row (an instant) keeps the viewer-local day, 28 oct in Montevideo', async () => {
    pinZone('America/Montevideo')
    getPatientPaymentMovementsMock.mockResolvedValue([makeMovement({ type: 'REVERSED', at: LATE_EVENING_INSTANT })])
    render(<PaymentMovementsSection patientId="patient-1" />)
    await waitFor(() => {
      expect(screen.getByText(/^28 oct\.? 2026$/)).toBeInTheDocument()
    })
  })
})
