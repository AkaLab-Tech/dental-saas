import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'
import { useDoctorsStore } from './doctors.store'
import type { Doctor, DoctorStats } from '@/lib/doctor-api'

// Mock the doctor-api module
vi.mock('@/lib/doctor-api', () => ({
  getDoctors: vi.fn(),
  getDoctorById: vi.fn(),
  createDoctor: vi.fn(),
  updateDoctor: vi.fn(),
  deleteDoctor: vi.fn(),
  restoreDoctor: vi.fn(),
  getDoctorStats: vi.fn(),
  getDoctorApiErrorMessage: vi.fn((error: unknown) => {
    if (error instanceof Error) return error.message
    return 'An unexpected error occurred'
  }),
}))

// Import mocked functions
import {
  getDoctors,
  getDoctorById,
  createDoctor,
  updateDoctor,
  deleteDoctor,
  restoreDoctor,
  getDoctorStats,
} from '@/lib/doctor-api'

const mockDoctor: Doctor = {
  id: 'doctor-123',
  tenantId: 'tenant-456',
  firstName: 'John',
  lastName: 'Smith',
  email: 'john.smith@clinic.com',
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
  updatedAt: '2024-01-01T00:00:00Z',
}

const mockDoctor2: Doctor = {
  id: 'doctor-456',
  tenantId: 'tenant-456',
  firstName: 'Jane',
  lastName: 'Doe',
  email: 'jane.doe@clinic.com',
  phone: '+0987654321',
  specialty: 'Endodontics',
  licenseNumber: 'LIC-67890',
  workingDays: ['monday', 'wednesday', 'friday'],
  workingHours: { start: '08:00', end: '16:00' },
  consultingRoom: 'Room 102',
  avatar: null,
  bio: null,
  hourlyRate: 175,
  commissionPercentage: null,
  isActive: true,
  createdAt: '2024-01-02T00:00:00Z',
  updatedAt: '2024-01-02T00:00:00Z',
}

const mockStats: DoctorStats = {
  total: 5,
  active: 4,
  inactive: 1,
  limit: 10,
  remaining: 5,
}

