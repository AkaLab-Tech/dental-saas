import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Mock } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router'
import BudgetDetailPage from './BudgetDetailPage'
import { useBudgetsStore } from '@/stores/budgets.store'
import { useAuthStore } from '@/stores/auth.store'
import { usePermissions } from '@/hooks/usePermissions'
import { downloadBudgetPdf } from '@/lib/pdf-api'
import { shareBudget, USER_SETTABLE_BUDGET_STATUSES } from '@/lib/budget-api'
import type { BudgetWithVisits as Budget, BudgetItem } from '@/lib/budget-api'

// Mock react-i18next — return the key so assertions are stable regardless of locale
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts?.executed !== undefined) return `${key} ${opts.executed}/${opts.total}`
      return key
    },
  }),
  // Task #639: budgets.store now imports '@/i18n' (it translates the API's
  // delete refusal), and vi.mock of the store still evaluates the module, so
  // i18n/index.ts runs `.use(initReactI18next)` against this mock. Same stub
  // the other page tests that mock react-i18next already carry.
  initReactI18next: { type: '3rdParty', init: () => {} },
}))

vi.mock('@/stores/budgets.store')
vi.mock('@/stores/auth.store')
vi.mock('@/hooks/usePermissions')
vi.mock('@/lib/pdf-api')
vi.mock('@/lib/budget-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/budget-api')>('@/lib/budget-api')
  return {
    ...actual,
    shareBudget: vi.fn(),
  }
})

function makeBudget(overrides: Partial<Budget> = {}): Budget {
  return {
    id: 'budget-1',
    tenantId: 'tenant-1',
    patientId: 'patient-1',
    createdById: 'user-1',
    status: 'DRAFT',
    notes: null,
    validUntil: null,
    totalAmount: '180',
    money: { total: 100, billed: 50, covered: 30, remaining: 20, notBilled: 50 },
    visits: [],
    publicToken: null,
    publicTokenExpiresAt: null,
    isActive: true,
    createdAt: '2026-04-23T00:00:00Z',
    updatedAt: '2026-04-23T00:00:00Z',
    items: [
      {
        id: 'item-1',
        budgetId: 'budget-1',
        description: 'Cleaning',
        toothNumber: null,
        quantity: 1,
        unitPrice: '80',
        totalPrice: '80',
        plannedAppointmentType: null,
        status: 'PENDING',
        notes: null,
        order: 0,
        createdAt: '2026-04-23T00:00:00Z',
        updatedAt: '2026-04-23T00:00:00Z',
      },
    ],
    ...overrides,
  }
}

function makeItem(overrides: Partial<BudgetItem> = {}): BudgetItem {
  return { ...makeBudget().items[0], ...overrides }
}

function mockStore(budget: Budget) {
  ;(useBudgetsStore as unknown as Mock).mockReturnValue({
    currentBudget: budget,
    loading: false,
    error: null,
    fetchBudget: vi.fn().mockResolvedValue(budget),
    updateBudget: vi.fn(),
    addItem: vi.fn(),
    updateItem: vi.fn(),
    deleteItem: vi.fn(),
    clearError: vi.fn(),
  })
}

function mockAuth() {
  ;(useAuthStore as unknown as Mock).mockImplementation(
    (selector: (s: { user: { tenant: { currency: string } } }) => unknown) =>
      selector({ user: { tenant: { currency: 'USD' } } })
  )
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/patients/patient-1/budgets/budget-1']}>
      <Routes>
        <Route path="/patients/:patientId/budgets/:id" element={<BudgetDetailPage />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('BudgetDetailPage — PDF download & share gating', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStore(makeBudget())
    mockAuth()
  })

  it('shows the Download PDF button for a viewer without BUDGETS_SHARE (e.g. STAFF)', () => {
    ;(usePermissions as unknown as Mock).mockReturnValue({
      can: () => false,
      canAny: () => false,
      canAll: () => false,
    })

    renderPage()

    expect(screen.getByText('budgets.downloadPdf')).toBeInTheDocument()
  })

  it('hides the Share link button for a viewer without BUDGETS_SHARE', () => {
    ;(usePermissions as unknown as Mock).mockReturnValue({
      can: () => false,
      canAny: () => false,
      canAll: () => false,
    })

    renderPage()

    expect(screen.queryByText('budgets.share.button')).not.toBeInTheDocument()
  })

  it('shows the Share link button when the user has BUDGETS_SHARE (e.g. CLINIC_ADMIN)', () => {
    ;(usePermissions as unknown as Mock).mockReturnValue({
      can: () => true,
      canAny: () => true,
      canAll: () => true,
    })

    renderPage()

    expect(screen.getByText('budgets.share.button')).toBeInTheDocument()
  })

  it('clicking Download PDF calls downloadBudgetPdf with the budget id', async () => {
    ;(usePermissions as unknown as Mock).mockReturnValue({
      can: () => true,
      canAny: () => true,
      canAll: () => true,
    })
    vi.mocked(downloadBudgetPdf).mockResolvedValue(undefined)

    renderPage()

    fireEvent.click(screen.getByText('budgets.downloadPdf'))

    await waitFor(() => {
      expect(downloadBudgetPdf).toHaveBeenCalledWith('budget-1')
    })
  })

  it('clicking Share generates a link and displays the copyable URL panel', async () => {
    ;(usePermissions as unknown as Mock).mockReturnValue({
      can: () => true,
      canAny: () => true,
      canAll: () => true,
    })
    vi.mocked(shareBudget).mockResolvedValue({
      token: 'abc123',
      url: 'http://localhost:5003/budget/abc123',
      expiresAt: null,
    })

    renderPage()

    fireEvent.click(screen.getByText('budgets.share.button'))

    await waitFor(() => {
      expect(shareBudget).toHaveBeenCalledWith('budget-1')
    })
    expect(await screen.findByDisplayValue('http://localhost:5003/budget/abc123')).toBeInTheDocument()
  })

  it('surfaces an error message when the share request fails', async () => {
    ;(usePermissions as unknown as Mock).mockReturnValue({
      can: () => true,
      canAny: () => true,
      canAll: () => true,
    })
    vi.mocked(shareBudget).mockRejectedValue(new Error('network down'))

    renderPage()

    fireEvent.click(screen.getByText('budgets.share.button'))

    expect(await screen.findByRole('alert')).toHaveTextContent('network down')
  })
})

