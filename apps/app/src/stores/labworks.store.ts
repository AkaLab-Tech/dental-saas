import { create } from 'zustand'
import type {
  Labwork,
  LabworkStats,
  CreateLabworkData,
  UpdateLabworkData,
  LabworkListParams,
} from '../lib/labwork-api'
import {
  getLabworks,
  createLabwork as apiCreateLabwork,
  updateLabwork as apiUpdateLabwork,
  deleteLabwork as apiDeleteLabwork,
  restoreLabwork as apiRestoreLabwork,
  getLabworkStats,
} from '../lib/labwork-api'

interface LabworksState {
  // Data
  labworks: Labwork[]
  stats: LabworkStats | null
  total: number

  // UI State
  loading: boolean
  error: string | null

  // Filters
  filters: LabworkListParams

  // Actions
  fetchLabworks: (params?: LabworkListParams) => Promise<void>
  fetchStats: (params?: { from?: string; to?: string }) => Promise<void>
  createLabwork: (data: CreateLabworkData) => Promise<Labwork>
  updateLabwork: (id: string, data: UpdateLabworkData) => Promise<Labwork>
  deleteLabwork: (id: string) => Promise<void>
  restoreLabwork: (id: string) => Promise<void>
  setFilters: (filters: Partial<LabworkListParams>) => void
  clearError: () => void
}

export const useLabworksStore = create<LabworksState>((set, get) => ({
  // Initial state
  labworks: [],
  stats: null,
  total: 0,
  loading: false,
  error: null,
  filters: {},

  fetchLabworks: async (params?: LabworkListParams) => {
    set({ loading: true, error: null })
    try {
      const mergedParams = { ...get().filters, ...params }
      const response = await getLabworks(mergedParams)
      set({
        labworks: response.data,
        total: response.pagination.total,
        loading: false,
      })
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Error al cargar trabajos de laboratorio',
        loading: false,
      })
    }
  },

  fetchStats: async (params?: { from?: string; to?: string }) => {
    try {
      const response = await getLabworkStats(params)
      set({ stats: response.data })
    } catch (error) {
      console.error('Error fetching labwork stats:', error)
    }
  },

  createLabwork: async (data: CreateLabworkData) => {
    set({ loading: true, error: null })
    try {
      const response = await apiCreateLabwork(data)
      const newLabwork = response.data
      set((state) => ({
        labworks: [newLabwork, ...state.labworks],
        total: state.total + 1,
        loading: false,
      }))
      // Refresh stats
      get().fetchStats()
      return newLabwork
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Error al crear trabajo de laboratorio',
        loading: false,
      })
      throw error
    }
  },

  updateLabwork: async (id: string, data: UpdateLabworkData) => {
    set({ loading: true, error: null })
    try {
      const response = await apiUpdateLabwork(id, data)
      const updatedLabwork = response.data
      set((state) => ({
        labworks: state.labworks.map((l) => (l.id === id ? updatedLabwork : l)),
        loading: false,
      }))
      // Refresh stats if payment or lifecycle status changed
      if (data.isPaid !== undefined || data.isDelivered !== undefined || data.status !== undefined) {
        get().fetchStats()
      }
      return updatedLabwork
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Error al actualizar trabajo de laboratorio',
        loading: false,
      })
      throw error
    }
  },

  deleteLabwork: async (id: string) => {
    set({ loading: true, error: null })
    try {
      await apiDeleteLabwork(id)
      set((state) => ({
        labworks: state.labworks.filter((l) => l.id !== id),
        total: state.total - 1,
        loading: false,
      }))
      get().fetchStats()
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Error al eliminar trabajo de laboratorio',
        loading: false,
      })
      throw error
    }
  },

  restoreLabwork: async (id: string) => {
    set({ loading: true, error: null })
    try {
      const response = await apiRestoreLabwork(id)
      set((state) => ({
        labworks: state.labworks.map((l) => (l.id === id ? response.data : l)),
        loading: false,
      }))
      get().fetchStats()
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Error al restaurar trabajo de laboratorio',
        loading: false,
      })
      throw error
    }
  },

  setFilters: (filters: Partial<LabworkListParams>) => {
    set((state) => ({
      filters: { ...state.filters, ...filters },
    }))
  },

  clearError: () => set({ error: null }),
}))
