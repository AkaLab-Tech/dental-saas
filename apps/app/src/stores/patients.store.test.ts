import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'
import { ToothStatus } from '@dental/shared'
import { usePatientsStore } from './patients.store'
import type { Patient, PatientStats } from '@/lib/patient-api'

// Mock the patient-api module
vi.mock('@/lib/patient-api', () => ({
  getPatients: vi.fn(),
  getPatientById: vi.fn(),
  createPatient: vi.fn(),
  updatePatient: vi.fn(),
  deletePatient: vi.fn(),
  restorePatient: vi.fn(),
  getPatientStats: vi.fn(),
  getPatientApiErrorMessage: vi.fn((error: unknown) => {
    if (error instanceof Error) return error.message
    return 'An unexpected error occurred'
  }),
}))

// Import mocked functions
import {
  getPatients,
  getPatientById,
  createPatient,
  updatePatient,
  deletePatient,
  restorePatient,
  getPatientStats,
} from '@/lib/patient-api'

const mockPatient: Patient = {
  id: 'patient-123',
  tenantId: 'tenant-456',
  firstName: 'John',
  lastName: 'Doe',
  email: 'john@example.com',
  phone: '+1234567890',
  dob: '1990-05-15',
  gender: 'male',
  address: '123 Main St',
  notes: { allergies: 'penicillin' },
  teeth: { '11': { note: 'cavity', status: ToothStatus.CARIES } },
  coverageType: 'PARTICULAR',
  convenioName: null,
  showPrimaryTeeth: false,
  isActive: true,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
}

const mockPatient2: Patient = {
  id: 'patient-456',
  tenantId: 'tenant-456',
  firstName: 'Jane',
  lastName: 'Smith',
  email: 'jane@example.com',
  phone: '+0987654321',
  dob: '1985-10-20',
  gender: 'female',
  address: '456 Oak Ave',
  notes: null,
  teeth: null,
  coverageType: 'PARTICULAR',
  convenioName: null,
  showPrimaryTeeth: false,
  isActive: true,
  createdAt: '2024-01-02T00:00:00Z',
  updatedAt: '2024-01-02T00:00:00Z',
}

const mockStats: PatientStats = {
  total: 10,
  active: 8,
  inactive: 2,
  limit: 25,
  remaining: 15,
}

