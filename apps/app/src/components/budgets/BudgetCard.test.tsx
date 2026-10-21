import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import i18n from 'i18next'
import '@/i18n'
import { BudgetCard } from './BudgetCard'
import type { Budget, BudgetItem, BudgetItemStatus } from '@/lib/budget-api'
import { Permission } from '@dental/shared'
import { useBudgetsStore } from '@/stores/budgets.store'
import { USER_SETTABLE_BUDGET_STATUSES } from '@/lib/budget-api'

beforeAll(async () => {
  await i18n.changeLanguage('es')
})

const canMock = vi.fn()
const downloadBudgetPdfMock = vi.fn()
const apiUpdateBudgetMock = vi.fn()

vi.mock('@/lib/budget-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/budget-api')>('@/lib/budget-api')
  return {
    ...actual,
    updateBudget: (id: string, data: unknown) => apiUpdateBudgetMock(id, data),
  }
})

vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => ({
    can: (perm: Permission) => canMock(perm),
    canAny: () => false,
    canAll: () => false,
  }),
}))

vi.mock('@/stores/auth.store', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({ user: { tenant: { currency: 'USD' } } }),
}))

vi.mock('@/lib/pdf-api', () => ({
  downloadBudgetPdf: (budgetId: string) => downloadBudgetPdfMock(budgetId),
}))

function makeBudget(overrides: Partial<Budget> = {}): Budget {
  return {
    id: 'budget-1',
    tenantId: 'tenant-1',
    patientId: 'patient-1',
    createdById: 'user-1',
    status: 'APPROVED',
    notes: null,
    validUntil: '2026-12-31T00:00:00Z',
    totalAmount: '250.50',
    publicToken: null,
    publicTokenExpiresAt: null,
    isActive: true,
    createdAt: '2026-04-23T00:00:00Z',
    updatedAt: '2026-04-23T00:00:00Z',
    items: [
      {
        id: 'i1',
        budgetId: 'budget-1',
        description: 'A',
        toothNumber: null,
        quantity: 1,
        unitPrice: '100',
        totalPrice: '100',
        plannedAppointmentType: null,
        status: 'EXECUTED',
        notes: null,
        order: 0,
        createdAt: '',
        updatedAt: '',
      },
      {
        id: 'i2',
        budgetId: 'budget-1',
        description: 'B',
        toothNumber: null,
        quantity: 1,
        unitPrice: '150.50',
        totalPrice: '150.50',
        plannedAppointmentType: null,
        status: 'PENDING',
        notes: null,
        order: 1,
        createdAt: '',
        updatedAt: '',
      },
    ],
    ...overrides,
  }
}

function makeItem(overrides: Partial<BudgetItem> = {}): BudgetItem {
  return {
    id: 'item',
    budgetId: 'budget-1',
    description: 'Item',
    toothNumber: null,
    quantity: 1,
    unitPrice: '100',
    totalPrice: '100',
    plannedAppointmentType: null,
    status: 'PENDING',
    notes: null,
    order: 0,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  }
}

function renderCard(budget: Budget, onDelete = vi.fn()) {
  return render(
    <MemoryRouter>
      <BudgetCard budget={budget} patientId="patient-1" onDelete={onDelete} />
    </MemoryRouter>
  )
}