describe('BudgetDetailPage — metadata card (#606)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStore(makeBudget())
    mockAuth()
    ;(usePermissions as unknown as Mock).mockReturnValue({
      can: () => true,
      canAny: () => true,
      canAll: () => true,
    })
  })

  function budgetStatusSelect(): HTMLSelectElement {
    const sel = screen
      .getAllByRole('combobox')
      .find((el) =>
        Array.from((el as HTMLSelectElement).options).some((o) => o.value === 'CANCELLED')
      )
    return sel as HTMLSelectElement
  }

  it('offers DRAFT, APPROVED and CANCELLED', () => {
    renderPage()
    const values = Array.from(budgetStatusSelect().options).map((o) => o.value)
    expect(values).toEqual(['DRAFT', 'APPROVED', 'CANCELLED'])
  })

  it('does not offer APPROVED when some but not all active lines are EXECUTED', () => {
    mockStore(
      makeBudget({
        items: [makeItem({ id: 'e1', status: 'EXECUTED' }), makeItem({ id: 'p1', status: 'PENDING' })],
      })
    )
    renderPage()
    const values = Array.from(budgetStatusSelect().options).map((o) => o.value)
    expect(values).toEqual(['DRAFT', 'CANCELLED'])
  })

  it('offers APPROVED when no active line is EXECUTED', () => {
    mockStore(makeBudget({ items: [makeItem({ id: 'p1', status: 'PENDING' })] }))
    renderPage()
    const values = Array.from(budgetStatusSelect().options).map((o) => o.value)
    expect(values).toContain('APPROVED')
  })

  it('offers the same status set as the shared settable list', () => {
    renderPage()
    const values = Array.from(budgetStatusSelect().options).map((o) => o.value)
    expect(values).toEqual([...USER_SETTABLE_BUDGET_STATUSES])
  })

  it('does not offer PARTIAL or COMPLETED', () => {
    renderPage()
    const values = Array.from(budgetStatusSelect().options).map((o) => o.value)
    expect(values).not.toContain('PARTIAL')
    expect(values).not.toContain('COMPLETED')
  })

  it('titles the metadata card with the details heading, not the notes label', () => {
    renderPage()
    const heading = screen.getByRole('heading', { name: 'budgets.details' })
    expect(heading).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'budgets.notes' })).not.toBeInTheDocument()
  })

  it('still labels the notes field with the notes label', () => {
    renderPage()
    const label = screen.getByText('budgets.notes')
    expect(label.tagName).toBe('LABEL')
  })
})

/**
 * Task #675. Two guards live here, both about the item-edit card:
 *
 *   G5  the status select no longer offers EXECUTED — an item reaches EXECUTED
 *       through an appointment, which is what creates the charge.
 *   G6  (component half) when the store refuses the write, the page shows the
 *       store's localised `error`, not the axios message. The store's own half
 *       — turning the 409 code into the localised sentence — is pinned in
 *       stores/budgets.store.test.ts; here the store is mocked, so the message
 *       it exposes is used verbatim as the thing the page must prefer.
 */
