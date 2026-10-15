import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ToothStatus } from '@dental/shared'
import {
  getPatients,
  getPatientById,
  getPatientAppointments,
  createPatient,
  updatePatient,
  deletePatient,
  restorePatient,
  getPatientStats,
  getPatientTeeth,
  updatePatientTeeth,
  updateToothData,
  deleteToothData,
  updateShowPrimaryTeeth,
  updateToothNote,
  deleteToothNote,
  calculateAge,
  getPatientFullName,
  getPatientInitials,
  isPatientApiError,
  getPatientApiErrorMessage,
  type Patient,
  type PatientStats,
  type PatientAppointment,
} from './patient-api'
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

const mockPatient: Patient = {
  id: 'patient-123',
  tenantId: 'tenant-456',
  firstName: 'John',
  lastName: 'Doe',
  email: 'john@example.com',
  phone: '+1234567890',
  dob: '1990-05-15',
  gender: 'male',
  coverageType: 'PARTICULAR',
  convenioName: null,
  address: '123 Main St',
  notes: { allergies: 'none' },
  teeth: { '11': { note: 'cavity', status: ToothStatus.CARIES } },
  showPrimaryTeeth: false,
  isActive: true,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-15T00:00:00Z',
}

const mockPatientStats: PatientStats = {
  total: 50,
  active: 45,
  inactive: 5,
  limit: 60,
  remaining: 10,
}

const mockAppointment: PatientAppointment = {
  id: 'apt-123',
  tenantId: 'tenant-456',
  patientId: 'patient-123',
  doctorId: 'doctor-789',
  startTime: '2024-01-20T10:00:00Z',
  endTime: '2024-01-20T10:30:00Z',
  duration: 30,
  status: 'SCHEDULED',
  type: 'checkup',
  notes: 'Regular checkup',
  cost: 100,
  isPaid: false,
  doctor: {
    id: 'doctor-789',
    firstName: 'Jane',
    lastName: 'Smith',
    specialty: 'General',
  },
}

