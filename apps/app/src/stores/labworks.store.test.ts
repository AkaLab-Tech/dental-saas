import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'
import { useLabworksStore } from './labworks.store'
import type { Labwork, LabworkStats } from '../lib/labwork-api'

// Mock the labwork-api module
vi.mock('../lib/labwork-api', () => ({
  getLabworks: vi.fn(),
  createLabwork: vi.fn(),
  updateLabwork: vi.fn(),
  deleteLabwork: vi.fn(),
  restoreLabwork: vi.fn(),
  getLabworkStats: vi.fn(),
}))

// Import mocked functions
import {
  getLabworks,
  createLabwork as apiCreateLabwork,
  updateLabwork as apiUpdateLabwork,
  deleteLabwork as apiDeleteLabwork,
  restoreLabwork as apiRestoreLabwork,
  getLabworkStats,
} from '../lib/labwork-api'

const mockLabwork: Labwork = {
  id: 'labwork-123',
  tenantId: 'tenant-456',
  patientId: 'patient-789',
  lab: 'Dental Lab Pro',
  phoneNumber: '+1234567890',
  date: '2024-01-15',
  note: 'Crown for molar',
  price: 300,
  isPaid: true,
  isDelivered: false,
  doctorIds: ['doctor-101'],
  isActive: true,
  deletedAt: null,
  createdAt: '2024-01-15T00:00:00Z',
  updatedAt: '2024-01-15T00:00:00Z',
  patient: {
    id: 'patient-789',
    firstName: 'John',
    lastName: 'Doe',
    email: 'john@example.com',
    phone: '+1234567890',
  },
}

const mockLabwork2: Labwork = {
  id: 'labwork-456',
  tenantId: 'tenant-456',
  patientId: null,
  lab: 'Quick Dental Lab',
  phoneNumber: null,
  date: '2024-01-20',
  note: null,
  price: 150,
  isPaid: false,
  isDelivered: true,
  doctorIds: [],
  isActive: true,
  deletedAt: null,
  createdAt: '2024-01-20T00:00:00Z',
  updatedAt: '2024-01-20T00:00:00Z',
  patient: null,
}

const mockStats: LabworkStats = {
  total: 15,
  paid: 10,
  unpaid: 5,
  delivered: 8,
  pending: 7,
  totalValue: 4500,
  paidValue: 3000,
  unpaidValue: 1500,
}

