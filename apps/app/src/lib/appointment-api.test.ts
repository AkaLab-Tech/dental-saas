import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  getAppointments,
  getCalendarAppointments,
  getAppointmentById,
  getAppointmentsByDoctor,
  getAppointmentsByPatient,
  getAppointmentStats,
  createAppointment,
  updateAppointment,
  deleteAppointment,
  restoreAppointment,
  markAppointmentDone,
  getStatusLabel,
  getStatusColor,
  getStatusBadgeClasses,
  formatTimeRange,
  formatAppointmentDate,
  isAppointmentPast,
  isAppointmentToday,
  getAppointmentPatientName,
  getAppointmentDoctorName,
  formatCost,
  isAppointmentApiError,
  getAppointmentApiErrorMessage,
  getAppointmentBudgetItems,
  type Appointment,
  type AppointmentStats,
  type AppointmentStatus,
  type AppointmentBudgetItemSummary,
} from './appointment-api'
import { apiClient } from './api'

vi.mock('./api', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}))

vi.mock('@/i18n', () => ({
  default: {
    t: (key: string) => key,
    language: 'es',
  },
}))

const mockAppointment: Appointment = {
  id: 'apt-123',
  tenantId: 'tenant-456',
  patientId: 'patient-789',
  doctorId: 'doctor-012',
  startTime: '2024-01-20T10:00:00Z',
  endTime: '2024-01-20T10:30:00Z',
  duration: 30,
  status: 'SCHEDULED',
  type: 'checkup',
  notes: 'Regular checkup',
  privateNotes: 'Patient has anxiety',
  cost: 100,
  isPaid: false,
  isActive: true,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-15T00:00:00Z',
  patient: {
    id: 'patient-789',
    firstName: 'John',
    lastName: 'Doe',
    email: 'john@example.com',
    phone: '+1234567890',
  },
  doctor: {
    id: 'doctor-012',
    firstName: 'Jane',
    lastName: 'Smith',
    specialty: 'General',
    email: 'jane@clinic.com',
  },
}

const mockAppointmentStats: AppointmentStats = {
  total: 100,
  scheduled: 30,
  completed: 50,
  cancelled: 10,
  noShow: 5,
  todayCount: 8,
  weekCount: 25,
  revenue: 5000,
  pendingPayment: 1500,
}

