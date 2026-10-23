/**
 * Task #569: reserving an advance to a budget from the "Nueva Entrega" form.
 *
 * These tests render the REAL PaymentSection -> PaymentFormModal ->
 * listBudgetsByPatient / createPayment chain. Only the network is replaced:
 * `apiClient` is a real axios instance whose adapter records the request that
 * would have gone on the wire (url, params, the SERIALISED body) and answers
 * with whatever the test programs. So "the body carries no budgetId key" is
 * observed on the serialised wire body, not on a JS object, and a server
 * failure reaches the component as a real AxiosError.
 *
 * `__fixtures__/reserve-advance-contract.json` is shared with the API test
 * (patients-reserved-advances-aggregates.test.ts, "Task #569"): the request the
 * form produces is asserted EQUAL to the file here, and the API test replays
 * that same file against the real endpoint and asserts the real endpoint's
 * failures equal the `responses` the form is fed below.
 *
 * Guards 5 and 6 change the budget's state BETWEEN the option load and the
 * submit (the handler is switched after the select is populated and the budget
 * picked). A test that lets the transition finish before the form opens cannot
 * see that window.
 *
 * No real patient data: synthetic ids and figures only.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import { type InternalAxiosRequestConfig, type AxiosResponse } from 'axios'
import i18n from 'i18next'
import '@/i18n'
import { PaymentSection } from './PaymentSection'
import type { AccountStatement } from '@/lib/payment-api'
import type { Budget } from '@/lib/budget-api'
import contract from './__fixtures__/reserve-advance-contract.json'

beforeAll(async () => {
  await i18n.changeLanguage('es')
})

// ============================================================================
// Network seam: a real axios instance, a recording adapter
// ============================================================================

interface Wire {
  method: string
  url: string
  params?: unknown
  /** The body exactly as axios serialised it (a JSON string), or undefined. */
  data?: string
}

interface Reply {
  status: number
  body: unknown
}