describe('patients.store', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    usePatientsStore.setState({
      patients: [],
      selectedPatient: null,
      stats: null,
      isLoading: false,
      error: null,
      searchQuery: '',
      showInactive: false,
    })
    vi.clearAllMocks()
  })

  describe('initial state', () => {
    it('should have empty patients array', () => {
      const state = usePatientsStore.getState()
      expect(state.patients).toEqual([])
    })

    it('should have null selectedPatient', () => {
      const state = usePatientsStore.getState()
      expect(state.selectedPatient).toBeNull()
    })

    it('should have null stats', () => {
      const state = usePatientsStore.getState()
      expect(state.stats).toBeNull()
    })

    it('should not be loading', () => {
      const state = usePatientsStore.getState()
      expect(state.isLoading).toBe(false)
    })

    it('should have no error', () => {
      const state = usePatientsStore.getState()
      expect(state.error).toBeNull()
    })

    it('should have empty search query', () => {
      const state = usePatientsStore.getState()
      expect(state.searchQuery).toBe('')
    })

    it('should not show inactive patients by default', () => {
      const state = usePatientsStore.getState()
      expect(state.showInactive).toBe(false)
    })
  })

  describe('fetchPatients', () => {
    it('should fetch patients successfully', async () => {
      ;(getPatients as Mock).mockResolvedValue([mockPatient, mockPatient2])

      await usePatientsStore.getState().fetchPatients()

      const state = usePatientsStore.getState()
      expect(state.patients).toEqual([mockPatient, mockPatient2])
      expect(state.isLoading).toBe(false)
      expect(state.error).toBeNull()
    })

    it('should set loading state during fetch', async () => {
      ;(getPatients as Mock).mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve([]), 100))
      )

      const fetchPromise = usePatientsStore.getState().fetchPatients()

      // Check loading state immediately
      expect(usePatientsStore.getState().isLoading).toBe(true)

      await fetchPromise
      expect(usePatientsStore.getState().isLoading).toBe(false)
    })

    it('should use searchQuery from state when no params provided', async () => {
      usePatientsStore.setState({ searchQuery: 'John' })
      ;(getPatients as Mock).mockResolvedValue([mockPatient])

      await usePatientsStore.getState().fetchPatients()

      expect(getPatients).toHaveBeenCalledWith({
        search: 'John',
        includeInactive: false,
      })
    })

    it('should use showInactive from state when no params provided', async () => {
      usePatientsStore.setState({ showInactive: true })
      ;(getPatients as Mock).mockResolvedValue([mockPatient])

      await usePatientsStore.getState().fetchPatients()

      expect(getPatients).toHaveBeenCalledWith({
        search: undefined,
        includeInactive: true,
      })
    })

    it('should override state with provided params', async () => {
      usePatientsStore.setState({ searchQuery: 'John', showInactive: true })
      ;(getPatients as Mock).mockResolvedValue([])

      await usePatientsStore.getState().fetchPatients({
        search: 'Jane',
        includeInactive: false,
      })

      expect(getPatients).toHaveBeenCalledWith({
        search: 'Jane',
        includeInactive: false,
      })
    })

    it('should handle fetch error', async () => {
      const errorMessage = 'Network error'
      ;(getPatients as Mock).mockRejectedValue(new Error(errorMessage))

      await usePatientsStore.getState().fetchPatients()

      const state = usePatientsStore.getState()
      expect(state.error).toBe(errorMessage)
      expect(state.isLoading).toBe(false)
      expect(state.patients).toEqual([])
    })
  })

  describe('fetchPatientById', () => {
    it('should fetch a single patient and set as selected', async () => {
      ;(getPatientById as Mock).mockResolvedValue(mockPatient)

      const result = await usePatientsStore.getState().fetchPatientById('patient-123')

      expect(result).toEqual(mockPatient)
      expect(usePatientsStore.getState().selectedPatient).toEqual(mockPatient)
      expect(usePatientsStore.getState().isLoading).toBe(false)
    })

    it('should return null on error', async () => {
      ;(getPatientById as Mock).mockRejectedValue(new Error('Not found'))

      const result = await usePatientsStore.getState().fetchPatientById('invalid-id')

      expect(result).toBeNull()
      expect(usePatientsStore.getState().error).toBe('Not found')
    })
  })

  describe('fetchStats', () => {
    it('should fetch stats successfully', async () => {
      ;(getPatientStats as Mock).mockResolvedValue(mockStats)

      await usePatientsStore.getState().fetchStats()

      expect(usePatientsStore.getState().stats).toEqual(mockStats)
    })

    it('should not set error on stats fetch failure (non-critical)', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      ;(getPatientStats as Mock).mockRejectedValue(new Error('Stats unavailable'))

      await usePatientsStore.getState().fetchStats()

      const state = usePatientsStore.getState()
      expect(state.error).toBeNull()
      expect(state.stats).toBeNull()
      expect(consoleSpy).toHaveBeenCalled()

      consoleSpy.mockRestore()
    })
  })

  describe('addPatient', () => {
    it('should add patient to list on success', async () => {
      usePatientsStore.setState({ patients: [mockPatient2] })
      ;(createPatient as Mock).mockResolvedValue(mockPatient)
      ;(getPatientStats as Mock).mockResolvedValue(mockStats)

      const result = await usePatientsStore.getState().addPatient({
        firstName: 'John',
        lastName: 'Doe',
      })

      expect(result).toEqual(mockPatient)
      const state = usePatientsStore.getState()
      expect(state.patients).toHaveLength(2)
      expect(state.patients).toContainEqual(mockPatient)
      expect(state.isLoading).toBe(false)
    })

    it('should refresh stats after adding patient', async () => {
      ;(createPatient as Mock).mockResolvedValue(mockPatient)
      ;(getPatientStats as Mock).mockResolvedValue(mockStats)

      await usePatientsStore.getState().addPatient({
        firstName: 'John',
        lastName: 'Doe',
      })

      expect(getPatientStats).toHaveBeenCalled()
    })

    it('should throw error on failure', async () => {
      const errorMessage = 'Plan limit reached'
      ;(createPatient as Mock).mockRejectedValue(new Error(errorMessage))

      await expect(
        usePatientsStore.getState().addPatient({
          firstName: 'John',
          lastName: 'Doe',
        })
      ).rejects.toThrow(errorMessage)

      expect(usePatientsStore.getState().error).toBe(errorMessage)
    })
  })

  describe('editPatient', () => {
    it('should update patient in list', async () => {
      const updatedPatient = { ...mockPatient, firstName: 'Johnny' }
      usePatientsStore.setState({ patients: [mockPatient, mockPatient2] })
      ;(updatePatient as Mock).mockResolvedValue(updatedPatient)

      const result = await usePatientsStore
        .getState()
        .editPatient('patient-123', { firstName: 'Johnny' })

      expect(result).toEqual(updatedPatient)
      const state = usePatientsStore.getState()
      expect(state.patients.find((p) => p.id === 'patient-123')?.firstName).toBe('Johnny')
    })

    it('should update selectedPatient if editing the selected one', async () => {
      const updatedPatient = { ...mockPatient, firstName: 'Johnny' }
      usePatientsStore.setState({
        patients: [mockPatient],
        selectedPatient: mockPatient,
      })
      ;(updatePatient as Mock).mockResolvedValue(updatedPatient)

      await usePatientsStore.getState().editPatient('patient-123', { firstName: 'Johnny' })

      expect(usePatientsStore.getState().selectedPatient).toEqual(updatedPatient)
    })

    it('should not update selectedPatient if editing a different patient', async () => {
      const updatedPatient2 = { ...mockPatient2, firstName: 'Janet' }
      usePatientsStore.setState({
        patients: [mockPatient, mockPatient2],
        selectedPatient: mockPatient,
      })
      ;(updatePatient as Mock).mockResolvedValue(updatedPatient2)

      await usePatientsStore.getState().editPatient('patient-456', { firstName: 'Janet' })

      expect(usePatientsStore.getState().selectedPatient).toEqual(mockPatient)
    })

    it('should throw error on failure', async () => {
      usePatientsStore.setState({ patients: [mockPatient] })
      ;(updatePatient as Mock).mockRejectedValue(new Error('Update failed'))

      await expect(
        usePatientsStore.getState().editPatient('patient-123', { firstName: 'Johnny' })
      ).rejects.toThrow('Update failed')
    })
  })

  describe('removePatient', () => {
    it('should remove patient from list when not showing inactive', async () => {
      usePatientsStore.setState({
        patients: [mockPatient, mockPatient2],
        showInactive: false,
      })
      ;(deletePatient as Mock).mockResolvedValue(undefined)
      ;(getPatientStats as Mock).mockResolvedValue(mockStats)

      await usePatientsStore.getState().removePatient('patient-123')

      const state = usePatientsStore.getState()
      expect(state.patients).toHaveLength(1)
      expect(state.patients[0].id).toBe('patient-456')
    })

    it('should mark patient as inactive when showing inactive', async () => {
      usePatientsStore.setState({
        patients: [mockPatient, mockPatient2],
        showInactive: true,
      })
      ;(deletePatient as Mock).mockResolvedValue(undefined)
      ;(getPatientStats as Mock).mockResolvedValue(mockStats)

      await usePatientsStore.getState().removePatient('patient-123')

      const state = usePatientsStore.getState()
      expect(state.patients).toHaveLength(2)
      expect(state.patients.find((p) => p.id === 'patient-123')?.isActive).toBe(false)
    })

    it('should clear selectedPatient if removing the selected one', async () => {
      usePatientsStore.setState({
        patients: [mockPatient],
        selectedPatient: mockPatient,
      })
      ;(deletePatient as Mock).mockResolvedValue(undefined)
      ;(getPatientStats as Mock).mockResolvedValue(mockStats)

      await usePatientsStore.getState().removePatient('patient-123')

      expect(usePatientsStore.getState().selectedPatient).toBeNull()
    })

    it('should refresh stats after removing patient', async () => {
      usePatientsStore.setState({ patients: [mockPatient] })
      ;(deletePatient as Mock).mockResolvedValue(undefined)
      ;(getPatientStats as Mock).mockResolvedValue(mockStats)

      await usePatientsStore.getState().removePatient('patient-123')

      expect(getPatientStats).toHaveBeenCalled()
    })

    it('should throw error on failure', async () => {
      usePatientsStore.setState({ patients: [mockPatient] })
      ;(deletePatient as Mock).mockRejectedValue(new Error('Delete failed'))

      await expect(usePatientsStore.getState().removePatient('patient-123')).rejects.toThrow(
        'Delete failed'
      )
    })
  })

  describe('restoreDeletedPatient', () => {
    it('should restore patient in list', async () => {
      const inactivePatient = { ...mockPatient, isActive: false }
      const restoredPatient = { ...mockPatient, isActive: true }
      usePatientsStore.setState({ patients: [inactivePatient] })
      ;(restorePatient as Mock).mockResolvedValue(restoredPatient)
      ;(getPatientStats as Mock).mockResolvedValue(mockStats)

      const result = await usePatientsStore.getState().restoreDeletedPatient('patient-123')

      expect(result).toEqual(restoredPatient)
      const state = usePatientsStore.getState()
      expect(state.patients.find((p) => p.id === 'patient-123')?.isActive).toBe(true)
    })

    it('should refresh stats after restoring patient', async () => {
      const inactivePatient = { ...mockPatient, isActive: false }
      usePatientsStore.setState({ patients: [inactivePatient] })
      ;(restorePatient as Mock).mockResolvedValue(mockPatient)
      ;(getPatientStats as Mock).mockResolvedValue(mockStats)

      await usePatientsStore.getState().restoreDeletedPatient('patient-123')

      expect(getPatientStats).toHaveBeenCalled()
    })

    it('should throw error on failure', async () => {
      usePatientsStore.setState({ patients: [{ ...mockPatient, isActive: false }] })
      ;(restorePatient as Mock).mockRejectedValue(new Error('Restore failed'))

      await expect(
        usePatientsStore.getState().restoreDeletedPatient('patient-123')
      ).rejects.toThrow('Restore failed')
    })
  })

  describe('setSelectedPatient', () => {
    it('should set the selected patient', () => {
      usePatientsStore.getState().setSelectedPatient(mockPatient)

      expect(usePatientsStore.getState().selectedPatient).toEqual(mockPatient)
    })

    it('should allow setting to null', () => {
      usePatientsStore.setState({ selectedPatient: mockPatient })

      usePatientsStore.getState().setSelectedPatient(null)

      expect(usePatientsStore.getState().selectedPatient).toBeNull()
    })
  })

  describe('setSearchQuery', () => {
    it('should set the search query', () => {
      usePatientsStore.getState().setSearchQuery('John')

      expect(usePatientsStore.getState().searchQuery).toBe('John')
    })

    it('should allow empty string', () => {
      usePatientsStore.setState({ searchQuery: 'something' })

      usePatientsStore.getState().setSearchQuery('')

      expect(usePatientsStore.getState().searchQuery).toBe('')
    })
  })

  describe('setShowInactive', () => {
    it('should set showInactive to true', () => {
      usePatientsStore.getState().setShowInactive(true)

      expect(usePatientsStore.getState().showInactive).toBe(true)
    })

    it('should set showInactive to false', () => {
      usePatientsStore.setState({ showInactive: true })

      usePatientsStore.getState().setShowInactive(false)

      expect(usePatientsStore.getState().showInactive).toBe(false)
    })
  })

  describe('clearError', () => {
    it('should clear the error', () => {
      usePatientsStore.setState({ error: 'Some error' })

      usePatientsStore.getState().clearError()

      expect(usePatientsStore.getState().error).toBeNull()
    })
  })

  describe('reset', () => {
    it('should reset to initial state', () => {
      usePatientsStore.setState({
        patients: [mockPatient, mockPatient2],
        selectedPatient: mockPatient,
        stats: mockStats,
        isLoading: true,
        error: 'Some error',
        searchQuery: 'test',
        showInactive: true,
      })

      usePatientsStore.getState().reset()

      const state = usePatientsStore.getState()
      expect(state.patients).toEqual([])
      expect(state.selectedPatient).toBeNull()
      expect(state.stats).toBeNull()
      expect(state.isLoading).toBe(false)
      expect(state.error).toBeNull()
      expect(state.searchQuery).toBe('')
      expect(state.showInactive).toBe(false)
    })
  })
})
