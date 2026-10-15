/**
 * Task #571 GUARD 3: with no budget to reserve an advance to, the form says
 * WHY the picker is absent, and tells the two reasons apart.
 *
 * Seam: `@/lib/api`'s apiClient is a real axios instance with a recording
 * adapter, so the component runs its real `listBudgetsByPatient` call and a
 * server failure arrives as a real AxiosError. Nothing inside the component is
 * mocked.
 *
 * WHICH STATES THE API CAN ACTUALLY PRODUCE (established by reading
 * apps/api/src/routes/patients.ts:1064 -> budget.service.ts:266, not assumed):
 * the route passes `includeInactive: includeInactive === 'true'` and the client
 * (PaymentFormModal) never sends that param, so `listBudgetsByPatient` applies
 * `isActive: true`. Consequences for this guard:
 *   - a patient whose only budget was soft-deleted gets `[]` -> "no budgets",
 *     NOT "all closed";
 *   - "all closed" is therefore reachable only through an ACTIVE budget whose
 *     status is COMPLETED or CANCELLED (isReservableBudget excludes exactly
 *     those two);
 *   - every row returned belongs to the requested patient (the route filters
 *     `patientId`), so the component's own patientId filter is defence in
 *     depth and is not exercised here.
 *
 * No real patient data: synthetic ids and figures only.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { AxiosError, type InternalAxiosRequestConfig, type AxiosResponse } from 'axios'
import i18n from 'i18next'
import '@/i18n'
import { PaymentFormModal } from './PaymentFormModal'
import { formatCurrency } from '@/lib/format'
import type { Budget } from '@/lib/budget-api'

beforeAll(async () => {
  await i18n.changeLanguage('es')
})

const PATIENT_ID = 'patient-571'

const net = vi.hoisted(() => ({
  gets: [] as string[],
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
      const url = config.url ?? ''
      net.gets.push(url)
      if (!url.endsWith('/budgets')) throw new Error(`unexpected request ${url}`)
      const reply = net.budgets()
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

function makeBudget(overrides: Partial<Budget> = {}): Budget {
  return {
    id: 'budget-1',
    tenantId: 'tenant-571',
    patientId: PATIENT_ID,
    createdById: null,
    status: 'APPROVED',
    notes: null,
    validUntil: null,
    totalAmount: '250.00',
    publicToken: null,
    publicTokenExpiresAt: null,
    isActive: true,
    createdAt: '2026-04-23T12:00:00Z',
    updatedAt: '2026-04-23T12:00:00Z',
    items: [],
    ...overrides,
  }
}

const listOf = (...budgets: Budget[]) => () => ({
  status: 200,
  body: { success: true, data: budgets, pagination: { total: budgets.length } },
})

const NO_BUDGETS = 'Este paciente no tiene presupuestos: la entrega se registra como saldo general.'
const ALL_CLOSED =
  'Todos los presupuestos de este paciente están cerrados: la entrega se registra como saldo general.'
const BUDGET_LABEL = 'Reservar a un presupuesto'

function renderModal(patientId?: string) {
  return render(
    <PaymentFormModal
      isOpen
      onClose={vi.fn()}
      onSubmit={vi.fn().mockResolvedValue(true)}
      patientId={patientId}
      formatCurrency={(amount) => formatCurrency(amount, 'USD')}
    />
  )
}

/** Waits for the one GET the form issues to have been answered and rendered. */
async function listSettled() {
  await waitFor(() => expect(net.gets).toHaveLength(1))
  await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())
}

beforeEach(() => {
  net.gets.length = 0
  net.budgets = listOf()
})

describe('Task #571 GUARD 3: the decided empty states of the budget picker', () => {
  it('no budget at all: the "no budgets" notice, and never the all-closed one', async () => {
    net.budgets = listOf()
    renderModal(PATIENT_ID)
    await listSettled()

    const notice = await screen.findByTestId('payment-budget-no-budgets')
    expect(notice.textContent).toBe(NO_BUDGETS)
    expect(screen.queryByTestId('payment-budget-all-closed')).toBeNull()
    expect(screen.queryByText(ALL_CLOSED)).toBeNull()
    // The picker itself stays absent — the notice replaces it, not joins it.
    expect(screen.queryByLabelText(BUDGET_LABEL)).toBeNull()
    expect(net.gets[0]).toBe(`/patients/${PATIENT_ID}/budgets`)
  })

  it('every budget closed (COMPLETED + CANCELLED, both active): the all-closed notice', async () => {
    net.budgets = listOf(
      makeBudget({ id: 'b-done', status: 'COMPLETED' }),
      makeBudget({ id: 'b-cancelled', status: 'CANCELLED' })
    )
    renderModal(PATIENT_ID)
    await listSettled()

    const notice = await screen.findByTestId('payment-budget-all-closed')
    expect(notice.textContent).toBe(ALL_CLOSED)
    expect(screen.queryByTestId('payment-budget-no-budgets')).toBeNull()
    expect(screen.queryByText(NO_BUDGETS)).toBeNull()
    expect(screen.queryByLabelText(BUDGET_LABEL)).toBeNull()
  })

  it('the two notices are different wordings, so the reader can act on them', () => {
    expect(NO_BUDGETS).not.toBe(ALL_CLOSED)
    expect(i18n.t('payments.form.budgetNoneExist')).toBe(NO_BUDGETS)
    expect(i18n.t('payments.form.budgetAllClosed')).toBe(ALL_CLOSED)
  })

  it('the request FAILED: neither notice is shown — a failure says nothing about this patient', async () => {
    net.budgets = () => ({ status: 500, body: { success: false } })
    renderModal(PATIENT_ID)
    await listSettled()

    // Give the catch branch and a re-render every chance to run.
    await waitFor(() => expect(screen.getByLabelText(/monto/i)).toBeInTheDocument())
    expect(screen.queryByTestId('payment-budget-no-budgets')).toBeNull()
    expect(screen.queryByTestId('payment-budget-all-closed')).toBeNull()
    expect(screen.queryByLabelText(BUDGET_LABEL)).toBeNull()
  })

  it('one reservable budget: the picker is offered and NEITHER notice appears', async () => {
    net.budgets = listOf(makeBudget({ status: 'APPROVED' }))
    renderModal(PATIENT_ID)
    await listSettled()

    expect(await screen.findByLabelText(BUDGET_LABEL)).toBeInTheDocument()
    expect(screen.queryByTestId('payment-budget-no-budgets')).toBeNull()
    expect(screen.queryByTestId('payment-budget-all-closed')).toBeNull()
  })

  it('one reservable budget among closed ones: still the picker, with only that option', async () => {
    net.budgets = listOf(
      makeBudget({ id: 'b-done', status: 'COMPLETED' }),
      makeBudget({ id: 'b-open', status: 'PARTIAL' })
    )
    renderModal(PATIENT_ID)
    await listSettled()

    const select = (await screen.findByLabelText(BUDGET_LABEL)) as HTMLSelectElement
    expect(Array.from(select.options).map((o) => o.value)).toEqual(['', 'b-open'])
    expect(screen.queryByTestId('payment-budget-all-closed')).toBeNull()
  })

  it('no patientId: no request, no notice — the form makes no claim it cannot back', async () => {
    renderModal(undefined)

    await waitFor(() => expect(screen.getByLabelText(/monto/i)).toBeInTheDocument())
    expect(net.gets).toHaveLength(0)
    expect(screen.queryByTestId('payment-budget-no-budgets')).toBeNull()
    expect(screen.queryByTestId('payment-budget-all-closed')).toBeNull()
  })
})
