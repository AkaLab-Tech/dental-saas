/**
 * Task #612 - the budget's money (covered / remaining / not billed) is shown on
 * BOTH surfaces: the list card and the detail page. Each surface is asserted on
 * its own against literal figures, and both run against the REAL budgets store
 * with only the HTTP-facing API module mocked, so a store that blanks or freezes
 * `money` after a write is visible.
 *
 * Fixture figures are mutually different on purpose (total 200, covered 45,
 * remaining 85, not billed 70) so a surface rendering one number three times,
 * or the total in place of a bucket, goes red.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router'
import i18n from 'i18next'
import '@/i18n'
import { BudgetCard } from './BudgetCard'
import BudgetDetailPage from '@/pages/budgets/BudgetDetailPage'
import { useBudgetsStore } from '@/stores/budgets.store'
import type { Budget, BudgetMoney } from '@/lib/budget-api'

beforeAll(async () => {
  await i18n.changeLanguage('es')
})

const getBudgetMock = vi.fn()
const addBudgetItemMock = vi.fn()

vi.mock('@/lib/budget-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/budget-api')>('@/lib/budget-api')
  return {
    ...actual,
    getBudget: (id: string) => getBudgetMock(id),
    addBudgetItem: (id: string, item: unknown) => addBudgetItemMock(id, item),
  }
})

vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => ({ can: () => true, canAny: () => true, canAll: () => true }),
}))

vi.mock('@/stores/auth.store', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({ user: { tenant: { currency: 'USD' } } }),
}))

vi.mock('@/lib/pdf-api', () => ({
  downloadBudgetPdf: vi.fn(),
  downloadPatientBudgetsPdf: vi.fn(),
}))

const PARTIAL: BudgetMoney = { total: 200, billed: 130, covered: 45, remaining: 85, notBilled: 70 }

function makeBudget(overrides: Partial<Budget> = {}): Budget {
  return {
    id: 'budget-1',
    tenantId: 'tenant-1',
    patientId: 'patient-1',
    createdById: null,
    status: 'APPROVED',
    notes: null,
    validUntil: null,
    totalAmount: '200',
    publicToken: null,
    publicTokenExpiresAt: null,
    isActive: true,
    createdAt: '2026-04-23T00:00:00Z',
    updatedAt: '2026-04-23T00:00:00Z',
    items: [
      {
        id: 'item-1',
        budgetId: 'budget-1',
        description: 'Limpieza',
        toothNumber: null,
        quantity: 1,
        unitPrice: '200',
        totalPrice: '200',
        plannedAppointmentType: null,
        status: 'PENDING',
        notes: null,
        order: 0,
        createdAt: '2026-04-23T00:00:00Z',
        updatedAt: '2026-04-23T00:00:00Z',
      },
    ],
    money: PARTIAL,
    ...overrides,
  }
}

/** What the API answers to "add a 50.00 item": total and notBilled move, covered does not. */
function afterAddingItem(): Budget {
  const b = makeBudget()
  return {
    ...b,
    totalAmount: '250',
    items: [
      ...b.items,
      { ...b.items[0], id: 'item-2', description: 'Radiografía', unitPrice: '50', totalPrice: '50', order: 1 },
    ],
    money: { total: 250, billed: 130, covered: 45, remaining: 85, notBilled: 120 },
  }
}

const norm = (s: string | null) => (s ?? '').replace(/ /g, ' ').trim()

/** The text of the <dd> paired with the <dt> carrying `label`. */
function figure(label: string): string {
  const dt = screen.getByText(label, { selector: 'dt' })
  const dd = dt.parentElement!.querySelector('dd')
  return norm(dd!.textContent)
}

const LABELS = { covered: 'Abonado', remaining: 'Pendiente de pago', notBilled: 'Sin ejecutar' } as const

type Surface = {
  name: string
  show: (budget: Budget) => Promise<void>
  /** Re-supply the budget the way the surface receives it (prop / store). */
  update: (budget: Budget) => Promise<void>
  /** Perform the write through the real store. */
  write: () => Promise<void>
  total: () => string
}

function CardHarness() {
  const budgets = useBudgetsStore((s) => s.budgets)
  return (
    <MemoryRouter>
      {budgets.map((b) => (
        <BudgetCard key={b.id} budget={b} patientId="patient-1" onDelete={vi.fn()} />
      ))}
    </MemoryRouter>
  )
}

