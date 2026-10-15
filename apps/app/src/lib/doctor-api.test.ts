import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  getDoctors,
  getDoctorById,
  createDoctor,
  updateDoctor,
  deleteDoctor,
  restoreDoctor,
  getDoctorStats,
  checkDoctorLimit,
  isDoctorApiError,
  getDoctorApiErrorMessage,
  type Doctor,
  type DoctorStats,
} from './doctor-api'
import { apiClient } from './api'

vi.mock('./api', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}))

const mockDoctor: Doctor = {
  id: 'doctor-123',
  tenantId: 'tenant-456',
  firstName: 'Jane',
  lastName: 'Smith',
  email: 'jane.smith@example.com',
  phone: '+1234567890',
  specialty: 'Orthodontics',
  licenseNumber: 'LIC-12345',
  workingDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
  workingHours: { start: '09:00', end: '17:00' },
  consultingRoom: 'Room 101',
  avatar: null,
  bio: 'Experienced orthodontist',
  hourlyRate: 150,
  commissionPercentage: null,
  isActive: true,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-15T00:00:00Z',
}

const mockDoctorStats: DoctorStats = {
  total: 5,
  active: 4,
  inactive: 1,
  limit: 10,
  remaining: 5,
}

describe('doctor-api', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getDoctors', () => {
    it('should fetch doctors without params', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: { success: true, data: [mockDoctor] },
      })

      const result = await getDoctors()

      expect(apiClient.get).toHaveBeenCalledWith('/doctors')
      expect(result).toEqual([mockDoctor])
    })

    it('should fetch doctors with all params', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: { success: true, data: [mockDoctor] },
      })

      const result = await getDoctors({
        limit: 10,
        offset: 5,
        includeInactive: true,
        search: 'smith',
      })

      expect(apiClient.get).toHaveBeenCalledWith(
        '/doctors?limit=10&offset=5&includeInactive=true&search=smith'
      )
      expect(result).toEqual([mockDoctor])
    })

    it('should fetch doctors with partial params', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: { success: true, data: [mockDoctor] },
      })

      const result = await getDoctors({ limit: 20 })

      expect(apiClient.get).toHaveBeenCalledWith('/doctors?limit=20')
      expect(result).toEqual([mockDoctor])
    })

    it('should handle empty params', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: { success: true, data: [] },
      })

      const result = await getDoctors({})

      expect(apiClient.get).toHaveBeenCalledWith('/doctors')
      expect(result).toEqual([])
    })

    it('should return empty array when no doctors', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: { success: true, data: [] },
      })

      const result = await getDoctors()

      expect(result).toEqual([])
    })

    it('should throw error on fetch failure', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(new Error('Network error'))

      await expect(getDoctors()).rejects.toThrow('Network error')
    })
  })

  describe('getDoctorById', () => {
    it('should fetch a single doctor', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: { success: true, data: mockDoctor },
      })

      const result = await getDoctorById('doctor-123')

      expect(apiClient.get).toHaveBeenCalledWith('/doctors/doctor-123')
      expect(result).toEqual(mockDoctor)
    })

    it('should throw error on not found', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(new Error('Doctor not found'))

      await expect(getDoctorById('invalid-id')).rejects.toThrow('Doctor not found')
    })
  })

  describe('createDoctor', () => {
    it('should create a new doctor with all fields', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: { success: true, data: mockDoctor },
      })

      const createData = {
        firstName: 'Jane',
        lastName: 'Smith',
        email: 'jane.smith@example.com',
        phone: '+1234567890',
        specialty: 'Orthodontics',
        licenseNumber: 'LIC-12345',
        workingDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
        workingHours: { start: '09:00', end: '17:00' },
        consultingRoom: 'Room 101',
        bio: 'Experienced orthodontist',
        hourlyRate: 150,
      }

      const result = await createDoctor(createData)

      expect(apiClient.post).toHaveBeenCalledWith('/doctors', createData)
      expect(result).toEqual(mockDoctor)
    })

    it('should create doctor with minimal data', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: { success: true, data: mockDoctor },
      })

      const createData = {
        firstName: 'Jane',
        lastName: 'Smith',
      }

      const result = await createDoctor(createData)

      expect(apiClient.post).toHaveBeenCalledWith('/doctors', createData)
      expect(result).toEqual(mockDoctor)
    })

    it('should throw error on creation failure', async () => {
      vi.mocked(apiClient.post).mockRejectedValue(new Error('Doctor limit reached'))

      await expect(createDoctor({ firstName: 'Jane', lastName: 'Smith' })).rejects.toThrow(
        'Doctor limit reached'
      )
    })
  })

  describe('updateDoctor', () => {
    it('should update a doctor', async () => {
      const updatedDoctor = { ...mockDoctor, firstName: 'Janet' }
      vi.mocked(apiClient.put).mockResolvedValue({
        data: { success: true, data: updatedDoctor },
      })

      const result = await updateDoctor('doctor-123', { firstName: 'Janet' })

      expect(apiClient.put).toHaveBeenCalledWith('/doctors/doctor-123', { firstName: 'Janet' })
      expect(result).toEqual(updatedDoctor)
    })

    it('should update doctor isActive status', async () => {
      const inactiveDoctor = { ...mockDoctor, isActive: false }
      vi.mocked(apiClient.put).mockResolvedValue({
        data: { success: true, data: inactiveDoctor },
      })

      const result = await updateDoctor('doctor-123', { isActive: false })

      expect(apiClient.put).toHaveBeenCalledWith('/doctors/doctor-123', { isActive: false })
      expect(result.isActive).toBe(false)
    })

    it('should update multiple fields', async () => {
      const updatedDoctor = { ...mockDoctor, specialty: 'Endodontics', hourlyRate: 200 }
      vi.mocked(apiClient.put).mockResolvedValue({
        data: { success: true, data: updatedDoctor },
      })

      const result = await updateDoctor('doctor-123', { specialty: 'Endodontics', hourlyRate: 200 })

      expect(apiClient.put).toHaveBeenCalledWith('/doctors/doctor-123', {
        specialty: 'Endodontics',
        hourlyRate: 200,
      })
      expect(result).toEqual(updatedDoctor)
    })

    it('should throw error on update failure', async () => {
      vi.mocked(apiClient.put).mockRejectedValue(new Error('Update failed'))

      await expect(updateDoctor('doctor-123', { firstName: 'Janet' })).rejects.toThrow(
        'Update failed'
      )
    })
  })

  describe('deleteDoctor', () => {
    it('should delete a doctor', async () => {
      vi.mocked(apiClient.delete).mockResolvedValue({ data: {} })

      await deleteDoctor('doctor-123')

      expect(apiClient.delete).toHaveBeenCalledWith('/doctors/doctor-123')
    })

    it('should throw error on delete failure', async () => {
      vi.mocked(apiClient.delete).mockRejectedValue(new Error('Cannot delete'))

      await expect(deleteDoctor('doctor-123')).rejects.toThrow('Cannot delete')
    })
  })

  describe('restoreDoctor', () => {
    it('should restore a deleted doctor', async () => {
      vi.mocked(apiClient.put).mockResolvedValue({
        data: { success: true, data: mockDoctor },
      })

      const result = await restoreDoctor('doctor-123')

      expect(apiClient.put).toHaveBeenCalledWith('/doctors/doctor-123/restore')
      expect(result).toEqual(mockDoctor)
    })

    it('should throw error on restore failure', async () => {
      vi.mocked(apiClient.put).mockRejectedValue(new Error('Doctor not found'))

      await expect(restoreDoctor('invalid-id')).rejects.toThrow('Doctor not found')
    })
  })

  describe('getDoctorStats', () => {
    it('should fetch doctor statistics', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: { success: true, data: mockDoctorStats },
      })

      const result = await getDoctorStats()

      expect(apiClient.get).toHaveBeenCalledWith('/doctors/stats')
      expect(result).toEqual(mockDoctorStats)
    })

    it('should throw error on stats fetch failure', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(new Error('Failed to fetch stats'))

      await expect(getDoctorStats()).rejects.toThrow('Failed to fetch stats')
    })
  })

  describe('checkDoctorLimit', () => {
    it('should return allowed true when under limit', async () => {
      const limitResponse = { allowed: true, currentCount: 3, limit: 10 }
      vi.mocked(apiClient.get).mockResolvedValue({
        data: { success: true, data: limitResponse },
      })

      const result = await checkDoctorLimit()

      expect(apiClient.get).toHaveBeenCalledWith('/doctors/check-limit')
      expect(result).toEqual(limitResponse)
      expect(result.allowed).toBe(true)
    })

    it('should return allowed false with message when at limit', async () => {
      const limitResponse = {
        allowed: false,
        message: 'Doctor limit reached for your plan',
        currentCount: 10,
        limit: 10,
      }
      vi.mocked(apiClient.get).mockResolvedValue({
        data: { success: true, data: limitResponse },
      })

      const result = await checkDoctorLimit()

      expect(result.allowed).toBe(false)
      expect(result.message).toBe('Doctor limit reached for your plan')
      expect(result.currentCount).toBe(10)
      expect(result.limit).toBe(10)
    })

    it('should throw error on check limit failure', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(new Error('Service unavailable'))

      await expect(checkDoctorLimit()).rejects.toThrow('Service unavailable')
    })
  })

  describe('Error Helpers', () => {
    describe('isDoctorApiError', () => {
      it('should return true for valid API error', () => {
        const error = {
          response: {
            data: {
              success: false,
              error: { message: 'Error message' },
            },
          },
        }

        expect(isDoctorApiError(error)).toBe(true)
      })

      it('should return false for non-API error', () => {
        expect(isDoctorApiError(new Error('Regular error'))).toBe(false)
      })

      it('should return false for null', () => {
        expect(isDoctorApiError(null)).toBe(false)
      })

      it('should return false for undefined', () => {
        expect(isDoctorApiError(undefined)).toBe(false)
      })

      it('should return false for object without response', () => {
        expect(isDoctorApiError({ data: 'something' })).toBe(false)
      })

      it('should return false for object with response but no data', () => {
        expect(isDoctorApiError({ response: {} })).toBe(false)
      })

      it('should return true for error with response.data defined', () => {
        const error = {
          response: {
            data: { error: {} },
          },
        }
        expect(isDoctorApiError(error)).toBe(true)
      })
    })

    describe('getDoctorApiErrorMessage', () => {
      it('should extract message from API error', () => {
        const error = {
          response: {
            data: {
              success: false,
              error: { message: 'Doctor not found' },
            },
          },
        }

        expect(getDoctorApiErrorMessage(error)).toBe('Doctor not found')
      })

      it('should return default message for API error without message', () => {
        const error = {
          response: {
            data: {
              success: false,
              error: {},
            },
          },
        }

        expect(getDoctorApiErrorMessage(error)).toBe('An unexpected error occurred')
      })

      it('should return Error message for regular Error', () => {
        const error = new Error('Something went wrong')
        expect(getDoctorApiErrorMessage(error)).toBe('Something went wrong')
      })

      it('should return default message for unknown error types', () => {
        expect(getDoctorApiErrorMessage('string error')).toBe('An unexpected error occurred')
        expect(getDoctorApiErrorMessage(123)).toBe('An unexpected error occurred')
        expect(getDoctorApiErrorMessage(null)).toBe('An unexpected error occurred')
        expect(getDoctorApiErrorMessage(undefined)).toBe('An unexpected error occurred')
      })

      it('should return default message for object without error property', () => {
        const error = {
          response: {
            data: {},
          },
        }
        expect(getDoctorApiErrorMessage(error)).toBe('An unexpected error occurred')
      })
    })
  })
})
