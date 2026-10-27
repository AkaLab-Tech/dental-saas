import { describe, it, expect, beforeEach, vi } from 'vitest'
import i18n from 'i18next'
import '@/i18n'
import { useBudgetsStore } from './budgets.store'
import type { BudgetWithVisits as Budget, BudgetItem } from '../lib/budget-api'

vi.mock('../lib/budget-api', () => ({
  listBudgetsByPatient: vi.fn(),
  getBudget: vi.fn(),
  createBudget: vi.fn(),
  updateBudget: vi.fn(),
  deleteBudget: vi.fn(),
  addBudgetItem: vi.fn(),
  updateBudgetItem: vi.fn(),
  deleteBudgetItem: vi.fn(),
}))

import {
  listBudgetsByPatient,
  getBudget,
  createBudget as apiCreateBudget,
  updateBudget as apiUpdateBudget,
  deleteBudget as apiDeleteBudget,
  addBudgetItem as apiAddBudgetItem,
  updateBudgetItem as apiUpdateBudgetItem,
  deleteBudgetItem as apiDeleteBudgetItem,
} from '../lib/budget-api'

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
    money: { total: 100, billed: 50, covered: 30, remaining: 20, notBilled: 50 },
    publicToken: null,
    publicTokenExpiresAt: null,
    isActive: true,
    createdAt: '2026-04-23T00:00:00Z',
    updatedAt: '2026-04-23T00:00:00Z',
    items: [makeItem()],
    visits: [],
    ...overrides,
  }
}

