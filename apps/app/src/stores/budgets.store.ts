import { create } from 'zustand'
import type {
  Budget,
  BudgetWithVisits,
  CreateBudgetData,
  UpdateBudgetData,
  BudgetItemInput,
  UpdateBudgetItemData,
} from '../lib/budget-api'
import {
  listBudgetsByPatient,
  getBudget as apiGetBudget,
  createBudget as apiCreateBudget,
  updateBudget as apiUpdateBudget,
  deleteBudget as apiDeleteBudget,
  addBudgetItem as apiAddBudgetItem,
  updateBudgetItem as apiUpdateBudgetItem,
  deleteBudgetItem as apiDeleteBudgetItem,
} from '../lib/budget-api'

interface BudgetsState {
  // List scoped to a patient
  budgets: Budget[]
  currentPatientId: string | null
  total: number

  // Detail view
  currentBudget: BudgetWithVisits | null

  // UI state
  loading: boolean
  error: string | null

  // Actions
  fetchBudgetsByPatient: (patientId: string) => Promise<void>
  fetchBudget: (budgetId: string) => Promise<BudgetWithVisits>
  createBudget: (patientId: string, data: CreateBudgetData) => Promise<BudgetWithVisits>
  updateBudget: (budgetId: string, data: UpdateBudgetData) => Promise<BudgetWithVisits>
  deleteBudget: (budgetId: string) => Promise<void>
  addItem: (budgetId: string, item: BudgetItemInput) => Promise<BudgetWithVisits>
  updateItem: (budgetId: string, itemId: string, data: UpdateBudgetItemData) => Promise<BudgetWithVisits>
  deleteItem: (budgetId: string, itemId: string) => Promise<BudgetWithVisits>
  clearError: () => void
  reset: () => void
}

function replaceBudget(list: Budget[], updated: Budget): Budget[] {
  return list.map((b) => (b.id === updated.id ? updated : b))
}

export const useBudgetsStore = create<BudgetsState>((set) => ({
  budgets: [],
  currentPatientId: null,
  total: 0,
  currentBudget: null,
  loading: false,
  error: null,

  fetchBudgetsByPatient: async (patientId: string) => {
    set({ loading: true, error: null, currentPatientId: patientId })
    try {
      const { data, total } = await listBudgetsByPatient(patientId)
      set({ budgets: data, total, loading: false })
    } catch (error) {
      set({
        error:
          error instanceof Error ? error.message : 'Error al cargar los presupuestos',
        loading: false,
      })
    }
  },

  fetchBudget: async (budgetId: string) => {
    set({ loading: true, error: null })
    try {
      const budget = await apiGetBudget(budgetId)
      set({ currentBudget: budget, loading: false })
      return budget
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Error al cargar el presupuesto',
        loading: false,
      })
      throw error
    }
  },

  createBudget: async (patientId: string, data: CreateBudgetData) => {
    set({ loading: true, error: null })
    try {
      const budget = await apiCreateBudget(patientId, data)
      set((state) => ({
        budgets:
          state.currentPatientId === patientId ? [budget, ...state.budgets] : state.budgets,
        total: state.currentPatientId === patientId ? state.total + 1 : state.total,
        loading: false,
      }))
      return budget
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Error al crear el presupuesto',
        loading: false,
      })
      throw error
    }
  },

  updateBudget: async (budgetId: string, data: UpdateBudgetData) => {
    set({ loading: true, error: null })
    try {
      const updated = await apiUpdateBudget(budgetId, data)
      set((state) => ({
        budgets: replaceBudget(state.budgets, updated),
        currentBudget:
          state.currentBudget?.id === budgetId ? updated : state.currentBudget,
        loading: false,
      }))
      return updated
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Error al actualizar el presupuesto',
        loading: false,
      })
      throw error
    }
  },

  deleteBudget: async (budgetId: string) => {
    set({ loading: true, error: null })
    try {
      await apiDeleteBudget(budgetId)
      set((state) => ({
        budgets: state.budgets.filter((b) => b.id !== budgetId),
        total: Math.max(0, state.total - 1),
        currentBudget: state.currentBudget?.id === budgetId ? null : state.currentBudget,
        loading: false,
      }))
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Error al eliminar el presupuesto',
        loading: false,
      })
      throw error
    }
  },

  addItem: async (budgetId: string, item: BudgetItemInput) => {
    set({ loading: true, error: null })
    try {
      const updated = await apiAddBudgetItem(budgetId, item)
      set((state) => ({
        budgets: replaceBudget(state.budgets, updated),
        currentBudget:
          state.currentBudget?.id === budgetId ? updated : state.currentBudget,
        loading: false,
      }))
      return updated
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Error al agregar el ítem',
        loading: false,
      })
      throw error
    }
  },

  updateItem: async (budgetId: string, itemId: string, data: UpdateBudgetItemData) => {
    set({ loading: true, error: null })
    try {
      const updated = await apiUpdateBudgetItem(budgetId, itemId, data)
      set((state) => ({
        budgets: replaceBudget(state.budgets, updated),
        currentBudget:
          state.currentBudget?.id === budgetId ? updated : state.currentBudget,
        loading: false,
      }))
      return updated
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Error al actualizar el ítem',
        loading: false,
      })
      throw error
    }
  },

  deleteItem: async (budgetId: string, itemId: string) => {
    set({ loading: true, error: null })
    try {
      const updated = await apiDeleteBudgetItem(budgetId, itemId)
      set((state) => ({
        budgets: replaceBudget(state.budgets, updated),
        currentBudget:
          state.currentBudget?.id === budgetId ? updated : state.currentBudget,
        loading: false,
      }))
      return updated
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Error al eliminar el ítem',
        loading: false,
      })
      throw error
    }
  },

  clearError: () => set({ error: null }),

  reset: () =>
    set({
      budgets: [],
      currentPatientId: null,
      total: 0,
      currentBudget: null,
      loading: false,
      error: null,
    }),
}))