describe('BudgetCard', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders total, status badge and progress', () => {
    canMock.mockReturnValue(true)
    renderCard(makeBudget())
    expect(screen.getByText(/250\.5/)).toBeInTheDocument()
    expect(screen.getByText('Aprobado')).toBeInTheDocument()
    expect(screen.getByText(/1.*de.*2/i)).toBeInTheDocument()
  })

  it('hides the delete option when user lacks BUDGETS_DELETE', () => {
    canMock.mockImplementation((p) => p !== Permission.BUDGETS_DELETE)
    renderCard(makeBudget())
    fireEvent.click(screen.getByLabelText('Actions'))
    expect(screen.getByText('Ver detalle')).toBeInTheDocument()
    expect(screen.getByText('Ver detalle').closest('a')).toHaveAttribute(
      'href',
      '/patients/patient-1/budgets/budget-1'
    )
    expect(screen.queryByText('Eliminar presupuesto')).not.toBeInTheDocument()
  })

  it('shows delete and fires onDelete when user has BUDGETS_DELETE', () => {
    canMock.mockReturnValue(true)
    const onDelete = vi.fn()
    const b = makeBudget()
    renderCard(b, onDelete)
    fireEvent.click(screen.getByLabelText('Actions'))
    fireEvent.click(screen.getByText('Eliminar presupuesto'))
    expect(onDelete).toHaveBeenCalledWith(b)
  })

  it('shows the "Download PDF" action when user has BUDGETS_VIEW', () => {
    canMock.mockImplementation((p) => p === Permission.BUDGETS_VIEW)
    renderCard(makeBudget())
    fireEvent.click(screen.getByLabelText('Actions'))
    expect(screen.getByText('Descargar PDF')).toBeInTheDocument()
  })

  it('hides the "Download PDF" action when user lacks BUDGETS_VIEW', () => {
    canMock.mockImplementation((p) => p !== Permission.BUDGETS_VIEW)
    renderCard(makeBudget())
    fireEvent.click(screen.getByLabelText('Actions'))
    expect(screen.queryByText('Descargar PDF')).not.toBeInTheDocument()
  })

  it('calls downloadBudgetPdf with the budget id when "Download PDF" is clicked', async () => {
    canMock.mockReturnValue(true)
    downloadBudgetPdfMock.mockResolvedValue(undefined)
    const b = makeBudget({ id: 'budget-42' })
    renderCard(b)
    fireEvent.click(screen.getByLabelText('Actions'))
    fireEvent.click(screen.getByText('Descargar PDF'))
    await waitFor(() => {
      expect(downloadBudgetPdfMock).toHaveBeenCalledWith('budget-42')
    })
    expect(downloadBudgetPdfMock).toHaveBeenCalledTimes(1)
  })

  it('shows a disabled spinner while the PDF download is in flight, then returns to idle and closes the menu', async () => {
    canMock.mockReturnValue(true)
    let releaseDownload: () => void = () => {}
    const deferred = new Promise<void>((resolve) => {
      releaseDownload = resolve
    })
    downloadBudgetPdfMock.mockReturnValue(deferred)
    const b = makeBudget({ id: 'budget-99' })
    renderCard(b)

    fireEvent.click(screen.getByLabelText('Actions'))
    fireEvent.click(screen.getByText('Descargar PDF'))

    // Busy state: menu stays open, button is disabled, spinner replaces the download icon.
    const downloadButton = await waitFor(() => screen.getByText('Descargar PDF').closest('button'))
    expect(downloadButton).not.toBeNull()
    expect(downloadButton).toBeDisabled()
    expect(downloadButton?.querySelector('.animate-spin')).not.toBeNull()
    expect(screen.getByText('Ver detalle')).toBeInTheDocument()

    // Resolve the pending download.
    await act(async () => {
      releaseDownload()
      await deferred
    })

    // Idle state: menu closed, so the "Download PDF" action is no longer in the document.
    await waitFor(() => {
      expect(screen.queryByText('Descargar PDF')).not.toBeInTheDocument()
    })
    expect(downloadBudgetPdfMock).toHaveBeenCalledWith('budget-99')
  })

  it('renders item descriptions and per-item status labels inline, in order', () => {
    canMock.mockReturnValue(true)
    renderCard(
      makeBudget({
        items: [
          makeItem({ id: 'i1', description: 'Extracción molar', status: 'EXECUTED', order: 0 }),
          makeItem({ id: 'i2', description: 'Limpieza dental', status: 'PENDING', order: 1 }),
        ],
      })
    )
    const descriptions = screen.getAllByText(/Extracción molar|Limpieza dental/)
    expect(descriptions.map((el) => el.textContent)).toEqual(['Extracción molar', 'Limpieza dental'])
    expect(screen.getByText('Ejecutado')).toBeInTheDocument()
    expect(screen.getByText('Pendiente')).toBeInTheDocument()
  })

  it('preserves the given array order (ascending `order`) even when it disagrees with alphabetical or id order', () => {
    // Descriptions and ids are deliberately NOT alphabetically or lexically
    // sorted, so this fails if the component ever starts sorting client-side
    // (e.g. by description or id) instead of trusting array/`order` order.
    canMock.mockReturnValue(true)
    renderCard(
      makeBudget({
        items: [
          makeItem({ id: 'z9', description: 'Zebra filling', order: 0 }),
          makeItem({ id: 'a1', description: 'Alpha crown', order: 1 }),
          makeItem({ id: 'm5', description: 'Mango root canal', order: 2 }),
        ],
      })
    )
    const list = screen.getByRole('list')
    const rowTexts = Array.from(list.querySelectorAll('li')).map((li) => li.textContent)
    expect(rowTexts[0]).toContain('Zebra filling')
    expect(rowTexts[1]).toContain('Alpha crown')
    expect(rowTexts[2]).toContain('Mango root canal')
  })

  it('renders a distinct icon per item status, not colour alone (PENDING and SCHEDULED share the same colour class)', () => {
    canMock.mockReturnValue(true)
    const statuses: BudgetItemStatus[] = ['PENDING', 'SCHEDULED', 'IN_PROGRESS', 'EXECUTED', 'CANCELLED']
    const items = statuses.map((status, i) =>
      makeItem({ id: `s-${status}`, description: `Item ${status}`, status, order: i })
    )
    renderCard(makeBudget({ items }))

    const expectedIconClass: Record<BudgetItemStatus, string> = {
      PENDING: 'lucide-circle',
      SCHEDULED: 'lucide-clock',
      IN_PROGRESS: 'lucide-refresh-cw',
      EXECUTED: 'lucide-circle-check',
      CANCELLED: 'lucide-circle-x',
    }

    for (const status of statuses) {
      const row = screen.getByText(`Item ${status}`).closest('li')
      expect(row, `expected a row for ${status}`).not.toBeNull()
      const icon = row!.querySelector(`svg.${expectedIconClass[status]}`)
      expect(icon, `expected ${status} row to render a .${expectedIconClass[status]} icon`).not.toBeNull()
    }

    // PENDING and SCHEDULED are both styled with the same "text-gray-400"
    // colour class, so if the icon markup ever collapsed to a shared icon
    // too, the two states would become indistinguishable at a glance.
    const pendingIcon = screen.getByText('Item PENDING').closest('li')!.querySelector('svg')
    const scheduledIcon = screen.getByText('Item SCHEDULED').closest('li')!.querySelector('svg')
    expect(pendingIcon?.getAttribute('class')).not.toEqual(scheduledIcon?.getAttribute('class'))
  })

  it('shows the tooth number when present on an item', () => {
    canMock.mockReturnValue(true)
    renderCard(
      makeBudget({
        items: [makeItem({ id: 'i1', description: 'Extracción', toothNumber: '18', order: 0 })],
      })
    )
    expect(screen.getByText('Diente: 18')).toBeInTheDocument()
  })

  it('renders no item list block when the budget has zero items', () => {
    canMock.mockReturnValue(true)
    renderCard(makeBudget({ items: [] }))
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })

  it('truncates to the first 6 items and expands/collapses the rest inline', () => {
    canMock.mockReturnValue(true)
    const items = Array.from({ length: 8 }, (_, i) =>
      makeItem({ id: `i${i}`, description: `Item ${i}`, order: i })
    )
    renderCard(makeBudget({ items }))

    for (let i = 0; i < 6; i++) {
      expect(screen.getByText(`Item ${i}`)).toBeInTheDocument()
    }
    expect(screen.queryByText('Item 6')).not.toBeInTheDocument()
    expect(screen.queryByText('Item 7')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText(/Ver 2 más/))
    expect(screen.getByText('Item 6')).toBeInTheDocument()
    expect(screen.getByText('Item 7')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Ver menos'))
    expect(screen.queryByText('Item 6')).not.toBeInTheDocument()
    expect(screen.queryByText('Item 7')).not.toBeInTheDocument()
    // First 6 remain visible after collapsing back.
    for (let i = 0; i < 6; i++) {
      expect(screen.getByText(`Item ${i}`)).toBeInTheDocument()
    }
    expect(screen.getByText(/Ver 2 más/)).toBeInTheDocument()
  })
})

