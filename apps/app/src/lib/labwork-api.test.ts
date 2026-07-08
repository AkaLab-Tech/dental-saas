import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  getLabworks,
  getLabworkById,
  createLabwork,
  updateLabwork,
  deleteLabwork,
  restoreLabwork,
  getLabworkStats,
  formatLabworkDate,
  getLabworkStatusBadge,
  type Labwork,
  type LabworkStats,
} from './labwork-api'
import { apiClient } from './api'

vi.mock('./api', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}))

const mockLabwork: Labwork = {
  id: 'labwork-123',
  tenantId: 'tenant-456',
  patientId: 'patient-789',
  lab: 'Dental Lab Pro',
  phoneNumber: '+1234567890',
  date: '2024-01-20',
  note: 'Crown for tooth 14',
  price: 350,
  isPaid: false,
  isDelivered: false,
  doctorIds: ['doctor-1'],
  isActive: true,
  deletedAt: null,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-15T00:00:00Z',
  patient: {
    id: 'patient-789',
    firstName: 'John',
    lastName: 'Doe',
    email: 'john@example.com',
    phone: '+1234567890',
  },
}

const mockLabworkStats: LabworkStats = {
  total: 30,
  paid: 20,
  unpaid: 10,
  delivered: 15,
  pending: 15,
  totalValue: 10500,
  paidValue: 7000,
  unpaidValue: 3500,
}

const mockPagination = {
  total: 30,
  limit: 10,
  offset: 0,
}

