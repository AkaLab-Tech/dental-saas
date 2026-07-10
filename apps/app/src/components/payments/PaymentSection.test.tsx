import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import i18n from 'i18next'
import '@/i18n'
import { Permission } from '@dental/shared'
import { PaymentSection } from './PaymentSection'
import type { PatientBalance, Payment } from '@/lib/payment-api'

beforeAll(async () => {
  await i18n.changeLanguage('es')
})

// ============================================================================
// Mocks
// ============================================================================

const getPatientBalanceMock = vi.fn()
const getPatientPaymentsMock = vi.fn()

vi.mock('@/lib/payment-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/payment-api')>('@/lib/payment-api')
  return {
    ...actual,
    getPatientBalance: (...args: unknown[]) => getPatientBalanceMock(...args),
    getPatientPayments: (...args: unknown[]) => getPatientPaymentsMock(...args),
  }
})

const canMock = vi.fn()

vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => ({
    can: (perm: Permission) => canMock(perm),
    canAny: () => false,
    canAll: () => false,
  }),
}))

vi.mock('@/stores/auth.store', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) => selector({ user: { tenant: { currency: 'USD' } } }),
}))

// ============================================================================
// Test data
// ============================================================================

function makeBalance(overrides: Partial<PatientBalance> = {}): PatientBalance {
  return {
    totalDebt: 100,
    totalPaid: 100,
    outstanding: 0,
    credit: 0,
    ...overrides,
  }
}

const emptyPayments: { data: Payment[]; pagination: { total: number; limit: number; offset: number } } = {
  data: [],
  pagination: { total: 0, limit: 50, offset: 0 },
}

function renderSection(props: Partial<Parameters<typeof PaymentSection>[0]> = {}) {
  return render(<PaymentSection patientId="patient-1" {...props} />)
}

// ============================================================================
// Tests
// ============================================================================

describe('PaymentSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    canMock.mockReturnValue(true)
    getPatientPaymentsMock.mockResolvedValue(emptyPayments)
  })

  describe('"Nueva Entrega" button', () => {
    it('renders when the patient has zero outstanding debt (fully settled)', async () => {
      getPatientBalanceMock.mockResolvedValue(makeBalance({ totalDebt: 100, totalPaid: 100, outstanding: 0, credit: 0 }))

      renderSection()

      await waitFor(() => {
        expect(screen.getByText('Nueva Entrega')).toBeInTheDocument()
      })
    })

    it('renders when the patient already has a credit balance (no outstanding debt at all)', async () => {
      getPatientBalanceMock.mockResolvedValue(makeBalance({ totalDebt: 0, totalPaid: 50, outstanding: 0, credit: 50 }))

      renderSection()

      await waitFor(() => {
        expect(screen.getByText('Nueva Entrega')).toBeInTheDocument()
      })
    })

    it('still renders when the patient owes money (outstanding > 0)', async () => {
      getPatientBalanceMock.mockResolvedValue(makeBalance({ totalDebt: 200, totalPaid: 50, outstanding: 150, credit: 0 }))

      renderSection()

      await waitFor(() => {
        expect(screen.getByText('Nueva Entrega')).toBeInTheDocument()
      })
    })

    it('does not render when the user lacks PAYMENTS_CREATE, regardless of balance', async () => {
      canMock.mockImplementation((perm: Permission) => perm !== Permission.PAYMENTS_CREATE)
      getPatientBalanceMock.mockResolvedValue(makeBalance({ totalDebt: 200, totalPaid: 50, outstanding: 150, credit: 0 }))

      renderSection()

      // Wait for the section to finish loading (title always renders once
      // balance/payments resolve) before asserting the button's absence.
      await waitFor(() => {
        expect(screen.getByText('Entregas')).toBeInTheDocument()
      })
      expect(screen.queryByText('Nueva Entrega')).not.toBeInTheDocument()
    })
  })

  describe('balance summary tiles', () => {
    it('shows the green "Saldo a favor" credit tile instead of "Saldo pendiente" when credit > 0', async () => {
      getPatientBalanceMock.mockResolvedValue(makeBalance({ totalDebt: 0, totalPaid: 80, outstanding: 0, credit: 80 }))

      renderSection()

      await waitFor(() => {
        expect(screen.getByText('Saldo a favor')).toBeInTheDocument()
      })
      expect(screen.queryByText('Saldo pendiente')).not.toBeInTheDocument()
    })

    it('shows "Saldo pendiente" (not the credit tile) when credit is 0', async () => {
      getPatientBalanceMock.mockResolvedValue(makeBalance({ totalDebt: 100, totalPaid: 40, outstanding: 60, credit: 0 }))

      renderSection()

      await waitFor(() => {
        expect(screen.getByText('Saldo pendiente')).toBeInTheDocument()
      })
      expect(screen.queryByText('Saldo a favor')).not.toBeInTheDocument()
    })
  })
})