describe('budgets.store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useBudgetsStore.getState().reset()
  })

  it('fetchBudgetsByPatient stores results and patient id', async () => {
    const b = makeBudget()
    vi.mocked(listBudgetsByPatient).mockResolvedValue({ data: [b], total: 1 })
    await useBudgetsStore.getState().fetchBudgetsByPatient('patient-1')
    const s = useBudgetsStore.getState()
    expect(s.budgets).toEqual([b])
    expect(s.currentPatientId).toBe('patient-1')
    expect(s.total).toBe(1)
    expect(s.loading).toBe(false)
    expect(s.error).toBeNull()
  })

  it('fetchBudgetsByPatient sets error on failure', async () => {
    vi.mocked(listBudgetsByPatient).mockRejectedValue(new Error('boom'))
    await useBudgetsStore.getState().fetchBudgetsByPatient('patient-1')
    expect(useBudgetsStore.getState().error).toBe('boom')
  })

  it('fetchBudget stores it as currentBudget', async () => {
    const b = makeBudget()
    vi.mocked(getBudget).mockResolvedValue(b)
    const result = await useBudgetsStore.getState().fetchBudget('budget-1')
    expect(result).toEqual(b)
    expect(useBudgetsStore.getState().currentBudget).toEqual(b)
  })

  it('createBudget prepends the budget to the list when the patient matches', async () => {
    vi.mocked(listBudgetsByPatient).mockResolvedValue({ data: [], total: 0 })
    await useBudgetsStore.getState().fetchBudgetsByPatient('patient-1')

    const b = makeBudget()
    vi.mocked(apiCreateBudget).mockResolvedValue(b)
    await useBudgetsStore
      .getState()
      .createBudget('patient-1', { items: [{ description: 'X', quantity: 1, unitPrice: 10 }] })

    expect(useBudgetsStore.getState().budgets).toEqual([b])
    expect(useBudgetsStore.getState().total).toBe(1)
  })

  it('createBudget does not touch list when patient does not match', async () => {
    vi.mocked(listBudgetsByPatient).mockResolvedValue({ data: [], total: 0 })
    await useBudgetsStore.getState().fetchBudgetsByPatient('patient-1')

    const b = makeBudget({ patientId: 'patient-2' })
    vi.mocked(apiCreateBudget).mockResolvedValue(b)
    await useBudgetsStore
      .getState()
      .createBudget('patient-2', { items: [{ description: 'X', quantity: 1, unitPrice: 10 }] })

    expect(useBudgetsStore.getState().budgets).toEqual([])
    expect(useBudgetsStore.getState().total).toBe(0)
  })

  it('updateBudget replaces the budget in list and currentBudget', async () => {
    const initial = makeBudget()
    vi.mocked(listBudgetsByPatient).mockResolvedValue({ data: [initial], total: 1 })
    await useBudgetsStore.getState().fetchBudgetsByPatient('patient-1')
    vi.mocked(getBudget).mockResolvedValue(initial)
    await useBudgetsStore.getState().fetchBudget('budget-1')

    const updated = makeBudget({ notes: 'updated' })
    vi.mocked(apiUpdateBudget).mockResolvedValue(updated)
    await useBudgetsStore.getState().updateBudget('budget-1', { notes: 'updated' })

    const s = useBudgetsStore.getState()
    expect(s.budgets[0].notes).toBe('updated')
    expect(s.currentBudget?.notes).toBe('updated')
  })

  it('deleteBudget removes from list and clears currentBudget when matching', async () => {
    const b = makeBudget()
    vi.mocked(listBudgetsByPatient).mockResolvedValue({ data: [b], total: 1 })
    await useBudgetsStore.getState().fetchBudgetsByPatient('patient-1')
    vi.mocked(getBudget).mockResolvedValue(b)
    await useBudgetsStore.getState().fetchBudget('budget-1')

    vi.mocked(apiDeleteBudget).mockResolvedValue(makeBudget({ isActive: false }))
    await useBudgetsStore.getState().deleteBudget('budget-1')

    const s = useBudgetsStore.getState()
    expect(s.budgets).toEqual([])
    expect(s.total).toBe(0)
    expect(s.currentBudget).toBeNull()
  })

  it('addItem / updateItem / deleteItem replace the current budget', async () => {
    const initial = makeBudget()
    vi.mocked(getBudget).mockResolvedValue(initial)
    await useBudgetsStore.getState().fetchBudget('budget-1')

    const afterAdd = makeBudget({
      items: [initial.items[0], makeItem({ id: 'item-2' })],
    })
    vi.mocked(apiAddBudgetItem).mockResolvedValue(afterAdd)
    await useBudgetsStore
      .getState()
      .addItem('budget-1', { description: 'Y', quantity: 1, unitPrice: 20 })
    expect(useBudgetsStore.getState().currentBudget?.items).toHaveLength(2)

    const afterUpdate = makeBudget({
      items: [makeItem({ id: 'item-1', status: 'EXECUTED' }), makeItem({ id: 'item-2' })],
    })
    vi.mocked(apiUpdateBudgetItem).mockResolvedValue(afterUpdate)
    await useBudgetsStore
      .getState()
      .updateItem('budget-1', 'item-1', { status: 'EXECUTED' })
    expect(useBudgetsStore.getState().currentBudget?.items[0].status).toBe('EXECUTED')

    const afterDelete = makeBudget({ items: [makeItem({ id: 'item-2' })] })
    vi.mocked(apiDeleteBudgetItem).mockResolvedValue(afterDelete)
    await useBudgetsStore.getState().deleteItem('budget-1', 'item-1')
    expect(useBudgetsStore.getState().currentBudget?.items).toHaveLength(1)
    expect(useBudgetsStore.getState().currentBudget?.items[0].id).toBe('item-2')
  })

  // Task #612: the money the API returns with a write replaces the stored money,
  // in the list and in currentBudget alike (neither blanked nor frozen).
  describe('a write replaces the stored money with the response money', () => {
    const BEFORE = { total: 100, billed: 40, covered: 25, remaining: 15, notBilled: 60 }
    const AFTER = { total: 150, billed: 40, covered: 25, remaining: 15, notBilled: 110 }

    async function seed() {
      const before = makeBudget({ money: BEFORE })
      vi.mocked(listBudgetsByPatient).mockResolvedValue({ data: [before], total: 1 })
      vi.mocked(getBudget).mockResolvedValue(before)
      await useBudgetsStore.getState().fetchBudgetsByPatient('patient-1')
      await useBudgetsStore.getState().fetchBudget('budget-1')
    }

    it('addItem: currentBudget carries the response money', async () => {
      await seed()
      vi.mocked(apiAddBudgetItem).mockResolvedValue(makeBudget({ totalAmount: '150', money: AFTER }))
      await useBudgetsStore
        .getState()
        .addItem('budget-1', { description: 'Y', quantity: 1, unitPrice: 50 })
      expect(useBudgetsStore.getState().currentBudget?.money).toEqual(AFTER)
    })

    it('addItem: the list entry carries the response money', async () => {
      await seed()
      vi.mocked(apiAddBudgetItem).mockResolvedValue(makeBudget({ totalAmount: '150', money: AFTER }))
      await useBudgetsStore
        .getState()
        .addItem('budget-1', { description: 'Y', quantity: 1, unitPrice: 50 })
      expect(useBudgetsStore.getState().budgets[0].money).toEqual(AFTER)
    })

    it('deleteItem: currentBudget carries the response money', async () => {
      await seed()
      vi.mocked(apiDeleteBudgetItem).mockResolvedValue(makeBudget({ money: AFTER }))
      await useBudgetsStore.getState().deleteItem('budget-1', 'item-1')
      expect(useBudgetsStore.getState().currentBudget?.money).toEqual(AFTER)
    })

    it('updateBudget: the list entry carries the response money', async () => {
      await seed()
      vi.mocked(apiUpdateBudget).mockResolvedValue(makeBudget({ money: AFTER }))
      await useBudgetsStore.getState().updateBudget('budget-1', { notes: 'n' })
      expect(useBudgetsStore.getState().budgets[0].money).toEqual(AFTER)
    })
  })

  // Task #639: the API refuses a delete that would move money with 409 and a
  // fixed English message; the budgets section renders this store's `error`
  // verbatim, so the store is where the translation has to happen.
  describe('a refused delete (#639): the operator reads a translated remedy, and nothing is removed', () => {
    // Byte-identical to BUDGET_ERROR_MAP in apps/api/src/routes/budgets.ts,
    // pinned with the same literals in apps/api/src/routes/budgets.test.ts:
    // a drift on either side turns one of the two suites red.
    const BILLED_MESSAGE = 'Budget has executed items; cancel the budget instead of deleting it'
    const RESERVED_MESSAGE =
      'Budget has a reserved advance; cancel the budget instead of deleting it'

    const ES_BILLED =
      'No se puede eliminar: el presupuesto tiene ítems ejecutados que ya se cobran. Cancela el presupuesto en lugar de eliminarlo.'
    const ES_RESERVED =
      'No se puede eliminar: el presupuesto tiene una entrega reservada. Cancela el presupuesto en lugar de eliminarlo.'
    const EN_BILLED =
      "Can't delete: the budget has executed items that are already billed. Cancel the budget instead of deleting it."
    const AR_BILLED =
      'لا يمكن الحذف: الميزانية تحتوي على بنود منفذة تم احتسابها بالفعل. ألغِ الميزانية بدلاً من حذفها.'

    function refusal(message: string, status = 409) {
      // Shaped like the axios error the api client throws: `message` is the
      // generic axios text the store must NOT surface for a known refusal.
      const error = new Error(`Request failed with status code ${status}`)
      return Object.assign(error, { response: { status, data: { success: false, error: message } } })
    }

    async function seedOneBudget() {
      const b = makeBudget()
      vi.mocked(listBudgetsByPatient).mockResolvedValue({ data: [b], total: 1 })
      await useBudgetsStore.getState().fetchBudgetsByPatient('patient-1')
      vi.mocked(getBudget).mockResolvedValue(b)
      await useBudgetsStore.getState().fetchBudget('budget-1')
      return b
    }

    async function attemptDelete(message: string, status = 409) {
      vi.mocked(apiDeleteBudget).mockRejectedValue(refusal(message, status))
      await expect(useBudgetsStore.getState().deleteBudget('budget-1')).rejects.toThrow()
    }

    beforeEach(async () => {
      await i18n.changeLanguage('es')
    })

    it('G7 - HAS_BILLED_ITEMS in es: the error names cancelling as the remedy, not the axios status text', async () => {
      await seedOneBudget()
      await attemptDelete(BILLED_MESSAGE)
      expect(useBudgetsStore.getState().error).toBe(ES_BILLED)
    })

    it('G7b - HAS_RESERVED_ADVANCE in es: its own message, not the billed-items one', async () => {
      await seedOneBudget()
      await attemptDelete(RESERVED_MESSAGE)
      expect(useBudgetsStore.getState().error).toBe(ES_RESERVED)
    })

    it('G7c - HAS_BILLED_ITEMS in en', async () => {
      await i18n.changeLanguage('en')
      await seedOneBudget()
      await attemptDelete(BILLED_MESSAGE)
      expect(useBudgetsStore.getState().error).toBe(EN_BILLED)
    })

    it('G7d - HAS_BILLED_ITEMS in ar', async () => {
      await i18n.changeLanguage('ar')
      await seedOneBudget()
      await attemptDelete(BILLED_MESSAGE)
      expect(useBudgetsStore.getState().error).toBe(AR_BILLED)
    })

    it('G7e - discrimination: a 409 carrying some other message keeps the plain error message', async () => {
      await seedOneBudget()
      await attemptDelete('Some other conflict')
      expect(useBudgetsStore.getState().error).toBe('Request failed with status code 409')
    })

    it('G7f - discrimination: the same refusal text on a non-409 status is not translated', async () => {
      await seedOneBudget()
      await attemptDelete(BILLED_MESSAGE, 500)
      expect(useBudgetsStore.getState().error).toBe('Request failed with status code 500')
    })

    it('G8 - the budget is still in the list after a refused delete', async () => {
      const b = await seedOneBudget()
      await attemptDelete(BILLED_MESSAGE)
      expect(useBudgetsStore.getState().budgets).toEqual([b])
    })

    it('G8b - total is unchanged after a refused delete', async () => {
      await seedOneBudget()
      await attemptDelete(BILLED_MESSAGE)
      expect(useBudgetsStore.getState().total).toBe(1)
    })

    it('G8c - currentBudget is not cleared after a refused delete', async () => {
      const b = await seedOneBudget()
      await attemptDelete(BILLED_MESSAGE)
      expect(useBudgetsStore.getState().currentBudget).toEqual(b)
    })
  })
})
