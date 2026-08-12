import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import i18n from 'i18next'
import '@/i18n'
import { Permission } from '@dental/shared'
import { PaymentSection } from './PaymentSection'
import type { AccountStatement, Payment } from '@/lib/payment-api'

beforeAll(async () => {
  await i18n.changeLanguage('es')
})

// ============================================================================
// Mocks
// ============================================================================

const getAccountStatementMock = vi.fn()
const getPatientPaymentsMock = vi.fn()
const createPaymentMock = vi.fn()
const deletePaymentMock = vi.fn()

vi.mock('@/lib/payment-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/payment-api')>('@/lib/payment-api')
  return {
    ...actual,
    getAccountStatement: (...args: unknown[]) => getAccountStatementMock(...args),
    getPatientPayments: (...args: unknown[]) => getPatientPaymentsMock(...args),
    createPayment: (...args: unknown[]) => createPaymentMock(...args),
    deletePayment: (...args: unknown[]) => deletePaymentMock(...args),
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

function makeStatement(overrides: Partial<AccountStatement> = {}): AccountStatement {
  return {
    appointmentsDebt: 0,
    advancesCredit: 0,
    remainingBudgetProjection: 0,
    totalBilled: 0,
    totalPaid: 0,
    advancesTotal: 0,
    ...overrides,
  }
}

function makePayment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: 'pay-1',
    tenantId: 't1',
    patientId: 'patient-1',
    amount: 50,
    date: '2024-03-01T00:00:00Z',
    note: null,
    createdBy: null,
    isActive: true,
    kind: 'ADVANCE',
    appointmentId: null,
    createdAt: '2024-03-01T00:00:00Z',
    updatedAt: '2024-03-01T00:00:00Z',
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

// Locates the value <p> for a statement figure regardless of whether an
// optional secondary hint line follows it (the credit card renders a 3rd <p>
// only when advancesTotal > 0), so tests don't accidentally match the hint.
function statementValueFor(label: string): string | null | undefined {
  const card = screen.getByText(label).closest('.rounded-lg') as HTMLElement
  return card.querySelectorAll('p')[1]?.textContent
}

// ============================================================================
// Tests
// ============================================================================

describe('PaymentSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    canMock.mockReturnValue(true)
    getAccountStatementMock.mockResolvedValue(makeStatement())
    getPatientPaymentsMock.mockResolvedValue(emptyPayments)
  })

  describe('"Nueva Entrega" button', () => {
    it('renders when the patient has zero outstanding debt (fully settled)', async () => {
      getAccountStatementMock.mockResolvedValue(
        makeStatement({ appointmentsDebt: 0, advancesCredit: 0, remainingBudgetProjection: 0 })
      )

      renderSection()

      await waitFor(() => {
        expect(screen.getByText('Nueva Entrega')).toBeInTheDocument()
      })
    })

    it('renders when the patient already has a credit balance (no outstanding debt at all)', async () => {
      getAccountStatementMock.mockResolvedValue(
        makeStatement({ appointmentsDebt: 0, advancesCredit: 50, remainingBudgetProjection: 0 })
      )

      renderSection()

      await waitFor(() => {
        expect(screen.getByText('Nueva Entrega')).toBeInTheDocument()
      })
    })

    it('still renders when the patient owes money (appointmentsDebt > 0)', async () => {
      getAccountStatementMock.mockResolvedValue(
        makeStatement({ appointmentsDebt: 150, advancesCredit: 0, remainingBudgetProjection: 0 })
      )

      renderSection()

      await waitFor(() => {
        expect(screen.getByText('Nueva Entrega')).toBeInTheDocument()
      })
    })

    it('does not render when the user lacks PAYMENTS_CREATE, regardless of the statement', async () => {
      canMock.mockImplementation((perm: Permission) => perm !== Permission.PAYMENTS_CREATE)
      getAccountStatementMock.mockResolvedValue(
        makeStatement({ appointmentsDebt: 150, advancesCredit: 0, remainingBudgetProjection: 0 })
      )

      renderSection()

      // Wait for the section to finish loading (title always renders once
      // the statement/payments resolve) before asserting the button's absence.
      await waitFor(() => {
        expect(screen.getByText('Entregas')).toBeInTheDocument()
      })
      expect(screen.queryByText('Nueva Entrega')).not.toBeInTheDocument()
    })

    it('does not render when the initial statement fetch fails', async () => {
      getAccountStatementMock.mockRejectedValue(new Error('network fail'))

      renderSection()

      await waitFor(() => {
        expect(screen.getByText('network fail')).toBeInTheDocument()
      })
      expect(screen.queryByText('Nueva Entrega')).not.toBeInTheDocument()
      expect(screen.queryByText('Deuda por consultas realizadas')).not.toBeInTheDocument()
    })
  })

  describe('loading state', () => {
    it('shows a loading spinner until the initial statement/payments fetch resolves', async () => {
      let resolveStatement: (value: AccountStatement) => void = () => {}
      getAccountStatementMock.mockImplementation(
        () =>
          new Promise<AccountStatement>((resolve) => {
            resolveStatement = resolve
          })
      )

      const { container } = renderSection()

      expect(container.querySelector('.animate-spin')).toBeInTheDocument()
      expect(screen.queryByText('Entregas')).not.toBeInTheDocument()

      resolveStatement(makeStatement())

      await waitFor(() => {
        expect(screen.getByText('Entregas')).toBeInTheDocument()
      })
      expect(container.querySelector('.animate-spin')).not.toBeInTheDocument()
    })
  })

  // Task #374: the Entregas tab is now advances-only. It always shows the
  // permanent subtitle explaining that framing.
  describe('subtitle (task #374)', () => {
    it('renders the advance-framed subtitle beneath the title', async () => {
      renderSection()

      await waitFor(() => {
        expect(screen.getByText('Entregas a cuenta de tratamientos futuros')).toBeInTheDocument()
      })
    })
  })

  // Task #374: the Entregas tab only lists ADVANCE-kind payments. Filtering
  // is enforced server-side via the `kind` query param (the component itself
  // performs no client-side re-filtering of whatever the API returns), so
  // the request-shape assertion below is the load-bearing one; see the
  // "coverage gaps" note in the tester report about the absence of a
  // defense-in-depth client filter.
  describe('advances-only filtering (task #374)', () => {
    it('requests only ADVANCE-kind payments from the API', async () => {
      renderSection()

      await waitFor(() => {
        expect(getPatientPaymentsMock).toHaveBeenCalledWith('patient-1', { limit: 50, kind: 'ADVANCE' })
      })
    })

    it('re-requests ADVANCE-kind payments and the account statement on every refresh (refreshKey bump)', async () => {
      const { rerender } = renderSection({ refreshKey: 0 })
      await waitFor(() => expect(getPatientPaymentsMock).toHaveBeenCalledTimes(1))
      expect(getAccountStatementMock).toHaveBeenCalledTimes(1)

      rerender(<PaymentSection patientId="patient-1" refreshKey={1} />)

      await waitFor(() => expect(getPatientPaymentsMock).toHaveBeenCalledTimes(2))
      expect(getPatientPaymentsMock).toHaveBeenLastCalledWith('patient-1', { limit: 50, kind: 'ADVANCE' })
      expect(getAccountStatementMock).toHaveBeenCalledTimes(2)
      expect(getAccountStatementMock).toHaveBeenLastCalledWith('patient-1')
    })

    it('renders the ADVANCE-kind payments returned by the (already-filtered) API response, with no "Pago en consulta" note anywhere', async () => {
      getPatientPaymentsMock.mockResolvedValue({
        data: [
          makePayment({ id: 'adv-1', amount: 40, note: 'Anticipo', kind: 'ADVANCE', appointmentId: null }),
          makePayment({ id: 'adv-2', amount: 50, note: null, kind: 'ADVANCE', appointmentId: null }),
        ],
        pagination: { total: 2, limit: 50, offset: 0 },
      })

      renderSection()

      await screen.findByText('Anticipo')
      // The backend labels appointment-linked payments "Pago en consulta"
      // (apps/api/src/services/appointment.service.ts); that string must
      // never surface in the Entregas tab now that it is advances-only.
      expect(screen.queryByText('Pago en consulta')).not.toBeInTheDocument()
    })
  })

  // Task #376: the 4-tile balance summary from #374 was replaced by the
  // 3-figure AccountStatement (appointmentsDebt / advancesCredit /
  // remainingBudgetProjection), sourced from getAccountStatement instead of
  // getPatientBalance. Component-level details (formatting, the advances
  // hint, the disclaimer, the non-aggregation guard) live in
  // AccountStatement.test.tsx; this describe block only pins the wiring
  // between PaymentSection and that component.
  describe('account statement (task #376)', () => {
    it('renders all three statement figures, individually labelled, at the same time', async () => {
      getAccountStatementMock.mockResolvedValue(
        makeStatement({ appointmentsDebt: 120, advancesCredit: 45, remainingBudgetProjection: 30, advancesTotal: 45 })
      )

      renderSection()

      await waitFor(() => {
        expect(screen.getByText('Deuda por consultas realizadas')).toBeInTheDocument()
      })
      expect(screen.getByText('Saldo a favor')).toBeInTheDocument()
      expect(screen.getByText('Presupuesto restante')).toBeInTheDocument()

      expect(statementValueFor('Deuda por consultas realizadas')).toMatch(/USD\s*120\.00/)
      expect(statementValueFor('Saldo a favor')).toMatch(/USD\s*45\.00/)
      expect(statementValueFor('Presupuesto restante')).toMatch(/USD\s*30\.00/)
    })

    it('renders each figure as 0 (not hidden, not blank) when the patient has no balance activity at all', async () => {
      getAccountStatementMock.mockResolvedValue(makeStatement())

      renderSection()

      await waitFor(() => {
        expect(screen.getByText('Deuda por consultas realizadas')).toBeInTheDocument()
      })
      expect(screen.getByText('Saldo a favor')).toBeInTheDocument()
      expect(screen.getByText('Presupuesto restante')).toBeInTheDocument()

      expect(statementValueFor('Deuda por consultas realizadas')).toMatch(/USD\s*0\.00/)
      expect(statementValueFor('Saldo a favor')).toMatch(/USD\s*0\.00/)
      expect(statementValueFor('Presupuesto restante')).toMatch(/USD\s*0\.00/)
    })
  })

  // Task #374: creating/deleting an advance still triggers the parent
  // refresh callback so sibling sections (appointments, labworks) can
  // re-fetch after the server recalculates FIFO allocation. Task #376: the
  // same refresh must also re-pull the account statement, since a new/removed
  // advance changes appointmentsDebt/advancesCredit.
  describe('onPaymentsChange callback (task #374 / #376)', () => {
    it('fires onPaymentsChange and re-fetches the account statement after successfully creating a payment', async () => {
      const onPaymentsChange = vi.fn()
      createPaymentMock.mockResolvedValue(
        makePayment({ id: 'new-pay', amount: 25, kind: 'ADVANCE' })
      )

      renderSection({ onPaymentsChange })

      await waitFor(() => expect(getAccountStatementMock).toHaveBeenCalledTimes(1))

      const newPaymentButton = await screen.findByText('Nueva Entrega')
      fireEvent.click(newPaymentButton)

      const amountInput = await screen.findByLabelText(/monto/i)
      fireEvent.change(amountInput, { target: { value: '25' } })
      fireEvent.click(screen.getByRole('button', { name: /guardar/i }))

      await waitFor(() => {
        expect(createPaymentMock).toHaveBeenCalledWith(
          'patient-1',
          expect.objectContaining({ amount: 25 })
        )
      })
      await waitFor(() => {
        expect(onPaymentsChange).toHaveBeenCalledTimes(1)
      })
      // fetchData is re-run after create, so both the ADVANCE-only filter
      // and the account statement are re-fetched on refresh too.
      expect(getPatientPaymentsMock).toHaveBeenLastCalledWith('patient-1', { limit: 50, kind: 'ADVANCE' })
      expect(getAccountStatementMock).toHaveBeenCalledTimes(2)
    })

    it('does not fire onPaymentsChange when createPayment rejects', async () => {
      const onPaymentsChange = vi.fn()
      createPaymentMock.mockRejectedValue(new Error('boom'))

      renderSection({ onPaymentsChange })

      const newPaymentButton = await screen.findByText('Nueva Entrega')
      fireEvent.click(newPaymentButton)

      const amountInput = await screen.findByLabelText(/monto/i)
      fireEvent.change(amountInput, { target: { value: '10' } })
      fireEvent.click(screen.getByRole('button', { name: /guardar/i }))

      await waitFor(() => {
        expect(createPaymentMock).toHaveBeenCalled()
      })
      expect(onPaymentsChange).not.toHaveBeenCalled()
      expect(screen.getByText('boom')).toBeInTheDocument()
    })

    it('fires onPaymentsChange and re-fetches the account statement after successfully deleting a payment', async () => {
      const onPaymentsChange = vi.fn()
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
      getPatientPaymentsMock.mockResolvedValue({
        data: [makePayment({ id: 'pay-del', amount: 40, kind: 'ADVANCE' })],
        pagination: { total: 1, limit: 50, offset: 0 },
      })
      deletePaymentMock.mockResolvedValue(undefined)

      renderSection({ onPaymentsChange })

      await waitFor(() => expect(getAccountStatementMock).toHaveBeenCalledTimes(1))

      const deleteButton = await screen.findByTitle('Eliminar')
      fireEvent.click(deleteButton)

      expect(confirmSpy).toHaveBeenCalled()
      await waitFor(() => {
        expect(deletePaymentMock).toHaveBeenCalledWith('patient-1', 'pay-del')
      })
      await waitFor(() => {
        expect(onPaymentsChange).toHaveBeenCalledTimes(1)
      })
      expect(getAccountStatementMock).toHaveBeenCalledTimes(2)

      confirmSpy.mockRestore()
    })

    it('does not call deletePayment or onPaymentsChange when the confirm dialog is cancelled', async () => {
      const onPaymentsChange = vi.fn()
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
      getPatientPaymentsMock.mockResolvedValue({
        data: [makePayment({ id: 'pay-keep', amount: 40, kind: 'ADVANCE' })],
        pagination: { total: 1, limit: 50, offset: 0 },
      })

      renderSection({ onPaymentsChange })

      const deleteButton = await screen.findByTitle('Eliminar')
      fireEvent.click(deleteButton)

      expect(confirmSpy).toHaveBeenCalled()
      expect(deletePaymentMock).not.toHaveBeenCalled()
      expect(onPaymentsChange).not.toHaveBeenCalled()

      confirmSpy.mockRestore()
    })

    it('does not fire onPaymentsChange when deletePayment rejects', async () => {
      const onPaymentsChange = vi.fn()
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
      getPatientPaymentsMock.mockResolvedValue({
        data: [makePayment({ id: 'pay-fail', amount: 40, kind: 'ADVANCE' })],
        pagination: { total: 1, limit: 50, offset: 0 },
      })
      deletePaymentMock.mockRejectedValue(new Error('delete failed'))

      renderSection({ onPaymentsChange })

      const deleteButton = await screen.findByTitle('Eliminar')
      fireEvent.click(deleteButton)

      await waitFor(() => {
        expect(deletePaymentMock).toHaveBeenCalled()
      })
      expect(onPaymentsChange).not.toHaveBeenCalled()
      expect(screen.getByText('delete failed')).toBeInTheDocument()

      confirmSpy.mockRestore()
    })
  })

  // PAYMENTS_DELETE gating is unchanged by task #374/#376; pinned here
  // alongside the existing PAYMENTS_CREATE gating test above.
  describe('PAYMENTS_DELETE gating (unchanged by task #374/#376)', () => {
    it('does not render the delete button when the user lacks PAYMENTS_DELETE', async () => {
      canMock.mockImplementation((perm: Permission) => perm !== Permission.PAYMENTS_DELETE)
      getPatientPaymentsMock.mockResolvedValue({
        data: [makePayment({ id: 'pay-1', amount: 40, kind: 'ADVANCE' })],
        pagination: { total: 1, limit: 50, offset: 0 },
      })

      renderSection()

      await waitFor(() => {
        expect(screen.getByText(/USD\s*40\.00/)).toBeInTheDocument()
      })
      expect(screen.queryByTitle('Eliminar')).not.toBeInTheDocument()
    })
  })

  // Task #218: payments list moved from a single-column stack to a
  // responsive card grid (grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3).
  describe('payments list layout (task #218)', () => {
    it('renders the payments list as a responsive grid instead of a single-column stack', async () => {
      // Amounts (77 / 33) are chosen to be distinct from the statement
      // values (0 by default) so the query below can't match both.
      getPatientPaymentsMock.mockResolvedValue({
        data: [makePayment({ id: 'pay-1', amount: 77 }), makePayment({ id: 'pay-2', amount: 33 })],
        pagination: { total: 2, limit: 50, offset: 0 },
      })

      renderSection()

      const firstAmount = await screen.findByText(/USD\s*77\.00/)
      const listItem = firstAmount.closest('.rounded-lg') as HTMLElement
      const list = listItem.parentElement
      expect(list).toHaveClass('grid', 'grid-cols-1', 'sm:grid-cols-2', 'lg:grid-cols-3')
      expect(list).not.toHaveClass('space-y-1.5')
    })

    it('still renders the empty state (not the grid) when there are no payments', async () => {
      renderSection()

      await waitFor(() => {
        expect(screen.getByText('No hay entregas registradas')).toBeInTheDocument()
      })
      expect(document.querySelector('.grid-cols-1.sm\\:grid-cols-2.lg\\:grid-cols-3')).not.toBeInTheDocument()
    })
  })
})