describe('labwork-api', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getLabworks', () => {
    it('should fetch labworks without params', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: { success: true, data: [mockLabwork], pagination: mockPagination },
      })

      const result = await getLabworks()

      expect(apiClient.get).toHaveBeenCalledWith('/labworks')
      expect(result.data).toEqual([mockLabwork])
      expect(result.pagination).toEqual(mockPagination)
    })

    it('should fetch labworks with all params', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: { success: true, data: [mockLabwork], pagination: mockPagination },
      })

      const result = await getLabworks({
        limit: 10,
        offset: 5,
        search: 'Acme',
        patientId: 'patient-789',
        isPaid: true,
        isDelivered: false,
        from: '2024-01-01',
        to: '2024-01-31',
        includeInactive: true,
      })

      expect(apiClient.get).toHaveBeenCalledWith(
        '/labworks?limit=10&offset=5&search=Acme&patientId=patient-789&isPaid=true&isDelivered=false&from=2024-01-01&to=2024-01-31&includeInactive=true'
      )
      expect(result.data).toEqual([mockLabwork])
    })

    it('should include the search param in the query string when provided', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: { success: true, data: [mockLabwork], pagination: mockPagination },
      })

      await getLabworks({ search: 'Garcia' })

      expect(apiClient.get).toHaveBeenCalledWith('/labworks?search=Garcia')
    })

    it('should omit the search param when it is an empty string', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: { success: true, data: [], pagination: mockPagination },
      })

      await getLabworks({ search: '' })

      expect(apiClient.get).toHaveBeenCalledWith('/labworks')
    })

    it('should omit the search param when it is undefined', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: { success: true, data: [], pagination: mockPagination },
      })

      await getLabworks({ search: undefined, isPaid: true })

      expect(apiClient.get).toHaveBeenCalledWith('/labworks?isPaid=true')
    })

    it('should fetch labworks with boolean false values', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: { success: true, data: [], pagination: mockPagination },
      })

      await getLabworks({ isPaid: false, isDelivered: false })

      expect(apiClient.get).toHaveBeenCalledWith('/labworks?isPaid=false&isDelivered=false')
    })

    it('should handle empty params', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: { success: true, data: [], pagination: { total: 0, limit: 10, offset: 0 } },
      })

      const result = await getLabworks({})

      expect(apiClient.get).toHaveBeenCalledWith('/labworks')
      expect(result.data).toEqual([])
    })

    it('should throw error on fetch failure', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(new Error('Network error'))

      await expect(getLabworks()).rejects.toThrow('Network error')
    })
  })

  describe('getLabworkById', () => {
    it('should fetch a single labwork', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: { success: true, data: mockLabwork },
      })

      const result = await getLabworkById('labwork-123')

      expect(apiClient.get).toHaveBeenCalledWith('/labworks/labwork-123')
      expect(result.data).toEqual(mockLabwork)
    })

    it('should throw error on not found', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(new Error('Labwork not found'))

      await expect(getLabworkById('invalid-id')).rejects.toThrow('Labwork not found')
    })
  })

  describe('createLabwork', () => {
    it('should create a new labwork with all fields', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: { success: true, data: mockLabwork },
      })

      const createData = {
        patientId: 'patient-789',
        lab: 'Dental Lab Pro',
        phoneNumber: '+1234567890',
        date: '2024-01-20',
        note: 'Crown for tooth 14',
        price: 350,
        isPaid: false,
        isDelivered: false,
        doctorIds: ['doctor-1'],
      }

      const result = await createLabwork(createData)

      expect(apiClient.post).toHaveBeenCalledWith('/labworks', createData)
      expect(result.data).toEqual(mockLabwork)
    })

    it('should create labwork with minimal data', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: { success: true, data: mockLabwork },
      })

      const createData = {
        lab: 'Dental Lab',
        date: '2024-01-20',
      }

      const result = await createLabwork(createData)

      expect(apiClient.post).toHaveBeenCalledWith('/labworks', createData)
      expect(result.data).toEqual(mockLabwork)
    })

    it('should throw error on creation failure', async () => {
      vi.mocked(apiClient.post).mockRejectedValue(new Error('Validation error'))

      await expect(createLabwork({ lab: 'Test', date: '2024-01-20' })).rejects.toThrow(
        'Validation error'
      )
    })
  })

  describe('updateLabwork', () => {
    it('should update a labwork', async () => {
      const updatedLabwork = { ...mockLabwork, price: 400 }
      vi.mocked(apiClient.put).mockResolvedValue({
        data: { success: true, data: updatedLabwork },
      })

      const result = await updateLabwork('labwork-123', { price: 400 })

      expect(apiClient.put).toHaveBeenCalledWith('/labworks/labwork-123', { price: 400 })
      expect(result.data.price).toBe(400)
    })

    it('should update delivery and payment status', async () => {
      const completedLabwork = { ...mockLabwork, isPaid: true, isDelivered: true }
      vi.mocked(apiClient.put).mockResolvedValue({
        data: { success: true, data: completedLabwork },
      })

      const result = await updateLabwork('labwork-123', { isPaid: true, isDelivered: true })

      expect(apiClient.put).toHaveBeenCalledWith('/labworks/labwork-123', {
        isPaid: true,
        isDelivered: true,
      })
      expect(result.data.isPaid).toBe(true)
      expect(result.data.isDelivered).toBe(true)
    })

    it('should throw error on update failure', async () => {
      vi.mocked(apiClient.put).mockRejectedValue(new Error('Update failed'))

      await expect(updateLabwork('labwork-123', { price: 400 })).rejects.toThrow('Update failed')
    })
  })

  describe('deleteLabwork', () => {
    it('should delete a labwork', async () => {
      vi.mocked(apiClient.delete).mockResolvedValue({
        data: { success: true, data: mockLabwork },
      })

      const result = await deleteLabwork('labwork-123')

      expect(apiClient.delete).toHaveBeenCalledWith('/labworks/labwork-123')
      expect(result.data).toEqual(mockLabwork)
    })

    it('should throw error on delete failure', async () => {
      vi.mocked(apiClient.delete).mockRejectedValue(new Error('Cannot delete'))

      await expect(deleteLabwork('labwork-123')).rejects.toThrow('Cannot delete')
    })
  })

  describe('restoreLabwork', () => {
    it('should restore a deleted labwork', async () => {
      vi.mocked(apiClient.put).mockResolvedValue({
        data: { success: true, data: mockLabwork },
      })

      const result = await restoreLabwork('labwork-123')

      expect(apiClient.put).toHaveBeenCalledWith('/labworks/labwork-123/restore')
      expect(result.data).toEqual(mockLabwork)
    })

    it('should throw error on restore failure', async () => {
      vi.mocked(apiClient.put).mockRejectedValue(new Error('Labwork not found'))

      await expect(restoreLabwork('invalid-id')).rejects.toThrow('Labwork not found')
    })
  })

  describe('getLabworkStats', () => {
    it('should fetch stats without params', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: { success: true, data: mockLabworkStats },
      })

      const result = await getLabworkStats()

      expect(apiClient.get).toHaveBeenCalledWith('/labworks/stats')
      expect(result.data).toEqual(mockLabworkStats)
    })

    it('should fetch stats with date range', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: { success: true, data: mockLabworkStats },
      })

      const result = await getLabworkStats({ from: '2024-01-01', to: '2024-01-31' })

      expect(apiClient.get).toHaveBeenCalledWith('/labworks/stats?from=2024-01-01&to=2024-01-31')
      expect(result.data).toEqual(mockLabworkStats)
    })

    it('should throw error on stats fetch failure', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(new Error('Failed to fetch stats'))

      await expect(getLabworkStats()).rejects.toThrow('Failed to fetch stats')
    })
  })

  describe('Utility Functions', () => {
    describe('formatLabworkDate', () => {
      it('should format date in Spanish locale', () => {
        const result = formatLabworkDate('2024-01-20')

        expect(result).toMatch(/20/)
        expect(result).toMatch(/2024/)
      })

      it('should handle ISO date string', () => {
        const result = formatLabworkDate('2024-06-15T10:30:00Z')

        expect(result).toMatch(/15/)
        expect(result).toMatch(/2024/)
      })
    })

    describe('getLabworkStatusBadge', () => {
      it('should return destructive badge for inactive labwork', () => {
        const inactiveLabwork = { ...mockLabwork, isActive: false }
        const badge = getLabworkStatusBadge(inactiveLabwork)

        expect(badge.label).toBe('Eliminado')
        expect(badge.variant).toBe('destructive')
      })

      it('should return success badge for completed labwork (delivered and paid)', () => {
        const completedLabwork = { ...mockLabwork, isDelivered: true, isPaid: true }
        const badge = getLabworkStatusBadge(completedLabwork)

        expect(badge.label).toBe('Completado')
        expect(badge.variant).toBe('success')
      })

      it('should return default badge for delivered but unpaid labwork', () => {
        const deliveredLabwork = { ...mockLabwork, isDelivered: true, isPaid: false }
        const badge = getLabworkStatusBadge(deliveredLabwork)

        expect(badge.label).toBe('Entregado')
        expect(badge.variant).toBe('default')
      })

      it('should return warning badge for paid but not delivered labwork', () => {
        const paidLabwork = { ...mockLabwork, isPaid: true, isDelivered: false }
        const badge = getLabworkStatusBadge(paidLabwork)

        expect(badge.label).toBe('Pagado')
        expect(badge.variant).toBe('warning')
      })

      it('should return warning badge for pending labwork', () => {
        const pendingLabwork = { ...mockLabwork, isPaid: false, isDelivered: false }
        const badge = getLabworkStatusBadge(pendingLabwork)

        expect(badge.label).toBe('Pendiente')
        expect(badge.variant).toBe('warning')
      })
    })
  })
})