// Reads the budget from the store like the real list does, so the card shows
// whatever the server returned after a status change.
function StoreBackedCard({ id }: { id: string }) {
  const budget = useBudgetsStore((s) => s.budgets.find((b) => b.id === id))!
  return <BudgetCard budget={budget} patientId="patient-1" onDelete={vi.fn()} />
}

function renderStoreBacked(budget: Budget) {
  useBudgetsStore.setState({ budgets: [budget], currentBudget: null })
  return render(
    <MemoryRouter>
      <StoreBackedCard id={budget.id} />
    </MemoryRouter>
  )
}

function statusSelect() {
  return screen.getByLabelText('Estado') as HTMLSelectElement
}

function optionValues(select: HTMLSelectElement) {
  return Array.from(select.options).map((o) => o.value)
}

describe('BudgetCard status control (#606)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    canMock.mockReturnValue(true)
  })

  it('sends the chosen status to the API as the PATCH body', async () => {
    const b = makeBudget({ id: 'budget-7', status: 'DRAFT' })
    apiUpdateBudgetMock.mockResolvedValue({ ...b, status: 'CANCELLED' })
    renderStoreBacked(b)
    expect(optionValues(statusSelect())).toContain('CANCELLED')
    fireEvent.change(statusSelect(), { target: { value: 'CANCELLED' } })
    await waitFor(() => expect(apiUpdateBudgetMock).toHaveBeenCalledTimes(1))
    expect(apiUpdateBudgetMock).toHaveBeenCalledWith('budget-7', { status: 'CANCELLED' })
  })

  it('offers DRAFT, APPROVED and CANCELLED', () => {
    renderCard(makeBudget({ status: 'DRAFT', items: [makeItem({ id: 'p1', status: 'PENDING' })] }))
    expect(optionValues(statusSelect())).toEqual(['DRAFT', 'APPROVED', 'CANCELLED'])
  })

  it('does not offer PARTIAL', () => {
    renderCard(makeBudget({ status: 'DRAFT' }))
    expect(optionValues(statusSelect())).not.toContain('PARTIAL')
  })

  it('does not offer COMPLETED', () => {
    renderCard(makeBudget({ status: 'DRAFT' }))
    expect(optionValues(statusSelect())).not.toContain('COMPLETED')
  })

  it('shows a derived current status as a disabled option, not as a settable one', () => {
    renderCard(makeBudget({ status: 'PARTIAL' }))
    const sel = statusSelect()
    expect(sel).toHaveValue('PARTIAL')
    const partial = Array.from(sel.options).find((o) => o.value === 'PARTIAL')!
    expect(partial.disabled).toBe(true)
  })

  it('offers exactly the shared settable list, in its order, when no active line is EXECUTED', () => {
    renderCard(makeBudget({ status: 'DRAFT', items: [makeItem({ id: 'p1', status: 'PENDING' })] }))
    expect(optionValues(statusSelect())).toEqual([...USER_SETTABLE_BUDGET_STATUSES])
  })

  it('does not offer APPROVED when every active line is EXECUTED', () => {
    renderCard(
      makeBudget({
        status: 'DRAFT',
        items: [makeItem({ id: 'e1', status: 'EXECUTED' }), makeItem({ id: 'e2', status: 'EXECUTED' })],
      })
    )
    expect(optionValues(statusSelect())).toEqual(['DRAFT', 'CANCELLED'])
  })

  it('does not offer APPROVED when some but not all active lines are EXECUTED', () => {
    renderCard(
      makeBudget({
        status: 'DRAFT',
        items: [makeItem({ id: 'e1', status: 'EXECUTED' }), makeItem({ id: 'p1', status: 'PENDING' })],
      })
    )
    expect(optionValues(statusSelect())).toEqual(['DRAFT', 'CANCELLED'])
  })

  it('offers APPROVED when no active line is EXECUTED (PENDING and SCHEDULED)', () => {
    renderCard(
      makeBudget({
        status: 'DRAFT',
        items: [makeItem({ id: 'p1', status: 'PENDING' }), makeItem({ id: 's1', status: 'SCHEDULED' })],
      })
    )
    expect(optionValues(statusSelect())).toContain('APPROVED')
  })

  it('does not offer APPROVED for one EXECUTED line plus one CANCELLED line', () => {
    renderCard(
      makeBudget({
        status: 'DRAFT',
        items: [makeItem({ id: 'e1', status: 'EXECUTED' }), makeItem({ id: 'c1', status: 'CANCELLED' })],
      })
    )
    expect(optionValues(statusSelect())).not.toContain('APPROVED')
  })

  it('offers APPROVED when there are no active lines (all cancelled)', () => {
    renderCard(
      makeBudget({
        status: 'DRAFT',
        items: [makeItem({ id: 'c1', status: 'CANCELLED' }), makeItem({ id: 'c2', status: 'CANCELLED' })],
      })
    )
    expect(optionValues(statusSelect())).toContain('APPROVED')
  })

  it('offers APPROVED when the budget has no lines at all', () => {
    renderCard(makeBudget({ status: 'DRAFT', items: [] }))
    expect(optionValues(statusSelect())).toContain('APPROVED')
  })

  it('keeps a current APPROVED status visible as a disabled option when all lines are EXECUTED', () => {
    renderCard(
      makeBudget({ status: 'APPROVED', items: [makeItem({ id: 'e1', status: 'EXECUTED' })] })
    )
    const sel = statusSelect()
    expect(sel).toHaveValue('APPROVED')
    const approved = Array.from(sel.options).find((o) => o.value === 'APPROVED')!
    expect(approved.disabled).toBe(true)
  })

  it('hides the status control but keeps the other actions without BUDGETS_UPDATE', () => {
    canMock.mockImplementation((p) => p !== Permission.BUDGETS_UPDATE)
    renderCard(makeBudget({ status: 'APPROVED' }))
    expect(screen.queryByLabelText('Estado')).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.getByText('Aprobado')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Actions'))
    expect(screen.getByText('Ver detalle')).toBeInTheDocument()
    expect(screen.getByText('Descargar PDF')).toBeInTheDocument()
    expect(screen.getByText('Eliminar presupuesto')).toBeInTheDocument()
  })

  it('leaves the total and the item progress unchanged after a status change', async () => {
    const b = makeBudget({ id: 'budget-3', status: 'DRAFT' })
    apiUpdateBudgetMock.mockResolvedValue({ ...b, status: 'CANCELLED' })
    renderStoreBacked(b)
    expect(screen.getByText(/250\.5/)).toBeInTheDocument()
    expect(screen.getByText(/1.*de.*2/i)).toBeInTheDocument()
    expect(optionValues(statusSelect())).toEqual(['DRAFT', 'CANCELLED'])
    fireEvent.change(statusSelect(), { target: { value: 'CANCELLED' } })
    await waitFor(() => expect(apiUpdateBudgetMock).toHaveBeenCalledWith('budget-3', { status: 'CANCELLED' }))
    await waitFor(() => expect(screen.getByText('Cancelado')).toBeInTheDocument())
    expect(screen.getByText(/250\.5/)).toBeInTheDocument()
    expect(screen.getByText(/1.*de.*2/i)).toBeInTheDocument()
  })
})
