/**
 * Task #571, amends GUARD 2: end-to-end from the statement the parent owns to
 * the held block on screen — the figures come from the statement, the labels
 * from a budget list that is fetched ONLY when there is something to label.
 *
 * Seam: `@/lib/api`'s apiClient is a real axios instance with a recording
 * adapter. PaymentSection runs its real `getPatientPayments` and
 * `listBudgetsByPatient` calls, so "no request was issued" is an observation
 * about the wire, not about a mock of our own code.
 *
 * Fixtures mirror states the real endpoint produces (see
 * apps/api/src/routes/patients-reserved-advances.test.ts, "Task #571 GUARD 2"):
 * an open budget holding 17000 and a COMPLETED one whose 3000 is already
 * ordinary credit.
 *
 * No real patient data: synthetic ids and figures only.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { type InternalAxiosRequestConfig, type AxiosResponse } from 'axios'
import i18n from 'i18next'
import '@/i18n'
import { PaymentSection } from './PaymentSection'
import { formatCurrency } from '@/lib/format'
import type { AccountStatement as AccountStatementData } from '@/lib/payment-api'
import type { Budget } from '@/lib/budget-api'

beforeAll(async () => {
  await i18n.changeLanguage('es')
})

const PATIENT_ID = 'patient-571'
const OPEN_BUDGET = 'budget-open'
const CLOSED_BUDGET = 'budget-closed'
const CREATED_AT = '2026-04-23T12:00:00Z'

const net = vi.hoisted(() => ({
  wire: [] as Array<{ method: string; url: string; params?: unknown }>,
  /** When true the budget-list request never settles (the real bug window). */
  hangBudgets: false,
  budgets: (() => ({ status: 200, body: { success: true, data: [] } })) as () => {
    status: number
    body: unknown
  },
}))

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  const { default: axios, AxiosError: AxErr } = await import('axios')
  const apiClient = axios.create({
    baseURL: '/api',
    adapter: async (config: InternalAxiosRequestConfig) => {
      const method = (config.method ?? 'get').toLowerCase()
      const url = config.url ?? ''
      net.wire.push({ method, url, params: config.params })
      let reply: { status: number; body: unknown }
      if (url.endsWith('/budgets')) {
        if (net.hangBudgets) await new Promise(() => {})
        reply = net.budgets()
      } else if (url.includes('/payments')) {
        reply = { status: 200, body: { data: [], pagination: { total: 0, limit: 50, offset: 0 } } }
      } else {
        throw new Error(`unexpected request ${method} ${url}`)
      }
      const response = {
        data: reply.body,
        status: reply.status,
        statusText: '',
        headers: {},
        config,
      } as AxiosResponse
      if (reply.status >= 400) {
        throw new AxErr(
          `Request failed with status code ${reply.status}`,
          AxErr.ERR_BAD_REQUEST,
          config,
          null,
          response
        )
      }
      return response
    },
  })
  return { ...actual, apiClient }
})

vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => ({ can: () => true, canAny: () => false, canAll: () => false }),
}))

vi.mock('@/stores/auth.store', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({ user: { tenant: { currency: 'USD' } } }),
}))

function makeBudget(id: string, createdAt: string): Budget {
  return {
    id,
    tenantId: 'tenant-571',
    patientId: PATIENT_ID,
    createdById: null,
    status: id === CLOSED_BUDGET ? 'COMPLETED' : 'APPROVED',
    notes: null,
    validUntil: null,
    totalAmount: '22500.00',
    publicToken: null,
    publicTokenExpiresAt: null,
    isActive: true,
    createdAt,
    updatedAt: createdAt,
    items: [],
  }
}

const listOf = (...budgets: Budget[]) => () => ({
  status: 200,
  body: { success: true, data: budgets, pagination: { total: budgets.length } },
})

function makeStatement(overrides: Partial<AccountStatementData> = {}): AccountStatementData {
  return {
    appointmentsDebt: 0,
    advancesCredit: 3000,
    remainingBudgetProjection: 0,
    totalBilled: 25000,
    totalPaid: 45000,
    advancesTotal: 45000,
    ...overrides,
  }
}

/** One open budget holding 17000 plus a closed one whose 3000 became credit. */
const heldStatement = makeStatement({
  advancesHeld: 17000,
  reservedAdvances: [
    { budgetId: OPEN_BUDGET, reserved: 22500, consumed: 5500, remaining: 17000, open: true },
    { budgetId: CLOSED_BUDGET, reserved: 22500, consumed: 19500, remaining: 3000, open: false },
  ],
})

const budgetGets = () => net.wire.filter((w) => w.url.endsWith('/budgets'))

function renderSection(statement: AccountStatementData | null) {
  return render(<PaymentSection patientId={PATIENT_ID} statement={statement} />)
}