describe('doctors.store', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    useDoctorsStore.setState({
      doctors: [],
      selectedDoctor: null,
      stats: null,
      isLoading: false,
      error: null,
      searchQuery: '',
      showInactive: false,
    })
    vi.clearAllMocks()
  })

  describe('initial state', () => {
    it('should have empty doctors array', () => {
      const state = useDoctorsStore.getState()
      expect(state.doctors).toEqual([])
    })

    it('should have null selectedDoctor', () => {
      const state = useDoctorsStore.getState()
      expect(state.selectedDoctor).toBeNull()
    })

    it('should have null stats', () => {
      const state = useDoctorsStore.getState()
      expect(state.stats).toBeNull()
    })

    it('should not be loading', () => {
      const state = useDoctorsStore.getState()
      expect(state.isLoading).toBe(false)
    })

    it('should have no error', () => {
      const state = useDoctorsStore.getState()
      expect(state.error).toBeNull()
    })

    it('should have empty search query', () => {
      const state = useDoctorsStore.getState()
      expect(state.searchQuery).toBe('')
    })

    it('should not show inactive doctors by default', () => {
      const state = useDoctorsStore.getState()
      expect(state.showInactive).toBe(false)
    })
  })

  describe('fetchDoctors', () => {
    it('should fetch doctors successfully', async () => {
      ;(getDoctors as Mock).mockResolvedValue([mockDoctor, mockDoctor2])

      await useDoctorsStore.getState().fetchDoctors()

      const state = useDoctorsStore.getState()
      expect(state.doctors).toEqual([mockDoctor, mockDoctor2])
      expect(state.isLoading).toBe(false)
      expect(state.error).toBeNull()
    })

    it('should set loading state during fetch', async () => {
      ;(getDoctors as Mock).mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve([]), 100))
      )

      const fetchPromise = useDoctorsStore.getState().fetchDoctors()

      expect(useDoctorsStore.getState().isLoading).toBe(true)

      await fetchPromise
      expect(useDoctorsStore.getState().isLoading).toBe(false)
    })

    it('should use searchQuery from state when no params provided', async () => {
      useDoctorsStore.setState({ searchQuery: 'Smith' })
      ;(getDoctors as Mock).mockResolvedValue([mockDoctor])

      await useDoctorsStore.getState().fetchDoctors()

      expect(getDoctors).toHaveBeenCalledWith({
        search: 'Smith',
        includeInactive: false,
      })
    })

    it('should use showInactive from state when no params provided', async () => {
      useDoctorsStore.setState({ showInactive: true })
      ;(getDoctors as Mock).mockResolvedValue([mockDoctor])

      await useDoctorsStore.getState().fetchDoctors()

      expect(getDoctors).toHaveBeenCalledWith({
        search: undefined,
        includeInactive: true,
      })
    })

    it('should override state with provided params', async () => {
      useDoctorsStore.setState({ searchQuery: 'Smith', showInactive: true })
      ;(getDoctors as Mock).mockResolvedValue([])

      await useDoctorsStore.getState().fetchDoctors({
        search: 'Doe',
        includeInactive: false,
      })

      expect(getDoctors).toHaveBeenCalledWith({
        search: 'Doe',
        includeInactive: false,
      })
    })

    it('should handle fetch error', async () => {
      const errorMessage = 'Network error'
      ;(getDoctors as Mock).mockRejectedValue(new Error(errorMessage))

      await useDoctorsStore.getState().fetchDoctors()

      const state = useDoctorsStore.getState()
      expect(state.error).toBe(errorMessage)
      expect(state.isLoading).toBe(false)
      expect(state.doctors).toEqual([])
    })
  })

  describe('fetchDoctorById', () => {
    it('should fetch a single doctor and set as selected', async () => {
      ;(getDoctorById as Mock).mockResolvedValue(mockDoctor)

      const result = await useDoctorsStore.getState().fetchDoctorById('doctor-123')

      expect(result).toEqual(mockDoctor)
      expect(useDoctorsStore.getState().selectedDoctor).toEqual(mockDoctor)
      expect(useDoctorsStore.getState().isLoading).toBe(false)
    })

    it('should return null on error', async () => {
      ;(getDoctorById as Mock).mockRejectedValue(new Error('Not found'))

      const result = await useDoctorsStore.getState().fetchDoctorById('invalid-id')

      expect(result).toBeNull()
      expect(useDoctorsStore.getState().error).toBe('Not found')
    })
  })

  describe('fetchStats', () => {
    it('should fetch stats successfully', async () => {
      ;(getDoctorStats as Mock).mockResolvedValue(mockStats)

      await useDoctorsStore.getState().fetchStats()

      expect(useDoctorsStore.getState().stats).toEqual(mockStats)
    })

    it('should not set error on stats fetch failure (non-critical)', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      ;(getDoctorStats as Mock).mockRejectedValue(new Error('Stats unavailable'))

      await useDoctorsStore.getState().fetchStats()

      const state = useDoctorsStore.getState()
      expect(state.error).toBeNull()
      expect(state.stats).toBeNull()
      expect(consoleSpy).toHaveBeenCalled()

      consoleSpy.mockRestore()
    })
  })

  describe('addDoctor', () => {
    it('should add doctor to list on success', async () => {
      useDoctorsStore.setState({ doctors: [mockDoctor2] })
      ;(createDoctor as Mock).mockResolvedValue(mockDoctor)
      ;(getDoctorStats as Mock).mockResolvedValue(mockStats)

      const result = await useDoctorsStore.getState().addDoctor({
        firstName: 'John',
        lastName: 'Smith',
      })

      expect(result).toEqual(mockDoctor)
      const state = useDoctorsStore.getState()
      expect(state.doctors).toHaveLength(2)
      expect(state.doctors).toContainEqual(mockDoctor)
      expect(state.isLoading).toBe(false)
    })

    it('should refresh stats after adding doctor', async () => {
      ;(createDoctor as Mock).mockResolvedValue(mockDoctor)
      ;(getDoctorStats as Mock).mockResolvedValue(mockStats)

      await useDoctorsStore.getState().addDoctor({
        firstName: 'John',
        lastName: 'Smith',
      })

      expect(getDoctorStats).toHaveBeenCalled()
    })

    it('should throw error on failure', async () => {
      const errorMessage = 'Plan limit reached'
      ;(createDoctor as Mock).mockRejectedValue(new Error(errorMessage))

      await expect(
        useDoctorsStore.getState().addDoctor({
          firstName: 'John',
          lastName: 'Smith',
        })
      ).rejects.toThrow(errorMessage)

      expect(useDoctorsStore.getState().error).toBe(errorMessage)
    })
  })

  describe('editDoctor', () => {
    it('should update doctor in list', async () => {
      const updatedDoctor = { ...mockDoctor, firstName: 'Johnny' }
      useDoctorsStore.setState({ doctors: [mockDoctor, mockDoctor2] })
      ;(updateDoctor as Mock).mockResolvedValue(updatedDoctor)

      const result = await useDoctorsStore
        .getState()
        .editDoctor('doctor-123', { firstName: 'Johnny' })

      expect(result).toEqual(updatedDoctor)
      const state = useDoctorsStore.getState()
      expect(state.doctors.find((d) => d.id === 'doctor-123')?.firstName).toBe('Johnny')
    })

    it('should update selectedDoctor if editing the selected one', async () => {
      const updatedDoctor = { ...mockDoctor, firstName: 'Johnny' }
      useDoctorsStore.setState({
        doctors: [mockDoctor],
        selectedDoctor: mockDoctor,
      })
      ;(updateDoctor as Mock).mockResolvedValue(updatedDoctor)

      await useDoctorsStore.getState().editDoctor('doctor-123', { firstName: 'Johnny' })

      expect(useDoctorsStore.getState().selectedDoctor).toEqual(updatedDoctor)
    })

    it('should not update selectedDoctor if editing a different doctor', async () => {
      const updatedDoctor2 = { ...mockDoctor2, firstName: 'Janet' }
      useDoctorsStore.setState({
        doctors: [mockDoctor, mockDoctor2],
        selectedDoctor: mockDoctor,
      })
      ;(updateDoctor as Mock).mockResolvedValue(updatedDoctor2)

      await useDoctorsStore.getState().editDoctor('doctor-456', { firstName: 'Janet' })

      expect(useDoctorsStore.getState().selectedDoctor).toEqual(mockDoctor)
    })

    it('should throw error on failure', async () => {
      useDoctorsStore.setState({ doctors: [mockDoctor] })
      ;(updateDoctor as Mock).mockRejectedValue(new Error('Update failed'))

      await expect(
        useDoctorsStore.getState().editDoctor('doctor-123', { firstName: 'Johnny' })
      ).rejects.toThrow('Update failed')
    })
  })

  describe('removeDoctor', () => {
    it('should remove doctor from list when not showing inactive', async () => {
      useDoctorsStore.setState({
        doctors: [mockDoctor, mockDoctor2],
        showInactive: false,
      })
      ;(deleteDoctor as Mock).mockResolvedValue(undefined)
      ;(getDoctorStats as Mock).mockResolvedValue(mockStats)

      await useDoctorsStore.getState().removeDoctor('doctor-123')

      const state = useDoctorsStore.getState()
      expect(state.doctors).toHaveLength(1)
      expect(state.doctors[0].id).toBe('doctor-456')
    })

    it('should mark doctor as inactive when showing inactive', async () => {
      useDoctorsStore.setState({
        doctors: [mockDoctor, mockDoctor2],
        showInactive: true,
      })
      ;(deleteDoctor as Mock).mockResolvedValue(undefined)
      ;(getDoctorStats as Mock).mockResolvedValue(mockStats)

      await useDoctorsStore.getState().removeDoctor('doctor-123')

      const state = useDoctorsStore.getState()
      expect(state.doctors).toHaveLength(2)
      expect(state.doctors.find((d) => d.id === 'doctor-123')?.isActive).toBe(false)
    })

    it('should clear selectedDoctor if removing the selected one', async () => {
      useDoctorsStore.setState({
        doctors: [mockDoctor],
        selectedDoctor: mockDoctor,
      })
      ;(deleteDoctor as Mock).mockResolvedValue(undefined)
      ;(getDoctorStats as Mock).mockResolvedValue(mockStats)

      await useDoctorsStore.getState().removeDoctor('doctor-123')

      expect(useDoctorsStore.getState().selectedDoctor).toBeNull()
    })

    it('should refresh stats after removing doctor', async () => {
      useDoctorsStore.setState({ doctors: [mockDoctor] })
      ;(deleteDoctor as Mock).mockResolvedValue(undefined)
      ;(getDoctorStats as Mock).mockResolvedValue(mockStats)

      await useDoctorsStore.getState().removeDoctor('doctor-123')

      expect(getDoctorStats).toHaveBeenCalled()
    })

    it('should throw error on failure', async () => {
      useDoctorsStore.setState({ doctors: [mockDoctor] })
      ;(deleteDoctor as Mock).mockRejectedValue(new Error('Delete failed'))

      await expect(useDoctorsStore.getState().removeDoctor('doctor-123')).rejects.toThrow(
        'Delete failed'
      )
    })
  })

  describe('restoreDeletedDoctor', () => {
    it('should restore doctor in list', async () => {
      const inactiveDoctor = { ...mockDoctor, isActive: false }
      const restoredDoctor = { ...mockDoctor, isActive: true }
      useDoctorsStore.setState({ doctors: [inactiveDoctor] })
      ;(restoreDoctor as Mock).mockResolvedValue(restoredDoctor)
      ;(getDoctorStats as Mock).mockResolvedValue(mockStats)

      const result = await useDoctorsStore.getState().restoreDeletedDoctor('doctor-123')

      expect(result).toEqual(restoredDoctor)
      const state = useDoctorsStore.getState()
      expect(state.doctors.find((d) => d.id === 'doctor-123')?.isActive).toBe(true)
    })

    it('should refresh stats after restoring doctor', async () => {
      const inactiveDoctor = { ...mockDoctor, isActive: false }
      useDoctorsStore.setState({ doctors: [inactiveDoctor] })
      ;(restoreDoctor as Mock).mockResolvedValue(mockDoctor)
      ;(getDoctorStats as Mock).mockResolvedValue(mockStats)

      await useDoctorsStore.getState().restoreDeletedDoctor('doctor-123')

      expect(getDoctorStats).toHaveBeenCalled()
    })

    it('should throw error on failure', async () => {
      useDoctorsStore.setState({ doctors: [{ ...mockDoctor, isActive: false }] })
      ;(restoreDoctor as Mock).mockRejectedValue(new Error('Restore failed'))

      await expect(useDoctorsStore.getState().restoreDeletedDoctor('doctor-123')).rejects.toThrow(
        'Restore failed'
      )
    })
  })

  describe('setSelectedDoctor', () => {
    it('should set the selected doctor', () => {
      useDoctorsStore.getState().setSelectedDoctor(mockDoctor)

      expect(useDoctorsStore.getState().selectedDoctor).toEqual(mockDoctor)
    })

    it('should allow setting to null', () => {
      useDoctorsStore.setState({ selectedDoctor: mockDoctor })

      useDoctorsStore.getState().setSelectedDoctor(null)

      expect(useDoctorsStore.getState().selectedDoctor).toBeNull()
    })
  })

  describe('setSearchQuery', () => {
    it('should set the search query', () => {
      useDoctorsStore.getState().setSearchQuery('Smith')

      expect(useDoctorsStore.getState().searchQuery).toBe('Smith')
    })

    it('should allow empty string', () => {
      useDoctorsStore.setState({ searchQuery: 'something' })

      useDoctorsStore.getState().setSearchQuery('')

      expect(useDoctorsStore.getState().searchQuery).toBe('')
    })
  })

  describe('setShowInactive', () => {
    it('should set showInactive to true', () => {
      useDoctorsStore.getState().setShowInactive(true)

      expect(useDoctorsStore.getState().showInactive).toBe(true)
    })

    it('should set showInactive to false', () => {
      useDoctorsStore.setState({ showInactive: true })

      useDoctorsStore.getState().setShowInactive(false)

      expect(useDoctorsStore.getState().showInactive).toBe(false)
    })
  })

  describe('clearError', () => {
    it('should clear the error', () => {
      useDoctorsStore.setState({ error: 'Some error' })

      useDoctorsStore.getState().clearError()

      expect(useDoctorsStore.getState().error).toBeNull()
    })
  })

  describe('reset', () => {
    it('should reset to initial state', () => {
      useDoctorsStore.setState({
        doctors: [mockDoctor, mockDoctor2],
        selectedDoctor: mockDoctor,
        stats: mockStats,
        isLoading: true,
        error: 'Some error',
        searchQuery: 'test',
        showInactive: true,
      })

      useDoctorsStore.getState().reset()

      const state = useDoctorsStore.getState()
      expect(state.doctors).toEqual([])
      expect(state.selectedDoctor).toBeNull()
      expect(state.stats).toBeNull()
      expect(state.isLoading).toBe(false)
      expect(state.error).toBeNull()
      expect(state.searchQuery).toBe('')
      expect(state.showInactive).toBe(false)
    })
  })
})