describe('BudgetDetailPage — the item-edit card (#675)', () => {
  const STORE_ERROR =
    'No se puede marcar el ítem como ejecutado desde el presupuesto: agendá el ítem en una cita y confirmá ahí que se ejecutó.'
  const AXIOS_MESSAGE = 'Request failed with status code 409'

  function mockStoreWith(overrides: Record<string, unknown>, storeError: string | null = null) {
    const state = {
      currentBudget: makeBudget(),
      loading: false,
      error: storeError,
      fetchBudget: vi.fn().mockResolvedValue(makeBudget()),
      updateBudget: vi.fn(),
      addItem: vi.fn(),
      updateItem: vi.fn(),
      deleteItem: vi.fn(),
      clearError: vi.fn(),
      ...overrides,
    }
    ;(useBudgetsStore as unknown as Mock).mockReturnValue(state)
    ;(useBudgetsStore as unknown as { getState: Mock }).getState = vi.fn().mockReturnValue(state)
    return state
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockStoreWith({})
    mockAuth()
    ;(usePermissions as unknown as Mock).mockReturnValue({
      can: () => true,
      canAny: () => true,
      canAll: () => true,
    })
  })

  function openItemEditor() {
    fireEvent.click(screen.getByLabelText('common.edit'))
  }

  function itemStatusSelect(): HTMLSelectElement {
    const sel = screen
      .getAllByRole('combobox')
      .find((el) =>
        Array.from((el as HTMLSelectElement).options).some((o) => o.value === 'PENDING')
      )
    return sel as HTMLSelectElement
  }

  it('G5 - the item status select offers exactly PENDING, SCHEDULED, IN_PROGRESS and CANCELLED', () => {
    renderPage()
    openItemEditor()
    expect(Array.from(itemStatusSelect().options).map((o) => o.value)).toEqual([
      'PENDING',
      'SCHEDULED',
      'IN_PROGRESS',
      'CANCELLED',
    ])
  })

  it('G5 - EXECUTED is not among the item status options', () => {
    renderPage()
    openItemEditor()
    expect(Array.from(itemStatusSelect().options).map((o) => o.value)).not.toContain('EXECUTED')
  })

  const optionValues = (sel: HTMLSelectElement) => Array.from(sel.options).map((o) => o.value)
  const BASE_FOUR = ['PENDING', 'SCHEDULED', 'IN_PROGRESS', 'CANCELLED']

  function openExecutedItemEditor() {
    const updateItem = vi.fn().mockResolvedValue(undefined)
    mockStoreWith({
      currentBudget: makeBudget({ items: [makeItem({ status: 'EXECUTED' })] }),
      updateItem,
    })
    renderPage()
    openItemEditor()
    return updateItem
  }

  it('#677 G1 - an EXECUTED item editor shows EXECUTED selected, with the full lifecycle in order', () => {
    openExecutedItemEditor()
    const sel = itemStatusSelect()
    expect(sel.value).toBe('EXECUTED')
    expect(optionValues(sel)).toEqual([
      'PENDING',
      'SCHEDULED',
      'IN_PROGRESS',
      'EXECUTED',
      'CANCELLED',
    ])
  })

  it.each(['SCHEDULED', 'IN_PROGRESS', 'CANCELLED'] as const)(
    '#677 G3 - a %s item does not offer EXECUTED',
    (status) => {
      mockStoreWith({ currentBudget: makeBudget({ items: [makeItem({ status })] }) })
      renderPage()
      openItemEditor()
      const sel = itemStatusSelect()
      expect(optionValues(sel)).not.toContain('EXECUTED')
      expect(optionValues(sel)).toEqual(BASE_FOUR)
      expect(sel.value).toBe(status)
    }
  )

  it('#677 G4 - saving an EXECUTED item without touching the status keeps EXECUTED', async () => {
    const updateItem = openExecutedItemEditor()
    fireEvent.change(screen.getByDisplayValue('Cleaning'), { target: { value: 'Cleaning x2' } })
    fireEvent.click(screen.getByText('common.save'))

    await waitFor(() => expect(updateItem).toHaveBeenCalledTimes(1))
    expect(updateItem.mock.calls[0][2]).toMatchObject({
      description: 'Cleaning x2',
      status: 'EXECUTED',
    })
  })

  it('#677 G5 - an EXECUTED item can go to PENDING and back to EXECUTED within one session', async () => {
    const updateItem = openExecutedItemEditor()
    const sel = itemStatusSelect()

    fireEvent.change(sel, { target: { value: 'PENDING' } })
    expect(itemStatusSelect().value).toBe('PENDING')
    expect(optionValues(itemStatusSelect())).toContain('EXECUTED')

    fireEvent.change(itemStatusSelect(), { target: { value: 'EXECUTED' } })
    expect(itemStatusSelect().value).toBe('EXECUTED')
    fireEvent.click(screen.getByText('common.save'))

    await waitFor(() => expect(updateItem).toHaveBeenCalledTimes(1))
    expect(updateItem.mock.calls[0][2]).toMatchObject({ status: 'EXECUTED' })
  })

  it('G6 - a refused item save shows the store error, not the axios message', async () => {
    mockStoreWith(
      { updateItem: vi.fn().mockRejectedValue(new Error(AXIOS_MESSAGE)) },
      STORE_ERROR
    )
    renderPage()
    openItemEditor()
    fireEvent.click(screen.getByText('common.save'))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(STORE_ERROR)
    expect(alert).not.toHaveTextContent(AXIOS_MESSAGE)
  })

  it('G6 discrimination - with no store error the axios message is still surfaced', async () => {
    mockStoreWith({ updateItem: vi.fn().mockRejectedValue(new Error('network down')) }, null)
    renderPage()
    openItemEditor()
    fireEvent.click(screen.getByText('common.save'))

    expect(await screen.findByRole('alert')).toHaveTextContent('network down')
  })
})