/** The payments list always loads; waiting on it bounds "no budget GET". */
async function paymentsSettled() {
  await waitFor(() =>
    expect(net.wire.some((w) => w.url.includes('/payments'))).toBe(true)
  )
  await waitFor(() => expect(screen.getByText('Nueva Entrega')).toBeInTheDocument())
}

beforeEach(() => {
  net.wire.length = 0
  net.hangBudgets = false
  net.budgets = listOf()
})

describe('Task #571: the held block, from the parent-owned statement to the screen', () => {
  it('held advances: one budget list request (labels only), and the row is named by date', async () => {
    net.budgets = listOf(
      makeBudget(OPEN_BUDGET, CREATED_AT),
      makeBudget(CLOSED_BUDGET, '2026-01-05T12:00:00Z')
    )
    renderSection(heldStatement)
    await paymentsSettled()

    const row = await screen.findByTestId('statement-held-budget-row')
    expect(row.textContent).toBe(`Presupuesto del 23 abr 2026: ${formatCurrency(17000, 'USD')}`)
    // The total is the statement's own advancesHeld, not the 20000 the two
    // reservedAdvances rows add up to.
    expect(screen.getByTestId('statement-held-total').textContent).toBe(
      formatCurrency(17000, 'USD')
    )
    expect(budgetGets()).toHaveLength(1)
    expect(budgetGets()[0].url).toBe(`/patients/${PATIENT_ID}/budgets`)
    expect(budgetGets()[0].params).toEqual({ limit: 100 })
  })

  it('no reservation at all: NO budget list request is issued, and no block', async () => {
    renderSection(makeStatement())
    await paymentsSettled()

    expect(budgetGets()).toHaveLength(0)
    expect(screen.queryByTestId('statement-held-advances')).toBeNull()
  })

  it('only a CLOSED reservation (advancesHeld 0): still no request, still no block', async () => {
    renderSection(
      makeStatement({
        advancesHeld: 0,
        reservedAdvances: [
          { budgetId: CLOSED_BUDGET, reserved: 22500, consumed: 19500, remaining: 3000, open: false },
        ],
      })
    )
    await paymentsSettled()

    expect(budgetGets()).toHaveLength(0)
    expect(screen.queryByTestId('statement-held-advances')).toBeNull()
  })

  it('the label request FAILS: the block still prints the statement figure, named generically', async () => {
    net.budgets = () => ({ status: 500, body: { success: false } })
    renderSection(heldStatement)
    await paymentsSettled()

    await waitFor(() => expect(budgetGets()).toHaveLength(1))
    const row = await screen.findByTestId('statement-held-budget-row')
    expect(row.textContent).toBe(`Presupuesto reservado: ${formatCurrency(17000, 'USD')}`)
    expect(screen.getByTestId('statement-held-total').textContent).toBe(
      formatCurrency(17000, 'USD')
    )
  })

  it('the patient changes under a mounted tab: the previous map never labels the new money', async () => {
    // #539/#547: this tab is only CSS-hidden when another record is opened, so
    // the map fetched for patient A is still in state when patient B's
    // statement arrives. The INTERMEDIATE state is the bug window — this test
    // reads it before B's own list is answered.
    net.budgets = listOf(makeBudget(OPEN_BUDGET, CREATED_AT))
    const { rerender } = renderSection(heldStatement)
    await paymentsSettled()
    expect((await screen.findByTestId('statement-held-budget-row')).textContent).toBe(
      `Presupuesto del 23 abr 2026: ${formatCurrency(17000, 'USD')}`
    )

    // Patient B, same component instance, their own held reservation. B's
    // label request NEVER settles, so the only map that could label B's money
    // is A's — the intermediate state a test that waits for B's list to land
    // cannot see.
    net.hangBudgets = true
    rerender(
      <PaymentSection
        patientId="patient-OTHER"
        statement={makeStatement({
          advancesHeld: 17000,
          reservedAdvances: [
            { budgetId: OPEN_BUDGET, reserved: 22500, consumed: 5500, remaining: 17000, open: true },
          ],
        })}
      />
    )

    await waitFor(() =>
      expect(screen.getByTestId('statement-held-budget-row').textContent).toBe(
        `Presupuesto reservado: ${formatCurrency(17000, 'USD')}`
      )
    )
    expect(screen.queryByText(/23 abr 2026/)).toBeNull()
  })

  it('statement null (still loading or failed): no block and no label request', async () => {
    renderSection(null)
    // With no statement the "Nueva Entrega" button is not offered, so the
    // payments list is what bounds the wait here.
    await waitFor(() => expect(screen.getByText('No hay entregas registradas')).toBeInTheDocument())

    expect(budgetGets()).toHaveLength(0)
    expect(screen.queryByTestId('statement-held-advances')).toBeNull()
    expect(screen.queryByTestId('statement-held-total')).toBeNull()
  })
})