const net = vi.hoisted(() => ({
  wire: [] as Array<{ method: string; url: string; params?: unknown; data?: string }>,
  /** Number of GET /budgets requests whose response has been handed back. */
  budgetsSettled: 0,
  budgets: (() => ({ status: 200, body: { success: true, data: [] } })) as () => {
    status: number
    body: unknown
  },
  posts: [] as Array<() => { status: number; body: unknown }>,
}))

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  const { default: axios, AxiosError: AxErr } = await import('axios')
  const apiClient = axios.create({
    baseURL: '/api',
    adapter: async (config: InternalAxiosRequestConfig) => {
      const method = (config.method ?? 'get').toLowerCase()
      const url = config.url ?? ''
      net.wire.push({ method, url, params: config.params, data: config.data })
      let reply: Reply
      if (method === 'get' && url.endsWith('/budgets')) {
        reply = net.budgets()
        net.budgetsSettled += 1
      } else if (method === 'get' && url.includes('/payments')) {
        reply = {
          status: 200,
          body: { data: [], pagination: { total: 0, limit: 50, offset: 0 } },
        }
      } else if (method === 'post' && url.endsWith('/payments')) {
        const next = net.posts.shift()
        if (!next) throw new Error('unexpected POST /payments: no reply programmed')
        reply = next()
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

// ============================================================================
// Fixtures
// ============================================================================

const PATIENT_ID = contract.patientId

function makeBudget(overrides: Partial<Budget> = {}): Budget {
  return {
    id: contract.budget.id,
    tenantId: 'fixture-tenant',
    patientId: PATIENT_ID,
    createdById: null,
    status: contract.budget.status as Budget['status'],
    notes: null,
    validUntil: null,
    totalAmount: contract.budget.totalAmount,
    money: { total: 100, billed: 50, covered: 30, remaining: 20, notBilled: 50 },
    publicToken: null,
    publicTokenExpiresAt: null,
    isActive: contract.budget.isActive,
    createdAt: contract.budget.createdAt,
    updatedAt: contract.budget.createdAt,
    items: [],
    ...overrides,
  }
}

function listOf(...budgets: Budget[]) {
  return () => ({ status: 200, body: { success: true, data: budgets, pagination: { total: budgets.length } } })
}

function makeStatement(): AccountStatement {
  return {
    appointmentsDebt: 0,
    advancesCredit: 0,
    remainingBudgetProjection: 0,
    totalBilled: 0,
    totalPaid: 0,
    advancesTotal: 0,
  }
}

const created = () => ({
  status: 201,
  body: {
    success: true,
    data: {
      id: 'pay-1',
      tenantId: 'fixture-tenant',
      patientId: PATIENT_ID,
      amount: 500,
      date: '2026-03-02',
      note: null,
      createdBy: null,
      isActive: true,
      kind: 'ADVANCE',
      appointmentId: null,
      createdAt: '2026-03-02T00:00:00Z',
      updatedAt: '2026-03-02T00:00:00Z',
    },
  },
})

const BUDGET_LABEL = 'Reservar a un presupuesto'
const NONE_OPTION = 'Sin reservar (entrega general)'

// ============================================================================
// Helpers
// ============================================================================

const budgetGets = () => net.wire.filter((w) => w.method === 'get' && w.url.endsWith('/budgets'))
const paymentPosts = () => net.wire.filter((w) => w.method === 'post')

async function openForm() {
  render(<PaymentSection patientId={PATIENT_ID} statement={makeStatement()} />)
  fireEvent.click(await screen.findByText('Nueva Entrega'))
  await screen.findByRole('dialog')
}

/** Waits until the budget list the form asked for has been answered AND rendered. */
async function budgetListSettled(expectedGets: number) {
  await waitFor(() => expect(net.budgetsSettled).toBe(expectedGets))
  await act(async () => {
    await Promise.resolve()
  })
}

function getSelect(): HTMLSelectElement {
  return screen.getByLabelText(BUDGET_LABEL) as HTMLSelectElement
}

function optionValues(select: HTMLSelectElement) {
  return Array.from(select.options).map((o) => o.value)
}

function fillAndSubmit(amount = '500', date = '2026-03-02') {
  fireEvent.change(screen.getByLabelText(/monto/i), { target: { value: amount } })
  fireEvent.change(screen.getByLabelText(/fecha/i), { target: { value: date } })
  fireEvent.click(screen.getByRole('button', { name: /guardar/i }))
}

function wireBody(call: Wire): Record<string, unknown> {
  return JSON.parse(call.data ?? 'null')
}

beforeEach(() => {
  net.wire.length = 0
  net.budgetsSettled = 0
  net.budgets = listOf()
  net.posts.length = 0
})

// ============================================================================
// GUARD 1: an advance with no budget is requested exactly as before
// ============================================================================

describe('Task #569 GUARD 1 (client): an advance with no budget carries no budgetId', () => {
  it('select present but left on "Sin reservar": the serialised body has no budgetId key at all', async () => {
    net.budgets = listOf(makeBudget())
    net.posts.push(created)
    await openForm()
    await budgetListSettled(1)
    const select = getSelect()
    expect(select.value).toBe('')
    // The offered default is the general advance.
    expect(select.options[0].textContent).toBe(NONE_OPTION)

    fillAndSubmit()

    await waitFor(() => expect(paymentPosts()).toHaveLength(1))
    const post = paymentPosts()[0]
    expect(post.url).toBe(`/patients/${PATIENT_ID}/payments`)
    // The wire body: neither undefined (JSON drops it) nor "" survives.
    expect(post.data).toBe('{"amount":500,"date":"2026-03-02"}')
    expect(wireBody(post)).toEqual(contract.requestGeneral.body)
    expect('budgetId' in wireBody(post)).toBe(false)
  })

  it('no open budget at all (no select rendered): same body, no budgetId key', async () => {
    net.budgets = listOf()
    net.posts.push(created)
    await openForm()
    await budgetListSettled(1)
    expect(screen.queryByLabelText(BUDGET_LABEL)).toBeNull()

    fillAndSubmit()

    await waitFor(() => expect(paymentPosts()).toHaveLength(1))
    expect(paymentPosts()[0].data).toBe('{"amount":500,"date":"2026-03-02"}')
  })

  it('a note is still sent, and still without a budgetId, when nothing is reserved', async () => {
    net.budgets = listOf(makeBudget())
    net.posts.push(created)
    await openForm()
    await budgetListSettled(1)
    fireEvent.change(screen.getByLabelText(/nota/i), { target: { value: 'efectivo' } })

    fillAndSubmit('120.5')

    await waitFor(() => expect(paymentPosts()).toHaveLength(1))
    expect(wireBody(paymentPosts()[0])).toEqual({ amount: 120.5, date: '2026-03-02', note: 'efectivo' })
  })

  it('after picking a budget and going back to "Sin reservar", the key is gone again', async () => {
    net.budgets = listOf(makeBudget())
    net.posts.push(created)
    await openForm()
    await budgetListSettled(1)
    fireEvent.change(getSelect(), { target: { value: contract.budget.id } })
    expect(getSelect().value).toBe(contract.budget.id)
    fireEvent.change(getSelect(), { target: { value: '' } })

    fillAndSubmit()

    await waitFor(() => expect(paymentPosts()).toHaveLength(1))
    expect(paymentPosts()[0].data).toBe('{"amount":500,"date":"2026-03-02"}')
  })
})

// ============================================================================
// GUARD 2: no open budget, no dead control
// ============================================================================

describe('Task #569 GUARD 2 (client): a patient with no open budget sees no budget control', () => {
  async function expectNoBudgetControl() {
    expect(document.querySelectorAll('select')).toHaveLength(0)
    expect(screen.queryByLabelText(BUDGET_LABEL)).toBeNull()
    expect(screen.queryByText(BUDGET_LABEL)).toBeNull()
    expect(screen.queryByText(NONE_OPTION)).toBeNull()
    expect(screen.queryByRole('combobox')).toBeNull()
  }

  it('the patient has no budgets at all', async () => {
    net.budgets = listOf()
    await openForm()
    await budgetListSettled(1)
    await expectNoBudgetControl()
  })

  it('every budget is closed, deactivated or another patient\'s: nothing is offered', async () => {
    net.budgets = listOf(
      makeBudget({ id: 'b-completed', status: 'COMPLETED' }),
      makeBudget({ id: 'b-cancelled', status: 'CANCELLED' }),
      makeBudget({ id: 'b-inactive', isActive: false }),
      makeBudget({ id: 'b-foreign', patientId: 'someone-else' })
    )
    await openForm()
    await budgetListSettled(1)
    // Non-vacuous: the list WAS answered with four budgets.
    expect(budgetGets()).toHaveLength(1)
    await expectNoBudgetControl()
  })

  it('the budget list fails: no control, and the advance can still be recorded as a general one', async () => {
    net.budgets = () => ({ status: 500, body: { success: false, error: 'boom' } })
    net.posts.push(created)
    await openForm()
    await budgetListSettled(1)
    await expectNoBudgetControl()

    fillAndSubmit()
    await waitFor(() => expect(paymentPosts()).toHaveLength(1))
    expect(paymentPosts()[0].data).toBe('{"amount":500,"date":"2026-03-02"}')
  })

  it('control: with one open budget the same screen DOES render the select', async () => {
    net.budgets = listOf(makeBudget())
    await openForm()
    await budgetListSettled(1)
    expect(document.querySelectorAll('select')).toHaveLength(1)
    expect(optionValues(getSelect())).toEqual(['', contract.budget.id])
  })
})

// ============================================================================
// GUARD 3: the form cannot produce a reservation the API refuses
// ============================================================================

describe('Task #569 GUARD 3 (client): only budgets the API accepts can be picked', () => {
  const list = () =>
    listOf(
      makeBudget({ id: 'b-draft', status: 'DRAFT', totalAmount: '110' }),
      makeBudget({ id: 'b-completed', status: 'COMPLETED', totalAmount: '220' }),
      makeBudget({ id: 'b-approved', status: 'APPROVED', totalAmount: '330' }),
      makeBudget({ id: 'b-cancelled', status: 'CANCELLED', totalAmount: '440' }),
      makeBudget({ id: 'b-partial', status: 'PARTIAL', totalAmount: '550' }),
      makeBudget({ id: 'b-inactive', status: 'APPROVED', isActive: false, totalAmount: '660' }),
      makeBudget({ id: 'b-foreign', patientId: 'someone-else', totalAmount: '770' })
    )

  it('offers exactly DRAFT, APPROVED and PARTIAL budgets of this patient, in list order', async () => {
    net.budgets = list()
    await openForm()
    await budgetListSettled(1)
    expect(optionValues(getSelect())).toEqual(['', 'b-draft', 'b-approved', 'b-partial'])
    expect(budgetGets()[0].params).toEqual({ limit: 100 })
  })

  it('a COMPLETED budget cannot be selected: forcing its id leaves nothing selected and nothing reserved', async () => {
    net.budgets = list()
    net.posts.push(created)
    await openForm()
    await budgetListSettled(1)

    // The user cannot pick it; even a programmatic attempt selects no option.
    fireEvent.change(getSelect(), { target: { value: 'b-completed' } })
    expect(getSelect().value).toBe('')

    fillAndSubmit()
    await waitFor(() => expect(paymentPosts()).toHaveLength(1))
    // No request naming a closed budget leaves the form (which the API would
    // answer 400, see the API-side counterpart).
    expect(paymentPosts()[0].data).toBe('{"amount":500,"date":"2026-03-02"}')
  })

  it('the same for CANCELLED, a deactivated budget and another patient\'s budget', async () => {
    net.budgets = list()
    await openForm()
    await budgetListSettled(1)
    for (const refused of ['b-cancelled', 'b-inactive', 'b-foreign']) {
      fireEvent.change(getSelect(), { target: { value: refused } })
      expect(getSelect().value).toBe('')
    }
    // And an offered one IS selectable (the filter is not simply rejecting all).
    fireEvent.change(getSelect(), { target: { value: 'b-partial' } })
    expect(getSelect().value).toBe('b-partial')
  })
})

// ============================================================================
// GUARD 4 (client half): the exact request the form sends
// ============================================================================

describe('Task #569 GUARD 4 (client): the request a real form render produces is the contract file', () => {
  it('picking the fixture budget sends exactly `request.body`, to the contract URL', async () => {
    net.budgets = listOf(makeBudget())
    net.posts.push(created)
    await openForm()
    await budgetListSettled(1)
    fireEvent.change(getSelect(), { target: { value: contract.budget.id } })

    fillAndSubmit()

    await waitFor(() => expect(paymentPosts()).toHaveLength(1))
    const post = paymentPosts()[0]
    expect(post.url).toBe(contract.request.urlTemplate.replace('{patientId}', PATIENT_ID))
    // The file the API test replays, compared as parsed JSON of the WIRE body.
    expect(wireBody(post)).toEqual(contract.request.body)
    expect(paymentPosts()).toHaveLength(1)
  })

  it('on success the modal closes and no error is shown', async () => {
    net.budgets = listOf(makeBudget())
    net.posts.push(created)
    await openForm()
    await budgetListSettled(1)
    fireEvent.change(getSelect(), { target: { value: contract.budget.id } })
    fillAndSubmit()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.queryByText(/budget/i)).toBeNull()
  })
})

// ============================================================================
// GUARDS 5 and 6: the budget changes between the option load and the submit
// ============================================================================

async function pickBudgetThenChangeWorld(
  afterChange: () => void,
  reply: Reply
) {
  net.budgets = listOf(makeBudget())
  net.posts.push(() => reply)
  await openForm()
  await budgetListSettled(1)
  fireEvent.change(getSelect(), { target: { value: contract.budget.id } })
  expect(getSelect().value).toBe(contract.budget.id)
  // The window: the options on screen are now stale.
  afterChange()
  fillAndSubmit()
}

describe('Task #569 GUARD 5 (client): BUDGET_NOT_OPEN (400) after the budget was closed meanwhile', () => {
  const serverReply = contract.responses.budgetNotOpen

  it('shows the truthful server message, keeps the form open and re-fetches the options', async () => {
    await pickBudgetThenChangeWorld(() => {
      net.budgets = listOf(makeBudget({ status: 'COMPLETED' }))
    }, { status: serverReply.status, body: serverReply.body })

    // The server's text, verbatim (it is true: the budget is completed).
    expect(await screen.findByText('Budget is already completed or cancelled')).toBeInTheDocument()
    expect(serverReply.status).toBe(400)
    // The options were reloaded: exactly one more GET, with the same query.
    await waitFor(() => expect(budgetGets()).toHaveLength(2))
    expect(budgetGets()[1].params).toEqual({ limit: 100 })
    expect(paymentPosts()).toHaveLength(1)
    // The reloaded list holds only a COMPLETED budget: nothing left to offer.
    await budgetListSettled(2)
    expect(screen.queryByLabelText(BUDGET_LABEL)).toBeNull()
    // The user is not thrown out of the form.
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    // And the "gone" copy is NOT shown for a closed budget.
    expect(screen.queryByText('La opción elegida ya no está disponible')).toBeNull()
  })

  it('another open budget remains: the stale pick is cleared and a resubmit goes out as a general advance', async () => {
    await pickBudgetThenChangeWorld(() => {
      net.budgets = listOf(
        makeBudget({ status: 'COMPLETED' }),
        makeBudget({ id: 'b-other', totalAmount: '300' })
      )
    }, { status: serverReply.status, body: serverReply.body })

    await screen.findByText('Budget is already completed or cancelled')
    await waitFor(() => expect(budgetGets()).toHaveLength(2))
    await budgetListSettled(2)
    // The select now offers only the other budget and holds NO selection.
    expect(optionValues(getSelect())).toEqual(['', 'b-other'])
    expect(getSelect().value).toBe('')

    net.posts.push(created)
    fireEvent.click(screen.getByRole('button', { name: /guardar/i }))
    await waitFor(() => expect(paymentPosts()).toHaveLength(2))
    // The second request does not carry the dead budget id.
    expect(paymentPosts()[1].data).toBe('{"amount":500,"date":"2026-03-02"}')
  })
})

describe('Task #569 GUARD 6 (client): BUDGET_NOT_FOUND (404) after the budget was deactivated meanwhile', () => {
  const serverReply = contract.responses.budgetGone

  it('does not show the server\'s "not found" text; shows the "no longer available" copy and re-fetches', async () => {
    await pickBudgetThenChangeWorld(() => {
      // A deactivated budget disappears from the (default) list.
      net.budgets = listOf()
    }, { status: serverReply.status, body: serverReply.body })

    expect(await screen.findByText('La opción elegida ya no está disponible')).toBeInTheDocument()
    expect(serverReply.status).toBe(404)
    // The raw server sentence must not reach the user, in any casing/position.
    expect(screen.queryByText(serverReply.body.error)).toBeNull()
    expect(document.body.textContent).not.toContain('not found')
    await waitFor(() => expect(budgetGets()).toHaveLength(2))
    expect(paymentPosts()).toHaveLength(1)
    await budgetListSettled(2)
    expect(screen.queryByLabelText(BUDGET_LABEL)).toBeNull()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('another open budget remains: the select re-offers it AND the resubmitted request body carries no budgetId', async () => {
    await pickBudgetThenChangeWorld(() => {
      net.budgets = listOf(makeBudget({ id: 'b-other', totalAmount: '300' }))
    }, { status: serverReply.status, body: serverReply.body })

    await screen.findByText('La opción elegida ya no está disponible')
    await waitFor(() => expect(budgetGets()).toHaveLength(2))
    await budgetListSettled(2)
    expect(optionValues(getSelect())).toEqual(['', 'b-other'])
    expect(getSelect().value).toBe('')

    // The DOM showing "nothing selected" is not enough: the form's own state
    // must have dropped the dead id too, or the resubmit would resend it.
    net.posts.push(created)
    fireEvent.click(screen.getByRole('button', { name: /guardar/i }))
    await waitFor(() => expect(paymentPosts()).toHaveLength(2))
    expect(paymentPosts()[1].data).toBe('{"amount":500,"date":"2026-03-02"}')
  })

  it('scope: a 404 on an advance that names NO budget keeps the server\'s own text (the override is only for reservations)', async () => {
    net.budgets = listOf(makeBudget())
    net.posts.push(() => ({
      status: 404,
      body: { success: false, error: 'Patient not found' },
    }))
    await openForm()
    await budgetListSettled(1)
    fillAndSubmit()

    expect(await screen.findByText('Patient not found')).toBeInTheDocument()
    expect(screen.queryByText('La opción elegida ya no está disponible')).toBeNull()
    // No reservation was attempted, so the options are not reloaded.
    expect(budgetGets()).toHaveLength(1)
  })

  it('scope: any other failure of a reserved submit shows the server text and still re-fetches', async () => {
    await pickBudgetThenChangeWorld(() => {
      net.budgets = listOf(makeBudget())
    }, { status: 400, body: { success: false, error: 'Validation error' } })

    expect(await screen.findByText('Validation error')).toBeInTheDocument()
    await waitFor(() => expect(budgetGets()).toHaveLength(2))
  })
})