describe('labworks.store', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    useLabworksStore.setState({
      labworks: [],
      stats: null,
      total: 0,
      loading: false,
      error: null,
      filters: {},
    })
    vi.clearAllMocks()
  })

  describe('initial state', () => {
    it('should have empty labworks array', () => {
      const state = useLabworksStore.getState()
      expect(state.labworks).toEqual([])
    })

    it('should have null stats', () => {
      const state = useLabworksStore.getState()
      expect(state.stats).toBeNull()
    })

    it('should have zero total', () => {
      const state = useLabworksStore.getState()
      expect(state.total).toBe(0)
    })

    it('should not be loading', () => {
      const state = useLabworksStore.getState()
      expect(state.loading).toBe(false)
    })

    it('should have empty filters', () => {
      const state = useLabworksStore.getState()
      expect(state.filters).toEqual({})
    })
  })

  describe('fetchLabworks', () => {
    it('should fetch labworks successfully', async () => {
      ;(getLabworks as Mock).mockResolvedValue({
        data: [mockLabwork, mockLabwork2],
        pagination: { total: 2 },
      })

      await useLabworksStore.getState().fetchLabworks()

      const state = useLabworksStore.getState()
      expect(state.labworks).toEqual([mockLabwork, mockLabwork2])
      expect(state.total).toBe(2)
      expect(state.loading).toBe(false)
    })

    it('should merge filters from state with params', async () => {
      useLabworksStore.setState({ filters: { isPaid: true } })
      ;(getLabworks as Mock).mockResolvedValue({
        data: [],
        pagination: { total: 0 },
      })

      await useLabworksStore.getState().fetchLabworks({ isDelivered: false })

      expect(getLabworks).toHaveBeenCalledWith({ isPaid: true, isDelivered: false })
    })

    it('should handle fetch error', async () => {
      ;(getLabworks as Mock).mockRejectedValue(new Error('Network error'))

      await useLabworksStore.getState().fetchLabworks()

      const state = useLabworksStore.getState()
      expect(state.error).toBe('Network error')
      expect(state.loading).toBe(false)
    })
  })

  describe('fetchStats', () => {
    it('should fetch stats successfully', async () => {
      ;(getLabworkStats as Mock).mockResolvedValue({ data: mockStats })

      await useLabworksStore.getState().fetchStats()

      expect(useLabworksStore.getState().stats).toEqual(mockStats)
    })

    it('should not set error on stats fetch failure', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      ;(getLabworkStats as Mock).mockRejectedValue(new Error('Stats unavailable'))

      await useLabworksStore.getState().fetchStats()

      expect(useLabworksStore.getState().error).toBeNull()
      expect(consoleSpy).toHaveBeenCalled()

      consoleSpy.mockRestore()
    })
  })

  describe('createLabwork', () => {
    it('should add labwork to beginning of list', async () => {
      useLabworksStore.setState({ labworks: [mockLabwork2], total: 1 })
      ;(apiCreateLabwork as Mock).mockResolvedValue({ data: mockLabwork })
      ;(getLabworkStats as Mock).mockResolvedValue({ data: mockStats })

      const result = await useLabworksStore.getState().createLabwork({
        lab: 'Dental Lab Pro',
        date: '2024-01-15',
      })

      expect(result).toEqual(mockLabwork)
      const state = useLabworksStore.getState()
      expect(state.labworks).toHaveLength(2)
      expect(state.labworks[0]).toEqual(mockLabwork) // Added at beginning
      expect(state.total).toBe(2)
    })

    it('should refresh stats after creating', async () => {
      ;(apiCreateLabwork as Mock).mockResolvedValue({ data: mockLabwork })
      ;(getLabworkStats as Mock).mockResolvedValue({ data: mockStats })

      await useLabworksStore.getState().createLabwork({
        lab: 'Dental Lab Pro',
        date: '2024-01-15',
      })

      expect(getLabworkStats).toHaveBeenCalled()
    })

    it('should throw error on failure', async () => {
      ;(apiCreateLabwork as Mock).mockRejectedValue(new Error('Create failed'))

      await expect(
        useLabworksStore.getState().createLabwork({
          lab: 'Dental Lab Pro',
          date: '2024-01-15',
        })
      ).rejects.toThrow()

      expect(useLabworksStore.getState().error).toBe('Create failed')
    })
  })

  describe('updateLabwork', () => {
    it('should update labwork in list', async () => {
      const updatedLabwork = { ...mockLabwork, price: 350 }
      useLabworksStore.setState({ labworks: [mockLabwork, mockLabwork2] })
      ;(apiUpdateLabwork as Mock).mockResolvedValue({ data: updatedLabwork })

      const result = await useLabworksStore.getState().updateLabwork('labwork-123', { price: 350 })

      expect(result).toEqual(updatedLabwork)
      const state = useLabworksStore.getState()
      expect(state.labworks.find((l) => l.id === 'labwork-123')?.price).toBe(350)
    })

    it('should refresh stats when isPaid changes', async () => {
      useLabworksStore.setState({ labworks: [mockLabwork] })
      ;(apiUpdateLabwork as Mock).mockResolvedValue({
        data: { ...mockLabwork, isPaid: false },
      })
      ;(getLabworkStats as Mock).mockResolvedValue({ data: mockStats })

      await useLabworksStore.getState().updateLabwork('labwork-123', { isPaid: false })

      expect(getLabworkStats).toHaveBeenCalled()
    })

    it('should refresh stats when isDelivered changes', async () => {
      useLabworksStore.setState({ labworks: [mockLabwork] })
      ;(apiUpdateLabwork as Mock).mockResolvedValue({
        data: { ...mockLabwork, isDelivered: true },
      })
      ;(getLabworkStats as Mock).mockResolvedValue({ data: mockStats })

      await useLabworksStore.getState().updateLabwork('labwork-123', { isDelivered: true })

      expect(getLabworkStats).toHaveBeenCalled()
    })

    it('should not refresh stats when isPaid/isDelivered/status are not changed', async () => {
      useLabworksStore.setState({ labworks: [mockLabwork] })
      ;(apiUpdateLabwork as Mock).mockResolvedValue({
        data: { ...mockLabwork, price: 350 },
      })

      await useLabworksStore.getState().updateLabwork('labwork-123', { price: 350 })

      expect(getLabworkStats).not.toHaveBeenCalled()
    })

    // Task #243-B: the lifecycle `status` field is a third trigger for the
    // stats refresh, alongside the pre-existing isPaid/isDelivered triggers.
    it('should refresh stats when status changes', async () => {
      useLabworksStore.setState({ labworks: [mockLabwork] })
      ;(apiUpdateLabwork as Mock).mockResolvedValue({
        data: { ...mockLabwork, status: 'RECEIVED' },
      })
      ;(getLabworkStats as Mock).mockResolvedValue({ data: mockStats })

      await useLabworksStore.getState().updateLabwork('labwork-123', { status: 'RECEIVED' })

      expect(getLabworkStats).toHaveBeenCalled()
    })
  })

  describe('deleteLabwork', () => {
    it('should remove labwork from list', async () => {
      useLabworksStore.setState({ labworks: [mockLabwork, mockLabwork2], total: 2 })
      ;(apiDeleteLabwork as Mock).mockResolvedValue(undefined)
      ;(getLabworkStats as Mock).mockResolvedValue({ data: mockStats })

      await useLabworksStore.getState().deleteLabwork('labwork-123')

      const state = useLabworksStore.getState()
      expect(state.labworks).toHaveLength(1)
      expect(state.labworks[0].id).toBe('labwork-456')
      expect(state.total).toBe(1)
    })

    it('should refresh stats after deleting', async () => {
      useLabworksStore.setState({ labworks: [mockLabwork], total: 1 })
      ;(apiDeleteLabwork as Mock).mockResolvedValue(undefined)
      ;(getLabworkStats as Mock).mockResolvedValue({ data: mockStats })

      await useLabworksStore.getState().deleteLabwork('labwork-123')

      expect(getLabworkStats).toHaveBeenCalled()
    })
  })

  describe('restoreLabwork', () => {
    it('should restore labwork in list', async () => {
      const inactiveLabwork = { ...mockLabwork, isActive: false }
      const restoredLabwork = { ...mockLabwork, isActive: true }
      useLabworksStore.setState({ labworks: [inactiveLabwork] })
      ;(apiRestoreLabwork as Mock).mockResolvedValue({ data: restoredLabwork })
      ;(getLabworkStats as Mock).mockResolvedValue({ data: mockStats })

      await useLabworksStore.getState().restoreLabwork('labwork-123')

      const state = useLabworksStore.getState()
      expect(state.labworks[0].isActive).toBe(true)
    })
  })

  describe('setFilters', () => {
    it('should merge new filters with existing', () => {
      useLabworksStore.setState({ filters: { isPaid: true } })

      useLabworksStore.getState().setFilters({ isDelivered: false })

      expect(useLabworksStore.getState().filters).toEqual({
        isPaid: true,
        isDelivered: false,
      })
    })

    it('should override existing filter values', () => {
      useLabworksStore.setState({ filters: { isPaid: true } })

      useLabworksStore.getState().setFilters({ isPaid: false })

      expect(useLabworksStore.getState().filters).toEqual({ isPaid: false })
    })
  })

  describe('clearError', () => {
    it('should clear the error', () => {
      useLabworksStore.setState({ error: 'Some error' })

      useLabworksStore.getState().clearError()

      expect(useLabworksStore.getState().error).toBeNull()
    })
  })
})
