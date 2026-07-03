import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  listBudgetsByPatient,
  getBudget,
  createBudget,
  updateBudget,
  deleteBudget,
  addBudgetItem,
  updateBudgetItem,
  deleteBudgetItem,
  getExecutedItemsCount,
  shareBudget,
  type Budget,
  type BudgetItem,
} from './budget-api'
import { apiClient } from './api'

vi.mock('./api', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}))

function makeItem(overrides: Partial<BudgetItem> = {}): BudgetItem {
  return {
    id: 'item-1',
    budgetId: 'budget-1',
    description: 'Extracción',
    toothNumber: null,
    quantity: 1,
    unitPrice: '100',
    totalPrice: '100',
    plannedAppointmentType: null,
    status: 'PENDING',
    notes: null,
    order: 0,
    createdAt: '2026-04-23T00:00:00Z',
    updatedAt: '2026-04-23T00:00:00Z',
    ...overrides,
  }
}

function makeBudget(overrides: Partial<Budget> = {}): Budget {
  return {
    id: 'budget-1',
    tenantId: 'tenant-1',
    patientId: 'patient-1',
    createdById: 'user-1',
    status: 'DRAFT',
    notes: null,
    validUntil: null,
    totalAmount: '100',
    publicToken: null,
    publicTokenExpiresAt: null,
    isActive: true,
    createdAt: '2026-04-23T00:00:00Z',
    updatedAt: '2026-04-23T00:00:00Z',
    items: [makeItem()],
    ...overrides,
  }
}

describe('budget-api', () => {
  beforeEach(() => vi.clearAllMocks())

  describe('listBudgetsByPatient', () => {
    it('calls nested endpoint and unwraps data + pagination', async () => {
      const b = makeBudget()
      vi.mocked(apiClient.get).mockResolvedValue({
        data: {
          success: true,
          data: [b],
          pagination: { total: 7, limit: 50, offset: 0 },
        },
      })
      const result = await listBudgetsByPatient('patient-1', { limit: 20 })
      expect(apiClient.get).toHaveBeenCalledWith('/patients/patient-1/budgets', {
        params: { limit: 20 },
      })
      expect(result).toEqual({ data: [b], total: 7 })
    })

    it('falls back to data.length when pagination is missing', async () => {
      const b = makeBudget()
      vi.mocked(apiClient.get).mockResolvedValue({
        data: { success: true, data: [b, b] },
      })
      const result = await listBudgetsByPatient('patient-1')
      expect(result.total).toBe(2)
    })
  })

  it('getBudget hits the top-level endpoint', async () => {
    const b = makeBudget()
    vi.mocked(apiClient.get).mockResolvedValue({ data: { success: true, data: b } })
    const result = await getBudget('budget-1')
    expect(apiClient.get).toHaveBeenCalledWith('/budgets/budget-1')
    expect(result).toEqual(b)
  })

  it('createBudget posts to the nested endpoint', async () => {
    const b = makeBudget()
    vi.mocked(apiClient.post).mockResolvedValue({ data: { success: true, data: b } })
    const result = await createBudget('patient-1', {
      items: [{ description: 'X', quantity: 1, unitPrice: 10 }],
    })
    expect(apiClient.post).toHaveBeenCalledWith('/patients/patient-1/budgets', {
      items: [{ description: 'X', quantity: 1, unitPrice: 10 }],
    })
    expect(result).toEqual(b)
  })

  it('updateBudget patches metadata', async () => {
    const b = makeBudget({ notes: 'updated' })
    vi.mocked(apiClient.patch).mockResolvedValue({ data: { success: true, data: b } })
    const result = await updateBudget('budget-1', { notes: 'updated' })
    expect(apiClient.patch).toHaveBeenCalledWith('/budgets/budget-1', { notes: 'updated' })
    expect(result.notes).toBe('updated')
  })

  it('deleteBudget soft-deletes and returns the budget', async () => {
    const b = makeBudget({ isActive: false })
    vi.mocked(apiClient.delete).mockResolvedValue({ data: { success: true, data: b } })
    const result = await deleteBudget('budget-1')
    expect(apiClient.delete).toHaveBeenCalledWith('/budgets/budget-1')
    expect(result.isActive).toBe(false)
  })

  it('addBudgetItem posts to the items sub-endpoint', async () => {
    const b = makeBudget()
    vi.mocked(apiClient.post).mockResolvedValue({ data: { success: true, data: b } })
    await addBudgetItem('budget-1', { description: 'X', quantity: 1, unitPrice: 10 })
    expect(apiClient.post).toHaveBeenCalledWith(
      '/budgets/budget-1/items',
      { description: 'X', quantity: 1, unitPrice: 10 }
    )
  })

  it('updateBudgetItem patches the item sub-endpoint', async () => {
    const b = makeBudget()
    vi.mocked(apiClient.patch).mockResolvedValue({ data: { success: true, data: b } })
    await updateBudgetItem('budget-1', 'item-1', { status: 'EXECUTED' })
    expect(apiClient.patch).toHaveBeenCalledWith(
      '/budgets/budget-1/items/item-1',
      { status: 'EXECUTED' }
    )
  })

  it('deleteBudgetItem deletes the item sub-endpoint', async () => {
    const b = makeBudget()
    vi.mocked(apiClient.delete).mockResolvedValue({ data: { success: true, data: b } })
    await deleteBudgetItem('budget-1', 'item-1')
    expect(apiClient.delete).toHaveBeenCalledWith('/budgets/budget-1/items/item-1')
  })

  describe('shareBudget', () => {
    it('posts to the share sub-endpoint with an empty body by default', async () => {
      const result = {
        token: 'abc123',
        url: 'http://localhost:5003/budget/abc123',
        expiresAt: null,
      }
      vi.mocked(apiClient.post).mockResolvedValue({ data: { success: true, data: result } })

      const res = await shareBudget('budget-1')

      expect(apiClient.post).toHaveBeenCalledWith('/budgets/budget-1/share', {})
      expect(res).toEqual(result)
    })

    it('posts expiresInDays when provided and returns a non-null expiresAt', async () => {
      const result = {
        token: 'def456',
        url: 'http://localhost:5003/budget/def456',
        expiresAt: '2027-01-01T00:00:00.000Z',
      }
      vi.mocked(apiClient.post).mockResolvedValue({ data: { success: true, data: result } })

      const res = await shareBudget('budget-1', { expiresInDays: 14 })

      expect(apiClient.post).toHaveBeenCalledWith('/budgets/budget-1/share', {
        expiresInDays: 14,
      })
      expect(res.expiresAt).toBe('2027-01-01T00:00:00.000Z')
    })
  })

  describe('getExecutedItemsCount', () => {
    it('counts EXECUTED items against total', () => {
      const budget = makeBudget({
        items: [
          makeItem({ id: 'a', status: 'EXECUTED' }),
          makeItem({ id: 'b', status: 'PENDING' }),
          makeItem({ id: 'c', status: 'EXECUTED' }),
          makeItem({ id: 'd', status: 'SCHEDULED' }),
        ],
      })
      expect(getExecutedItemsCount(budget)).toEqual({ executed: 2, total: 4 })
    })

    it('returns zeros on empty items', () => {
      expect(getExecutedItemsCount({ items: [] })).toEqual({ executed: 0, total: 0 })
    })
  })
})