describe('patient-api', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getPatients', () => {
    it('should fetch patients without params', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: { success: true, data: [mockPatient] },
      })

      const result = await getPatients()

      expect(apiClient.get).toHaveBeenCalledWith('/patients')
      expect(result).toEqual([mockPatient])
    })

    it('should fetch patients with all params', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: { success: true, data: [mockPatient] },
      })

      const result = await getPatients({
        limit: 10,
        offset: 5,
        includeInactive: true,
        search: 'john',
      })

      expect(apiClient.get).toHaveBeenCalledWith(
        '/patients?limit=10&offset=5&includeInactive=true&search=john'
      )
      expect(result).toEqual([mockPatient])
    })

    it('should handle empty params', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: { success: true, data: [] },
      })

      const result = await getPatients({})

      expect(apiClient.get).toHaveBeenCalledWith('/patients')
      expect(result).toEqual([])
    })
  })

  describe('getPatientById', () => {
    it('should fetch a single patient', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: { success: true, data: mockPatient },
      })

      const result = await getPatientById('patient-123')

      expect(apiClient.get).toHaveBeenCalledWith('/patients/patient-123')
      expect(result).toEqual(mockPatient)
    })

    it('should throw error on not found', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(new Error('Patient not found'))

      await expect(getPatientById('invalid-id')).rejects.toThrow('Patient not found')
    })
  })

  describe('getPatientAppointments', () => {
    it('should fetch patient appointments without params', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: { success: true, data: [mockAppointment] },
      })

      const result = await getPatientAppointments('patient-123')

      expect(apiClient.get).toHaveBeenCalledWith('/patients/patient-123/appointments')
      expect(result).toEqual([mockAppointment])
    })

    it('should fetch patient appointments with pagination', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: { success: true, data: [mockAppointment] },
      })

      const result = await getPatientAppointments('patient-123', { limit: 5, offset: 10 })

      expect(apiClient.get).toHaveBeenCalledWith(
        '/patients/patient-123/appointments?limit=5&offset=10'
      )
      expect(result).toEqual([mockAppointment])
    })
  })

  describe('createPatient', () => {
    it('should create a new patient', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: { success: true, data: mockPatient },
      })

      const createData = {
        firstName: 'John',
        lastName: 'Doe',
        email: 'john@example.com',
        phone: '+1234567890',
      }

      const result = await createPatient(createData)

      expect(apiClient.post).toHaveBeenCalledWith('/patients', createData)
      expect(result).toEqual(mockPatient)
    })

    it('should create patient with minimal data', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: { success: true, data: mockPatient },
      })

      const createData = {
        firstName: 'John',
        lastName: 'Doe',
      }

      const result = await createPatient(createData)

      expect(apiClient.post).toHaveBeenCalledWith('/patients', createData)
      expect(result).toEqual(mockPatient)
    })

    it('should throw error on creation failure', async () => {
      vi.mocked(apiClient.post).mockRejectedValue(new Error('Patient limit reached'))

      await expect(createPatient({ firstName: 'John', lastName: 'Doe' })).rejects.toThrow(
        'Patient limit reached'
      )
    })
  })

  describe('updatePatient', () => {
    it('should update a patient', async () => {
      const updatedPatient = { ...mockPatient, firstName: 'Jane' }
      vi.mocked(apiClient.put).mockResolvedValue({
        data: { success: true, data: updatedPatient },
      })

      const result = await updatePatient('patient-123', { firstName: 'Jane' })

      expect(apiClient.put).toHaveBeenCalledWith('/patients/patient-123', { firstName: 'Jane' })
      expect(result).toEqual(updatedPatient)
    })

    it('should update patient isActive status', async () => {
      const inactivePatient = { ...mockPatient, isActive: false }
      vi.mocked(apiClient.put).mockResolvedValue({
        data: { success: true, data: inactivePatient },
      })

      const result = await updatePatient('patient-123', { isActive: false })

      expect(apiClient.put).toHaveBeenCalledWith('/patients/patient-123', { isActive: false })
      expect(result.isActive).toBe(false)
    })
  })

  describe('deletePatient', () => {
    it('should delete a patient', async () => {
      vi.mocked(apiClient.delete).mockResolvedValue({ data: {} })

      await deletePatient('patient-123')

      expect(apiClient.delete).toHaveBeenCalledWith('/patients/patient-123')
    })

    it('should throw error on delete failure', async () => {
      vi.mocked(apiClient.delete).mockRejectedValue(new Error('Cannot delete'))

      await expect(deletePatient('patient-123')).rejects.toThrow('Cannot delete')
    })
  })

  describe('restorePatient', () => {
    it('should restore a deleted patient', async () => {
      vi.mocked(apiClient.put).mockResolvedValue({
        data: { success: true, data: mockPatient },
      })

      const result = await restorePatient('patient-123')

      expect(apiClient.put).toHaveBeenCalledWith('/patients/patient-123/restore')
      expect(result).toEqual(mockPatient)
    })
  })

  describe('getPatientStats', () => {
    it('should fetch patient statistics', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: { success: true, data: mockPatientStats },
      })

      const result = await getPatientStats()

      expect(apiClient.get).toHaveBeenCalledWith('/patients/stats')
      expect(result).toEqual(mockPatientStats)
    })
  })

  describe('Dental Chart API', () => {
    describe('getPatientTeeth', () => {
      it('should fetch patient teeth data', async () => {
        const teethData = {
          '11': { note: 'cavity', status: 'caries' },
          '21': { note: 'filled', status: 'filled' },
        }
        vi.mocked(apiClient.get).mockResolvedValue({
          data: { success: true, data: teethData },
        })

        const result = await getPatientTeeth('patient-123')

        expect(apiClient.get).toHaveBeenCalledWith('/patients/patient-123/teeth')
        expect(result).toEqual(teethData)
      })
    })

    describe('updatePatientTeeth', () => {
      it('should update patient teeth data', async () => {
        const teethUpdate = {
          '11': { note: 'treated', status: ToothStatus.FILLED },
          '12': { note: 'cavity', status: ToothStatus.CARIES },
        }
        vi.mocked(apiClient.patch).mockResolvedValue({
          data: { success: true, data: mockPatient },
        })

        const result = await updatePatientTeeth('patient-123', teethUpdate)

        expect(apiClient.patch).toHaveBeenCalledWith('/patients/patient-123/teeth', teethUpdate)
        expect(result).toEqual(mockPatient)
      })
    })

    describe('updateToothData', () => {
      it('should update a single tooth data with note and status', async () => {
        vi.mocked(apiClient.patch).mockResolvedValue({
          data: { success: true, data: mockPatient },
        })

        const result = await updateToothData('patient-123', '11', { note: 'new note', status: ToothStatus.CARIES })

        expect(apiClient.patch).toHaveBeenCalledWith('/patients/patient-123/teeth', {
          '11': { note: 'new note', status: 'caries' },
        })
        expect(result).toEqual(mockPatient)
      })
    })

    describe('deleteToothData', () => {
      it('should delete tooth data by setting empty note and healthy status', async () => {
        vi.mocked(apiClient.patch).mockResolvedValue({
          data: { success: true, data: mockPatient },
        })

        const result = await deleteToothData('patient-123', '11')

        expect(apiClient.patch).toHaveBeenCalledWith('/patients/patient-123/teeth', {
          '11': { note: '', status: 'healthy' },
        })
        expect(result).toEqual(mockPatient)
      })
    })

    describe('updateShowPrimaryTeeth', () => {
      it('should PATCH the show-primary-teeth endpoint and return the persisted value', async () => {
        vi.mocked(apiClient.patch).mockResolvedValue({
          data: { success: true, data: { showPrimaryTeeth: true } },
        })

        const result = await updateShowPrimaryTeeth('patient-123', true)

        expect(apiClient.patch).toHaveBeenCalledWith(
          '/patients/patient-123/show-primary-teeth',
          { showPrimaryTeeth: true }
        )
        expect(result).toBe(true)
      })

      it('should send the false value when disabling', async () => {
        vi.mocked(apiClient.patch).mockResolvedValue({
          data: { success: true, data: { showPrimaryTeeth: false } },
        })

        const result = await updateShowPrimaryTeeth('patient-123', false)

        expect(apiClient.patch).toHaveBeenCalledWith(
          '/patients/patient-123/show-primary-teeth',
          { showPrimaryTeeth: false }
        )
        expect(result).toBe(false)
      })

      it('should propagate network errors', async () => {
        vi.mocked(apiClient.patch).mockRejectedValue(new Error('Network error'))

        await expect(updateShowPrimaryTeeth('patient-123', true)).rejects.toThrow('Network error')
      })
    })

    describe('updateToothNote (deprecated)', () => {
      it('should update a single tooth note with healthy status', async () => {
        vi.mocked(apiClient.patch).mockResolvedValue({
          data: { success: true, data: mockPatient },
        })

        const result = await updateToothNote('patient-123', '11', 'new note')

        expect(apiClient.patch).toHaveBeenCalledWith('/patients/patient-123/teeth', {
          '11': { note: 'new note', status: 'healthy' },
        })
        expect(result).toEqual(mockPatient)
      })
    })

    describe('deleteToothNote (deprecated)', () => {
      it('should delete a tooth note', async () => {
        vi.mocked(apiClient.patch).mockResolvedValue({
          data: { success: true, data: mockPatient },
        })

        const result = await deleteToothNote('patient-123', '11')

        expect(apiClient.patch).toHaveBeenCalledWith('/patients/patient-123/teeth', {
          '11': { note: '', status: 'healthy' },
        })
        expect(result).toEqual(mockPatient)
      })
    })
  })

  describe('Utility Functions', () => {
    describe('calculateAge', () => {
      it('should calculate age correctly', () => {
        const today = new Date()
        const birthYear = today.getFullYear() - 30
        const dob = `${birthYear}-01-01`

        const age = calculateAge(dob)

        expect(age).toBeGreaterThanOrEqual(29)
        expect(age).toBeLessThanOrEqual(30)
      })

      it('should return null for null dob', () => {
        expect(calculateAge(null)).toBeNull()
      })

      it('should return null for invalid date', () => {
        expect(calculateAge('invalid-date')).toBeNull()
      })

      it('should return null for future date', () => {
        const futureDate = new Date()
        futureDate.setFullYear(futureDate.getFullYear() + 1)
        expect(calculateAge(futureDate.toISOString().split('T')[0])).toBeNull()
      })

      it('should handle birthday not yet occurred this year', () => {
        const today = new Date()
        const birthYear = today.getFullYear() - 25
        // Use December 31 as birthday - will almost always be in the future
        const dob = `${birthYear}-12-31`

        const age = calculateAge(dob)

        // If today is Dec 31, age is 25; otherwise 24 (birthday hasn't occurred)
        const isDecember31 = today.getMonth() === 11 && today.getDate() === 31
        expect(age).toBe(isDecember31 ? 25 : 24)
      })
    })

    describe('getPatientFullName', () => {
      it('should return full name', () => {
        const result = getPatientFullName({ firstName: 'John', lastName: 'Doe' })
        expect(result).toBe('John Doe')
      })
    })

    describe('getPatientInitials', () => {
      it('should return uppercase initials', () => {
        const result = getPatientInitials({ firstName: 'john', lastName: 'doe' })
        expect(result).toBe('JD')
      })

      it('should handle already uppercase names', () => {
        const result = getPatientInitials({ firstName: 'JOHN', lastName: 'DOE' })
        expect(result).toBe('JD')
      })
    })
  })

  describe('Error Helpers', () => {
    describe('isPatientApiError', () => {
      it('should return true for valid API error', () => {
        const error = {
          response: {
            data: {
              success: false,
              error: { message: 'Error message' },
            },
          },
        }

        expect(isPatientApiError(error)).toBe(true)
      })

      it('should return false for non-API error', () => {
        expect(isPatientApiError(new Error('Regular error'))).toBe(false)
      })

      it('should return false for null', () => {
        expect(isPatientApiError(null)).toBe(false)
      })

      it('should return false for undefined', () => {
        expect(isPatientApiError(undefined)).toBe(false)
      })

      it('should return false for object without response', () => {
        expect(isPatientApiError({ data: 'something' })).toBe(false)
      })
    })

    describe('getPatientApiErrorMessage', () => {
      it('should extract message from API error', () => {
        const error = {
          response: {
            data: {
              success: false,
              error: { message: 'Patient not found' },
            },
          },
        }

        expect(getPatientApiErrorMessage(error)).toBe('Patient not found')
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

        expect(getPatientApiErrorMessage(error)).toBe('An unexpected error occurred')
      })

      it('should return Error message for regular Error', () => {
        const error = new Error('Something went wrong')
        expect(getPatientApiErrorMessage(error)).toBe('Something went wrong')
      })

      it('should return default message for unknown error', () => {
        expect(getPatientApiErrorMessage('string error')).toBe('An unexpected error occurred')
        expect(getPatientApiErrorMessage(123)).toBe('An unexpected error occurred')
        expect(getPatientApiErrorMessage(null)).toBe('An unexpected error occurred')
      })
    })
  })
})