const surfaces: Surface[] = [
  {
    name: 'BudgetCard',
    show: async (budget) => {
      useBudgetsStore.setState({ budgets: [budget], currentPatientId: 'patient-1', total: 1 })
      render(<CardHarness />)
    },
    update: async (budget) => {
      act(() => useBudgetsStore.setState({ budgets: [budget] }))
    },
    write: async () => {
      await act(async () => {
        await useBudgetsStore.getState().addItem('budget-1', {
          description: 'Radiografía',
          quantity: 1,
          unitPrice: 50,
        })
      })
    },
    total: () => norm(screen.getByText(/USD.250\.00/).textContent),
  },
  {
    name: 'BudgetDetailPage',
    show: async (budget) => {
      getBudgetMock.mockResolvedValue(budget)
      render(
        <MemoryRouter initialEntries={['/patients/patient-1/budgets/budget-1']}>
          <Routes>
            <Route path="/patients/:patientId/budgets/:id" element={<BudgetDetailPage />} />
          </Routes>
        </MemoryRouter>
      )
      await screen.findByText(LABELS.covered, { selector: 'dt' })
    },
    update: async (budget) => {
      act(() => useBudgetsStore.setState({ currentBudget: budget }))
    },
    write: async () => {
      await act(async () => {
        await useBudgetsStore.getState().addItem('budget-1', {
          description: 'Radiografía',
          quantity: 1,
          unitPrice: 50,
        })
      })
    },
    total: () => norm(screen.getByRole('heading', { level: 1 }).textContent),
  },
]

beforeEach(() => {
  vi.clearAllMocks()
  useBudgetsStore.getState().reset()
})

describe.each(surfaces)('budget money on $name', (surface) => {
  // Guard 1
  it('a partially covered budget shows the covered figure and the remainder, each its own value', async () => {
    await surface.show(makeBudget())
    expect(figure(LABELS.covered)).toBe('USD 45.00')
    expect(figure(LABELS.remaining)).toBe('USD 85.00')
  })

  // Guard 3 (this surface, on its own, against literals)
  it('shows covered, remaining and not billed for the fixture', async () => {
    await surface.show(makeBudget())
    expect(figure(LABELS.covered)).toBe('USD 45.00')
    expect(figure(LABELS.remaining)).toBe('USD 85.00')
    expect(figure(LABELS.notBilled)).toBe('USD 70.00')
  })

  // Guard 2: three separate assertions-in-their-own-it so one red does not hide another
  describe('a budget with nothing covered (APPROVED)', () => {
    const NOTHING = makeBudget({
      status: 'APPROVED',
      money: { total: 200, billed: 0, covered: 0, remaining: 0, notBilled: 200 },
    })

    it('shows the covered zero as a formatted amount', async () => {
      await surface.show(NOTHING)
      expect(figure(LABELS.covered)).toBe('USD 0.00')
    })

    it('shows the remaining zero as a formatted amount', async () => {
      await surface.show(NOTHING)
      expect(figure(LABELS.remaining)).toBe('USD 0.00')
    })

    it('shows the whole total as not billed', async () => {
      await surface.show(NOTHING)
      expect(figure(LABELS.notBilled)).toBe('USD 200.00')
    })
  })

  // Guard 4: no arithmetic in the frontend
  it('renders the API covered value unchanged, and follows it when it changes', async () => {
    await surface.show(makeBudget())
    expect(figure(LABELS.covered)).toBe('USD 45.00')
    await surface.update(makeBudget({ money: { ...PARTIAL, covered: 61.5 } }))
    expect(figure(LABELS.covered)).toBe('USD 61.50')
  })

  it('renders a covered value that disagrees with the line prices as sent (no recomputation)', async () => {
    // covered 999.99 exceeds the 200 total and every line price; remaining/notBilled are
    // unrelated to it. A surface that derived any figure from items would not print these.
    await surface.show(
      makeBudget({ money: { total: 200, billed: 130, covered: 999.99, remaining: 3.21, notBilled: 7.77 } })
    )
    expect(figure(LABELS.covered)).toBe('USD 999.99')
    expect(figure(LABELS.remaining)).toBe('USD 3.21')
    expect(figure(LABELS.notBilled)).toBe('USD 7.77')
  })

  // Guard 6: a write moves the figures (neither blanks nor freezes them)
  describe('after a write that changes the figures', () => {
    beforeEach(() => {
      addBudgetItemMock.mockResolvedValue(afterAddingItem())
    })

    it('shows the new total', async () => {
      await surface.show(makeBudget())
      await surface.write()
      await waitFor(() => expect(surface.total()).toBe('USD 250.00'))
    })

    it('shows the new not-billed figure, not the previous one', async () => {
      await surface.show(makeBudget())
      expect(figure(LABELS.notBilled)).toBe('USD 70.00')
      await surface.write()
      await waitFor(() => expect(figure(LABELS.notBilled)).toBe('USD 120.00'))
    })

    it('keeps the unchanged figures from the response', async () => {
      await surface.show(makeBudget())
      await surface.write()
      await waitFor(() => expect(figure(LABELS.notBilled)).toBe('USD 120.00'))
      expect(figure(LABELS.covered)).toBe('USD 45.00')
      expect(figure(LABELS.remaining)).toBe('USD 85.00')
    })
  })
})
