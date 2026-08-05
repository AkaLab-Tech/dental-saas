import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import i18n from 'i18next'
import '@/i18n'
import { BudgetCard } from './BudgetCard'
import type { Budget, BudgetItem, BudgetItemStatus } from '@/lib/budget-api'
import { Permission } from '@dental/shared'

beforeAll(async () => {
  await i18n.changeLanguage('es')
})

const canMock = vi.fn()
const downloadBudgetPdfMock = vi.fn()

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