describe('appointment-api', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getAppointments', () => {
    it('should fetch appointments without params', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: { success: true, data: [mockAppointment] },
      })

      const result = await getAppointments()

      expect(apiClient.get).toHaveBeenCalledWith('/appointments')
      expect(result).toEqual([mockAppointment])
    })

    it('should fetch appointments with all params', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: { success: true, data: [mockAppointment] },
      })

      const result = await getAppointments({
        limit: 10,
        offset: 5,
        includeInactive: true,
        doctorId: 'doctor-012',
        patientId: 'patient-789',
        status: 'SCHEDULED',
        from: '2024-01-01',
        to: '2024-01-31',
      })

      expect(apiClient.get).toHaveBeenCalledWith(
        '/appointments?limit=10&offset=5&includeInactive=true&doctorId=doctor-012&patientId=patient-789&status=SCHEDULED&from=2024-01-01&to=2024-01-31'
      )
      expect(result).toEqual([mockAppointment])
    })

    it('should fetch appointments with partial params', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: { success: true, data: [mockAppointment] },
      })

      const result = await getAppointments({ status: 'COMPLETED', limit: 20 })

      expect(apiClient.get).toHaveBeenCalledWith('/appointments?limit=20&status=COMPLETED')
      expect(result).toEqual([mockAppointment])
    })

    it('should handle empty params', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: { success: true, data: [] },
      })

      const result = await getAppointments({})

      expect(apiClient.get).toHaveBeenCalledWith('/appointments')
      expect(result).toEqual([])
    })
  })

  describe('getCalendarAppointments', () => {
    it('should fetch calendar appointments with required params', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: { success: true, data: [mockAppointment] },
      })

      const result = await getCalendarAppointments({
        from: '2024-01-01',
        to: '2024-01-31',
      })

      expect(apiClient.get).toHaveBeenCalledWith(
        '/appointments/calendar?from=2024-01-01&to=2024-01-31'
      )
      expect(result).toEqual([mockAppointment])
    })

    it('should fetch calendar appointments with doctor filter', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: { success: true, data: [mockAppointment] },
      })

      const result = await getCalendarAppointments({
        from: '2024-01-01',
        to: '2024-01-31',
        doctorId: 'doctor-012',
      })

      expect(apiClient.get).toHaveBeenCalledWith(
        '/appointments/calendar?from=2024-01-01&to=2024-01-31&doctorId=doctor-012'
      )
      expect(result).toEqual([mockAppointment])
    })

    it('should fetch calendar appointments with patient filter', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: { success: true, data: [mockAppointment] },
      })

      const result = await getCalendarAppointments({
        from: '2024-01-01',
        to: '2024-01-31',
        patientId: 'patient-789',
      })

      expect(apiClient.get).toHaveBeenCalledWith(
        '/appointments/calendar?from=2024-01-01&to=2024-01-31&patientId=patient-789'
      )
      expect(result).toEqual([mockAppointment])
    })
  })

  describe('getAppointmentById', () => {
    it('should fetch a single appointment', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: { success: true, data: mockAppointment },
      })

      const result = await getAppointmentById('apt-123')

      expect(apiClient.get).toHaveBeenCalledWith('/appointments/apt-123')
      expect(result).toEqual(mockAppointment)
    })

    it('should throw error on not found', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(new Error('Appointment not found'))

      await expect(getAppointmentById('invalid-id')).rejects.toThrow('Appointment not found')
    })
  })

  describe('getAppointmentsByDoctor', () => {
    it('should fetch appointments by doctor without params', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: { success: true, data: [mockAppointment] },
      })

      const result = await getAppointmentsByDoctor('doctor-012')

      expect(apiClient.get).toHaveBeenCalledWith('/appointments/by-doctor/doctor-012')
      expect(result).toEqual([mockAppointment])
    })

    it('should fetch appointments by doctor with date range', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: { success: true, data: [mockAppointment] },
      })

      const result = await getAppointmentsByDoctor('doctor-012', {
        from: '2024-01-01',
        to: '2024-01-31',
        limit: 10,
      })

      expect(apiClient.get).toHaveBeenCalledWith(
        '/appointments/by-doctor/doctor-012?from=2024-01-01&to=2024-01-31&limit=10'
      )
      expect(result).toEqual([mockAppointment])
    })

    it('should fetch appointments by doctor with partial params', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: { success: true, data: [mockAppointment] },
      })

      const result = await getAppointmentsByDoctor('doctor-012', { limit: 5 })

      expect(apiClient.get).toHaveBeenCalledWith('/appointments/by-doctor/doctor-012?limit=5')
      expect(result).toEqual([mockAppointment])
    })
  })

  describe('getAppointmentsByPatient', () => {
    it('should fetch appointments by patient without params', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: { success: true, data: [mockAppointment] },
      })

      const result = await getAppointmentsByPatient('patient-789')

      expect(apiClient.get).toHaveBeenCalledWith('/appointments/by-patient/patient-789')
      expect(result).toEqual([mockAppointment])
    })

    it('should fetch appointments by patient with params', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: { success: true, data: [mockAppointment] },
      })

      const result = await getAppointmentsByPatient('patient-789', {
        limit: 10,
        includeInactive: true,
      })

      expect(apiClient.get).toHaveBeenCalledWith(
        '/appointments/by-patient/patient-789?limit=10&includeInactive=true'
      )
      expect(result).toEqual([mockAppointment])
    })
  })

  describe('getAppointmentStats', () => {
    it('should fetch stats without params', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: { success: true, data: mockAppointmentStats },
      })

      const result = await getAppointmentStats()

      expect(apiClient.get).toHaveBeenCalledWith('/appointments/stats')
      expect(result).toEqual(mockAppointmentStats)
    })

    it('should fetch stats with all params', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: { success: true, data: mockAppointmentStats },
      })

      const result = await getAppointmentStats({
        from: '2024-01-01',
        to: '2024-01-31',
        doctorId: 'doctor-012',
      })

      expect(apiClient.get).toHaveBeenCalledWith(
        '/appointments/stats?from=2024-01-01&to=2024-01-31&doctorId=doctor-012'
      )
      expect(result).toEqual(mockAppointmentStats)
    })
  })

  describe('createAppointment', () => {
    it('should create a new appointment', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: { success: true, data: mockAppointment },
      })

      const createData = {
        patientId: 'patient-789',
        doctorId: 'doctor-012',
        startTime: '2024-01-20T10:00:00Z',
        endTime: '2024-01-20T10:30:00Z',
        type: 'checkup',
        notes: 'Regular checkup',
      }

      const result = await createAppointment(createData)

      expect(apiClient.post).toHaveBeenCalledWith('/appointments', createData)
      expect(result).toEqual(mockAppointment)
    })

    it('should create appointment with minimal data', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: { success: true, data: mockAppointment },
      })

      const createData = {
        patientId: 'patient-789',
        doctorId: 'doctor-012',
        startTime: '2024-01-20T10:00:00Z',
        endTime: '2024-01-20T10:30:00Z',
      }

      const result = await createAppointment(createData)

      expect(apiClient.post).toHaveBeenCalledWith('/appointments', createData)
      expect(result).toEqual(mockAppointment)
    })

    it('should throw error on creation failure', async () => {
      vi.mocked(apiClient.post).mockRejectedValue(new Error('Time conflict'))

      await expect(
        createAppointment({
          patientId: 'patient-789',
          doctorId: 'doctor-012',
          startTime: '2024-01-20T10:00:00Z',
          endTime: '2024-01-20T10:30:00Z',
        })
      ).rejects.toThrow('Time conflict')
    })

    it('should pass budgetItemIds through to the request body', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: { success: true, data: mockAppointment },
      })

      const createData = {
        patientId: 'patient-789',
        doctorId: 'doctor-012',
        startTime: '2024-01-20T10:00:00Z',
        endTime: '2024-01-20T10:30:00Z',
        budgetItemIds: ['item-1', 'item-2'],
      }

      await createAppointment(createData)

      expect(apiClient.post).toHaveBeenCalledWith('/appointments', createData)
    })
  })

  describe('updateAppointment', () => {
    it('should update an appointment', async () => {
      const updatedAppointment = { ...mockAppointment, status: 'CONFIRMED' as AppointmentStatus }
      vi.mocked(apiClient.put).mockResolvedValue({
        data: { success: true, data: updatedAppointment },
      })

      const result = await updateAppointment('apt-123', { status: 'CONFIRMED' })

      expect(apiClient.put).toHaveBeenCalledWith('/appointments/apt-123', { status: 'CONFIRMED' })
      expect(result.status).toBe('CONFIRMED')
    })

    it('should update multiple fields', async () => {
      const updatedAppointment = { ...mockAppointment, cost: 150, isPaid: true }
      vi.mocked(apiClient.put).mockResolvedValue({
        data: { success: true, data: updatedAppointment },
      })

      const result = await updateAppointment('apt-123', { cost: 150, isPaid: true })

      expect(apiClient.put).toHaveBeenCalledWith('/appointments/apt-123', { cost: 150, isPaid: true })
      expect(result).toEqual(updatedAppointment)
    })

    it('should throw error on update failure', async () => {
      vi.mocked(apiClient.put).mockRejectedValue(new Error('Update failed'))

      await expect(updateAppointment('apt-123', { status: 'CONFIRMED' })).rejects.toThrow(
        'Update failed'
      )
    })

    it('should send an empty budgetItemIds array to clear associations', async () => {
      vi.mocked(apiClient.put).mockResolvedValue({
        data: { success: true, data: mockAppointment },
      })

      await updateAppointment('apt-123', { budgetItemIds: [] })

      expect(apiClient.put).toHaveBeenCalledWith('/appointments/apt-123', { budgetItemIds: [] })
    })
  })

  describe('deleteAppointment', () => {
    it('should delete an appointment', async () => {
      vi.mocked(apiClient.delete).mockResolvedValue({ data: {} })

      await deleteAppointment('apt-123')

      expect(apiClient.delete).toHaveBeenCalledWith('/appointments/apt-123')
    })

    it('should throw error on delete failure', async () => {
      vi.mocked(apiClient.delete).mockRejectedValue(new Error('Cannot delete'))

      await expect(deleteAppointment('apt-123')).rejects.toThrow('Cannot delete')
    })
  })

  describe('restoreAppointment', () => {
    it('should restore a deleted appointment', async () => {
      vi.mocked(apiClient.put).mockResolvedValue({
        data: { success: true, data: mockAppointment },
      })

      const result = await restoreAppointment('apt-123')

      expect(apiClient.put).toHaveBeenCalledWith('/appointments/apt-123/restore')
      expect(result).toEqual(mockAppointment)
    })

    it('should throw error on restore failure', async () => {
      vi.mocked(apiClient.put).mockRejectedValue(new Error('Appointment not found'))

      await expect(restoreAppointment('invalid-id')).rejects.toThrow('Appointment not found')
    })
  })

  describe('markAppointmentDone', () => {
    it('should mark appointment as done without notes', async () => {
      const completedAppointment = { ...mockAppointment, status: 'COMPLETED' as AppointmentStatus }
      vi.mocked(apiClient.put).mockResolvedValue({
        data: { success: true, data: completedAppointment },
      })

      const result = await markAppointmentDone('apt-123')

      expect(apiClient.put).toHaveBeenCalledWith('/appointments/apt-123/mark-done', {
        notes: undefined,
      })
      expect(result.status).toBe('COMPLETED')
    })

    it('should mark appointment as done with notes', async () => {
      const completedAppointment = {
        ...mockAppointment,
        status: 'COMPLETED' as AppointmentStatus,
        notes: 'Procedure completed successfully',
      }
      vi.mocked(apiClient.put).mockResolvedValue({
        data: { success: true, data: completedAppointment },
      })

      const result = await markAppointmentDone('apt-123', 'Procedure completed successfully')

      expect(apiClient.put).toHaveBeenCalledWith('/appointments/apt-123/mark-done', {
        notes: 'Procedure completed successfully',
      })
      expect(result.notes).toBe('Procedure completed successfully')
    })

    it('should send executedBudgetItemIds alongside notes', async () => {
      const completedAppointment = { ...mockAppointment, status: 'COMPLETED' as AppointmentStatus }
      vi.mocked(apiClient.put).mockResolvedValue({
        data: { success: true, data: completedAppointment },
      })

      const result = await markAppointmentDone('apt-123', 'Done', ['item-1', 'item-2'])

      expect(apiClient.put).toHaveBeenCalledWith('/appointments/apt-123/mark-done', {
        notes: 'Done',
        executedBudgetItemIds: ['item-1', 'item-2'],
      })
      expect(result.status).toBe('COMPLETED')
    })

    it('should send an empty executedBudgetItemIds array as-is (no items executed)', async () => {
      const completedAppointment = { ...mockAppointment, status: 'COMPLETED' as AppointmentStatus }
      vi.mocked(apiClient.put).mockResolvedValue({
        data: { success: true, data: completedAppointment },
      })

      await markAppointmentDone('apt-123', undefined, [])

      expect(apiClient.put).toHaveBeenCalledWith('/appointments/apt-123/mark-done', {
        notes: undefined,
        executedBudgetItemIds: [],
      })
    })
  })

  describe('getAppointmentBudgetItems', () => {
    const mockBudgetItems: AppointmentBudgetItemSummary[] = [
      {
        id: 'item-1',
        budgetId: 'budget-1',
        description: 'Cleaning',
        toothNumber: null,
        quantity: 1,
        unitPrice: '80',
        totalPrice: '80',
        plannedAppointmentType: null,
        status: 'SCHEDULED',
        notes: null,
        order: 0,
        roles: ['SCHEDULED'],
      },
      {
        id: 'item-2',
        budgetId: 'budget-1',
        description: 'Filling',
        toothNumber: '14',
        quantity: 1,
        unitPrice: '120',
        totalPrice: '120',
        plannedAppointmentType: null,
        status: 'EXECUTED',
        notes: null,
        order: 1,
        roles: ['SCHEDULED', 'EXECUTED'],
      },
    ]

    it('should fetch the budget items associated to an appointment', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: { success: true, data: mockBudgetItems },
      })

      const result = await getAppointmentBudgetItems('apt-123')

      expect(apiClient.get).toHaveBeenCalledWith('/appointments/apt-123/budget-items')
      expect(result).toEqual(mockBudgetItems)
    })

    it('should return an empty array when no items are associated', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: { success: true, data: [] },
      })

      const result = await getAppointmentBudgetItems('apt-456')

      expect(result).toEqual([])
    })

    it('should throw error on fetch failure', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(new Error('Not found'))

      await expect(getAppointmentBudgetItems('apt-999')).rejects.toThrow('Not found')
    })
  })

  describe('Helper Functions', () => {
    describe('getStatusLabel', () => {
      it('should return correct label for each status', () => {
        expect(getStatusLabel('SCHEDULED')).toBe('Programada')
        expect(getStatusLabel('CONFIRMED')).toBe('Confirmada')
        expect(getStatusLabel('IN_PROGRESS')).toBe('En Progreso')
        expect(getStatusLabel('COMPLETED')).toBe('Completada')
        expect(getStatusLabel('CANCELLED')).toBe('Cancelada')
        expect(getStatusLabel('NO_SHOW')).toBe('No Asistió')
        expect(getStatusLabel('RESCHEDULED')).toBe('Reprogramada')
      })

      it('should return status as fallback for unknown status', () => {
        expect(getStatusLabel('UNKNOWN' as AppointmentStatus)).toBe('UNKNOWN')
      })
    })

    describe('getStatusColor', () => {
      it('should return correct color for each status', () => {
        expect(getStatusColor('SCHEDULED')).toBe('blue')
        expect(getStatusColor('CONFIRMED')).toBe('green')
        expect(getStatusColor('IN_PROGRESS')).toBe('yellow')
        expect(getStatusColor('COMPLETED')).toBe('emerald')
        expect(getStatusColor('CANCELLED')).toBe('red')
        expect(getStatusColor('NO_SHOW')).toBe('gray')
        expect(getStatusColor('RESCHEDULED')).toBe('purple')
      })

      it('should return gray as fallback for unknown status', () => {
        expect(getStatusColor('UNKNOWN' as AppointmentStatus)).toBe('gray')
      })
    })

    describe('getStatusBadgeClasses', () => {
      it('should return correct classes for each status', () => {
        expect(getStatusBadgeClasses('SCHEDULED')).toBe('bg-blue-100 text-blue-800')
        expect(getStatusBadgeClasses('CONFIRMED')).toBe('bg-green-100 text-green-800')
        expect(getStatusBadgeClasses('IN_PROGRESS')).toBe('bg-yellow-100 text-yellow-800')
        expect(getStatusBadgeClasses('COMPLETED')).toBe('bg-emerald-100 text-emerald-800')
        expect(getStatusBadgeClasses('CANCELLED')).toBe('bg-red-100 text-red-800')
        expect(getStatusBadgeClasses('NO_SHOW')).toBe('bg-gray-100 text-gray-800')
        expect(getStatusBadgeClasses('RESCHEDULED')).toBe('bg-purple-100 text-purple-800')
      })

      it('should return gray classes as fallback for unknown status', () => {
        expect(getStatusBadgeClasses('UNKNOWN' as AppointmentStatus)).toBe('bg-gray-100 text-gray-800')
      })
    })

    describe('formatTimeRange', () => {
      it('should format time range correctly', () => {
        const result = formatTimeRange('2024-01-20T10:00:00Z', '2024-01-20T10:30:00Z')
        expect(result).toMatch(/\d{1,2}:\d{2}.*-.*\d{1,2}:\d{2}/)
      })
    })

    describe('formatAppointmentDate', () => {
      it('should format date correctly', () => {
        const result = formatAppointmentDate('2024-01-20T10:00:00Z')
        expect(result).toMatch(/\w+.*\d+.*2024/)
      })
    })

    describe('isAppointmentPast', () => {
      it('should return true for past appointments', () => {
        const pastDate = new Date()
        pastDate.setFullYear(pastDate.getFullYear() - 1)
        expect(isAppointmentPast(pastDate.toISOString())).toBe(true)
      })

      it('should return false for future appointments', () => {
        const futureDate = new Date()
        futureDate.setFullYear(futureDate.getFullYear() + 1)
        expect(isAppointmentPast(futureDate.toISOString())).toBe(false)
      })
    })

    describe('isAppointmentToday', () => {
      it('should return true for today appointments', () => {
        const today = new Date()
        expect(isAppointmentToday(today.toISOString())).toBe(true)
      })

      it('should return false for yesterday appointments', () => {
        const yesterday = new Date()
        yesterday.setDate(yesterday.getDate() - 1)
        expect(isAppointmentToday(yesterday.toISOString())).toBe(false)
      })

      it('should return false for tomorrow appointments', () => {
        const tomorrow = new Date()
        tomorrow.setDate(tomorrow.getDate() + 1)
        expect(isAppointmentToday(tomorrow.toISOString())).toBe(false)
      })
    })

    describe('getAppointmentPatientName', () => {
      it('should return full patient name', () => {
        expect(getAppointmentPatientName(mockAppointment)).toBe('John Doe')
      })

      it('should return Unknown Patient when patient is missing', () => {
        const appointmentWithoutPatient = { ...mockAppointment, patient: undefined }
        expect(getAppointmentPatientName(appointmentWithoutPatient)).toBe('Unknown Patient')
      })
    })

    describe('getAppointmentDoctorName', () => {
      it('should return full doctor name', () => {
        expect(getAppointmentDoctorName(mockAppointment)).toBe('Jane Smith')
      })

      it('should return Unknown Doctor when doctor is missing', () => {
        const appointmentWithoutDoctor = { ...mockAppointment, doctor: undefined }
        expect(getAppointmentDoctorName(appointmentWithoutDoctor)).toBe('Unknown Doctor')
      })
    })

    describe('formatCost', () => {
      it('should format cost as currency', () => {
        const result = formatCost(100)
        expect(result).toMatch(/100/)
      })

      it('should return dash for null cost', () => {
        expect(formatCost(null)).toBe('-')
      })

      it('should use custom currency', () => {
        const result = formatCost(100, 'EUR')
        expect(result).toMatch(/100/)
      })

      it('should format zero cost', () => {
        const result = formatCost(0)
        expect(result).toMatch(/0/)
      })
    })
  })

  describe('Error Helpers', () => {
    describe('isAppointmentApiError', () => {
      it('should return true for valid API error', () => {
        const error = {
          response: {
            data: {
              success: false,
              error: { message: 'Error message' },
            },
          },
        }

        expect(isAppointmentApiError(error)).toBe(true)
      })

      it('should return false for non-API error', () => {
        expect(isAppointmentApiError(new Error('Regular error'))).toBe(false)
      })

      it('should return false for null', () => {
        expect(isAppointmentApiError(null)).toBe(false)
      })

      it('should return false for undefined', () => {
        expect(isAppointmentApiError(undefined)).toBe(false)
      })

      it('should return false for object without response', () => {
        expect(isAppointmentApiError({ data: 'something' })).toBe(false)
      })
    })

    describe('getAppointmentApiErrorMessage', () => {
      it('should extract message from API error', () => {
        const error = {
          response: {
            data: {
              success: false,
              error: { message: 'Appointment not found' },
            },
          },
        }

        expect(getAppointmentApiErrorMessage(error)).toBe('Appointment not found')
      })

      it('should return i18n message for TIME_CONFLICT code', () => {
        const error = {
          response: {
            data: {
              success: false,
              error: { code: 'TIME_CONFLICT', message: 'Generic message' },
            },
          },
        }

        expect(getAppointmentApiErrorMessage(error)).toBe('appointments.errors.timeConflict')
      })

      it('should return i18n message for INVALID_PATIENT code', () => {
        const error = {
          response: {
            data: {
              success: false,
              error: { code: 'INVALID_PATIENT', message: 'Generic message' },
            },
          },
        }

        expect(getAppointmentApiErrorMessage(error)).toBe('appointments.errors.invalidPatient')
      })

      it('should return i18n message for INVALID_DOCTOR code', () => {
        const error = {
          response: {
            data: {
              success: false,
              error: { code: 'INVALID_DOCTOR', message: 'Generic message' },
            },
          },
        }

        expect(getAppointmentApiErrorMessage(error)).toBe('appointments.errors.invalidDoctor')
      })

      it('should return i18n message for INVALID_TIME_RANGE code', () => {
        const error = {
          response: {
            data: {
              success: false,
              error: { code: 'INVALID_TIME_RANGE', message: 'Generic message' },
            },
          },
        }

        expect(getAppointmentApiErrorMessage(error)).toBe('appointments.errors.invalidTimeRange')
      })

      it('should return default i18n message for API error without message', () => {
        const error = {
          response: {
            data: {
              success: false,
              error: {},
            },
          },
        }

        expect(getAppointmentApiErrorMessage(error)).toBe('appointments.errors.unexpected')
      })

      it('should return Error message for regular Error', () => {
        const error = new Error('Something went wrong')
        expect(getAppointmentApiErrorMessage(error)).toBe('Something went wrong')
      })

      it('should return default i18n message for unknown error types', () => {
        expect(getAppointmentApiErrorMessage('string error')).toBe('appointments.errors.unexpected')
        expect(getAppointmentApiErrorMessage(123)).toBe('appointments.errors.unexpected')
        expect(getAppointmentApiErrorMessage(null)).toBe('appointments.errors.unexpected')
      })
    })
  })
})
