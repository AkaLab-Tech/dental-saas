import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'
import { useAppointmentsStore } from './appointments.store'
import type { Appointment, AppointmentStats } from '@/lib/appointment-api'

// Mock the appointment-api module
vi.mock('@/lib/appointment-api', () => ({
  getAppointments: vi.fn(),
  getAppointmentById: vi.fn(),
  getCalendarAppointments: vi.fn(),
  createAppointment: vi.fn(),
  updateAppointment: vi.fn(),
  deleteAppointment: vi.fn(),
  restoreAppointment: vi.fn(),
  markAppointmentDone: vi.fn(),
  getAppointmentStats: vi.fn(),
  getAppointmentApiErrorMessage: vi.fn((error: unknown) => {
    if (error instanceof Error) return error.message
    return 'An unexpected error occurred'
  }),
}))

// Import mocked functions
import {
  getAppointments,
  getAppointmentById,
  getCalendarAppointments,
  createAppointment,
  updateAppointment,
  deleteAppointment,
  restoreAppointment,
  markAppointmentDone,
  getAppointmentStats,
} from '@/lib/appointment-api'

const mockAppointment: Appointment = {
  id: 'appointment-123',
  tenantId: 'tenant-456',
  patientId: 'patient-789',
  doctorId: 'doctor-101',
  startTime: '2024-01-15T10:00:00Z',
  endTime: '2024-01-15T11:00:00Z',
  duration: 60,
  status: 'SCHEDULED',
  type: 'Checkup',
  notes: 'Regular checkup',
  privateNotes: null,
  cost: 100,
  isPaid: false,
  isActive: true,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  patient: {
    id: 'patient-789',
    firstName: 'John',
    lastName: 'Doe',
    email: 'john@example.com',
    phone: '+1234567890',
  },
  doctor: {
    id: 'doctor-101',
    firstName: 'Jane',
    lastName: 'Smith',
    specialty: 'General Dentistry',
    email: 'jane.smith@clinic.com',
  },
}

const mockAppointment2: Appointment = {
  id: 'appointment-456',
  tenantId: 'tenant-456',
  patientId: 'patient-102',
  doctorId: 'doctor-101',
  startTime: '2024-01-15T14:00:00Z',
  endTime: '2024-01-15T15:00:00Z',
  duration: 60,
  status: 'COMPLETED',
  type: 'Cleaning',
  notes: null,
  privateNotes: null,
  cost: 75,
  isPaid: true,
  isActive: true,
  createdAt: '2024-01-02T00:00:00Z',
  updatedAt: '2024-01-02T00:00:00Z',
}

const mockStats: AppointmentStats = {
  total: 50,
  scheduled: 20,
  completed: 25,
  cancelled: 3,
  noShow: 2,
  todayCount: 5,
  weekCount: 15,
  revenue: 5000,
  pendingPayment: 1200,
}

const defaultDate = new Date('2024-01-15T00:00:00Z')

describe('appointments.store', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    useAppointmentsStore.setState({
      appointments: [],
      calendarAppointments: [],
      selectedAppointment: null,
      stats: null,
      isLoading: false,
      error: null,
      selectedDoctorId: null,
      selectedPatientId: null,
      selectedStatus: null,
      dateRange: null,
      showInactive: false,
      currentDate: defaultDate,
      viewMode: 'month',
    })
    vi.clearAllMocks()
  })

  describe('initial state', () => {
    it('should have empty appointments array', () => {
      const state = useAppointmentsStore.getState()
      expect(state.appointments).toEqual([])
    })

    it('should have empty calendarAppointments array', () => {
      const state = useAppointmentsStore.getState()
      expect(state.calendarAppointments).toEqual([])
    })

    it('should have null selectedAppointment', () => {
      const state = useAppointmentsStore.getState()
      expect(state.selectedAppointment).toBeNull()
    })

    it('should have null stats', () => {
      const state = useAppointmentsStore.getState()
      expect(state.stats).toBeNull()
    })

    it('should have all filters as null', () => {
      const state = useAppointmentsStore.getState()
      expect(state.selectedDoctorId).toBeNull()
      expect(state.selectedPatientId).toBeNull()
      expect(state.selectedStatus).toBeNull()
      expect(state.dateRange).toBeNull()
    })

    it('should have month as default view mode', () => {
      const state = useAppointmentsStore.getState()
      expect(state.viewMode).toBe('month')
    })
  })

  describe('fetchAppointments', () => {
    it('should fetch appointments successfully', async () => {
      ;(getAppointments as Mock).mockResolvedValue([mockAppointment, mockAppointment2])

      await useAppointmentsStore.getState().fetchAppointments()

      const state = useAppointmentsStore.getState()
      expect(state.appointments).toEqual([mockAppointment, mockAppointment2])
      expect(state.isLoading).toBe(false)
      expect(state.error).toBeNull()
    })

    it('should use filters from state when no params provided', async () => {
      useAppointmentsStore.setState({
        selectedDoctorId: 'doctor-101',
        selectedPatientId: 'patient-789',
        selectedStatus: 'SCHEDULED',
        dateRange: { from: '2024-01-01', to: '2024-01-31' },
        showInactive: true,
      })
      ;(getAppointments as Mock).mockResolvedValue([mockAppointment])

      await useAppointmentsStore.getState().fetchAppointments()

      expect(getAppointments).toHaveBeenCalledWith({
        doctorId: 'doctor-101',
        patientId: 'patient-789',
        status: 'SCHEDULED',
        from: '2024-01-01',
        to: '2024-01-31',
        includeInactive: true,
      })
    })

    it('should override state with provided params', async () => {
      useAppointmentsStore.setState({
        selectedDoctorId: 'doctor-101',
        selectedStatus: 'SCHEDULED',
      })
      ;(getAppointments as Mock).mockResolvedValue([])

      await useAppointmentsStore.getState().fetchAppointments({
        doctorId: 'doctor-999',
        status: 'COMPLETED',
      })

      expect(getAppointments).toHaveBeenCalledWith(
        expect.objectContaining({
          doctorId: 'doctor-999',
          status: 'COMPLETED',
        })
      )
    })

    it('should handle fetch error', async () => {
      ;(getAppointments as Mock).mockRejectedValue(new Error('Network error'))

      await useAppointmentsStore.getState().fetchAppointments()

      const state = useAppointmentsStore.getState()
      expect(state.error).toBe('Network error')
      expect(state.isLoading).toBe(false)
    })
  })

  describe('fetchCalendarAppointments', () => {
    it('should fetch calendar appointments successfully', async () => {
      ;(getCalendarAppointments as Mock).mockResolvedValue([mockAppointment, mockAppointment2])

      await useAppointmentsStore.getState().fetchCalendarAppointments({
        from: '2024-01-01',
        to: '2024-01-31',
      })

      const state = useAppointmentsStore.getState()
      expect(state.calendarAppointments).toEqual([mockAppointment, mockAppointment2])
      expect(state.isLoading).toBe(false)
    })

    it('should use selectedDoctorId from state', async () => {
      useAppointmentsStore.setState({ selectedDoctorId: 'doctor-101' })
      ;(getCalendarAppointments as Mock).mockResolvedValue([])

      await useAppointmentsStore.getState().fetchCalendarAppointments({
        from: '2024-01-01',
        to: '2024-01-31',
      })

      expect(getCalendarAppointments).toHaveBeenCalledWith({
        from: '2024-01-01',
        to: '2024-01-31',
        doctorId: 'doctor-101',
        patientId: undefined,
      })
    })
  })

  describe('fetchAppointmentById', () => {
    it('should fetch a single appointment and set as selected', async () => {
      ;(getAppointmentById as Mock).mockResolvedValue(mockAppointment)

      const result = await useAppointmentsStore.getState().fetchAppointmentById('appointment-123')

      expect(result).toEqual(mockAppointment)
      expect(useAppointmentsStore.getState().selectedAppointment).toEqual(mockAppointment)
    })

    it('should return null on error', async () => {
      ;(getAppointmentById as Mock).mockRejectedValue(new Error('Not found'))

      const result = await useAppointmentsStore.getState().fetchAppointmentById('invalid-id')

      expect(result).toBeNull()
      expect(useAppointmentsStore.getState().error).toBe('Not found')
    })
  })

  describe('fetchStats', () => {
    it('should fetch stats successfully', async () => {
      ;(getAppointmentStats as Mock).mockResolvedValue(mockStats)

      await useAppointmentsStore.getState().fetchStats()

      expect(useAppointmentsStore.getState().stats).toEqual(mockStats)
    })

    it('should not set error on stats fetch failure', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      ;(getAppointmentStats as Mock).mockRejectedValue(new Error('Stats unavailable'))

      await useAppointmentsStore.getState().fetchStats()

      expect(useAppointmentsStore.getState().error).toBeNull()
      expect(consoleSpy).toHaveBeenCalled()

      consoleSpy.mockRestore()
    })
  })

  describe('addAppointment', () => {
    it('should add appointment to both lists', async () => {
      useAppointmentsStore.setState({
        appointments: [mockAppointment2],
        calendarAppointments: [mockAppointment2],
      })
      ;(createAppointment as Mock).mockResolvedValue(mockAppointment)
      ;(getAppointmentStats as Mock).mockResolvedValue(mockStats)

      const result = await useAppointmentsStore.getState().addAppointment({
        patientId: 'patient-789',
        doctorId: 'doctor-101',
        startTime: '2024-01-15T10:00:00Z',
        endTime: '2024-01-15T11:00:00Z',
      })

      expect(result).toEqual(mockAppointment)
      const state = useAppointmentsStore.getState()
      expect(state.appointments).toHaveLength(2)
      expect(state.calendarAppointments).toHaveLength(2)
    })

    it('should refresh stats after adding', async () => {
      ;(createAppointment as Mock).mockResolvedValue(mockAppointment)
      ;(getAppointmentStats as Mock).mockResolvedValue(mockStats)

      await useAppointmentsStore.getState().addAppointment({
        patientId: 'patient-789',
        doctorId: 'doctor-101',
        startTime: '2024-01-15T10:00:00Z',
        endTime: '2024-01-15T11:00:00Z',
      })

      expect(getAppointmentStats).toHaveBeenCalled()
    })

    it('should throw error on failure', async () => {
      ;(createAppointment as Mock).mockRejectedValue(new Error('Conflict'))

      await expect(
        useAppointmentsStore.getState().addAppointment({
          patientId: 'patient-789',
          doctorId: 'doctor-101',
          startTime: '2024-01-15T10:00:00Z',
          endTime: '2024-01-15T11:00:00Z',
        })
      ).rejects.toThrow('Conflict')
    })
  })

  describe('editAppointment', () => {
    it('should update appointment in both lists', async () => {
      const updatedAppointment = { ...mockAppointment, notes: 'Updated notes' }
      useAppointmentsStore.setState({
        appointments: [mockAppointment],
        calendarAppointments: [mockAppointment],
      })
      ;(updateAppointment as Mock).mockResolvedValue(updatedAppointment)
      ;(getAppointmentStats as Mock).mockResolvedValue(mockStats)

      const result = await useAppointmentsStore
        .getState()
        .editAppointment('appointment-123', { notes: 'Updated notes' })

      expect(result).toEqual(updatedAppointment)
      const state = useAppointmentsStore.getState()
      expect(state.appointments[0].notes).toBe('Updated notes')
      expect(state.calendarAppointments[0].notes).toBe('Updated notes')
    })

    it('should update selectedAppointment if editing the selected one', async () => {
      const updatedAppointment = { ...mockAppointment, notes: 'Updated' }
      useAppointmentsStore.setState({
        appointments: [mockAppointment],
        selectedAppointment: mockAppointment,
      })
      ;(updateAppointment as Mock).mockResolvedValue(updatedAppointment)
      ;(getAppointmentStats as Mock).mockResolvedValue(mockStats)

      await useAppointmentsStore.getState().editAppointment('appointment-123', { notes: 'Updated' })

      expect(useAppointmentsStore.getState().selectedAppointment).toEqual(updatedAppointment)
    })
  })

  describe('removeAppointment', () => {
    it('should remove from both lists when not showing inactive', async () => {
      useAppointmentsStore.setState({
        appointments: [mockAppointment, mockAppointment2],
        calendarAppointments: [mockAppointment, mockAppointment2],
        showInactive: false,
      })
      ;(deleteAppointment as Mock).mockResolvedValue(undefined)
      ;(getAppointmentStats as Mock).mockResolvedValue(mockStats)

      await useAppointmentsStore.getState().removeAppointment('appointment-123')

      const state = useAppointmentsStore.getState()
      expect(state.appointments).toHaveLength(1)
      expect(state.calendarAppointments).toHaveLength(1)
    })

    it('should mark as inactive and cancelled when showing inactive', async () => {
      useAppointmentsStore.setState({
        appointments: [mockAppointment],
        calendarAppointments: [mockAppointment],
        showInactive: true,
      })
      ;(deleteAppointment as Mock).mockResolvedValue(undefined)
      ;(getAppointmentStats as Mock).mockResolvedValue(mockStats)

      await useAppointmentsStore.getState().removeAppointment('appointment-123')

      const state = useAppointmentsStore.getState()
      expect(state.appointments[0].isActive).toBe(false)
      expect(state.appointments[0].status).toBe('CANCELLED')
      // Calendar should still remove it
      expect(state.calendarAppointments).toHaveLength(0)
    })

    it('should clear selectedAppointment if removing the selected one', async () => {
      useAppointmentsStore.setState({
        appointments: [mockAppointment],
        selectedAppointment: mockAppointment,
      })
      ;(deleteAppointment as Mock).mockResolvedValue(undefined)
      ;(getAppointmentStats as Mock).mockResolvedValue(mockStats)

      await useAppointmentsStore.getState().removeAppointment('appointment-123')

      expect(useAppointmentsStore.getState().selectedAppointment).toBeNull()
    })
  })

  describe('restoreDeletedAppointment', () => {
    it('should restore appointment and add to calendar', async () => {
      const inactiveAppointment = { ...mockAppointment, isActive: false, status: 'CANCELLED' as const }
      const restoredAppointment = { ...mockAppointment, isActive: true, status: 'SCHEDULED' as const }
      useAppointmentsStore.setState({
        appointments: [inactiveAppointment],
        calendarAppointments: [],
      })
      ;(restoreAppointment as Mock).mockResolvedValue(restoredAppointment)
      ;(getAppointmentStats as Mock).mockResolvedValue(mockStats)

      const result = await useAppointmentsStore.getState().restoreDeletedAppointment('appointment-123')

      expect(result).toEqual(restoredAppointment)
      const state = useAppointmentsStore.getState()
      expect(state.appointments[0].isActive).toBe(true)
      expect(state.calendarAppointments).toHaveLength(1)
    })
  })

  describe('completeAppointment', () => {
    it('should mark appointment as completed', async () => {
      const completedAppointment = { ...mockAppointment, status: 'COMPLETED' as const }
      useAppointmentsStore.setState({
        appointments: [mockAppointment],
        calendarAppointments: [mockAppointment],
      })
      ;(markAppointmentDone as Mock).mockResolvedValue(completedAppointment)
      ;(getAppointmentStats as Mock).mockResolvedValue(mockStats)

      const result = await useAppointmentsStore.getState().completeAppointment('appointment-123', 'Done')

      expect(result).toEqual(completedAppointment)
      const state = useAppointmentsStore.getState()
      expect(state.appointments[0].status).toBe('COMPLETED')
      expect(state.calendarAppointments[0].status).toBe('COMPLETED')
    })

    it('should update selectedAppointment if completing the selected one', async () => {
      const completedAppointment = { ...mockAppointment, status: 'COMPLETED' as const }
      useAppointmentsStore.setState({
        appointments: [mockAppointment],
        selectedAppointment: mockAppointment,
      })
      ;(markAppointmentDone as Mock).mockResolvedValue(completedAppointment)
      ;(getAppointmentStats as Mock).mockResolvedValue(mockStats)

      await useAppointmentsStore.getState().completeAppointment('appointment-123')

      expect(useAppointmentsStore.getState().selectedAppointment?.status).toBe('COMPLETED')
    })

    it('should thread executedBudgetItemIds through to markAppointmentDone', async () => {
      const completedAppointment = { ...mockAppointment, status: 'COMPLETED' as const }
      useAppointmentsStore.setState({ appointments: [mockAppointment] })
      ;(markAppointmentDone as Mock).mockResolvedValue(completedAppointment)
      ;(getAppointmentStats as Mock).mockResolvedValue(mockStats)

      await useAppointmentsStore
        .getState()
        .completeAppointment('appointment-123', 'Done', ['item-1'])

      expect(markAppointmentDone).toHaveBeenCalledWith('appointment-123', 'Done', ['item-1'])
    })
  })

  describe('UI state actions', () => {
    it('should set selected appointment', () => {
      useAppointmentsStore.getState().setSelectedAppointment(mockAppointment)
      expect(useAppointmentsStore.getState().selectedAppointment).toEqual(mockAppointment)
    })

    it('should set selected doctor ID', () => {
      useAppointmentsStore.getState().setSelectedDoctorId('doctor-123')
      expect(useAppointmentsStore.getState().selectedDoctorId).toBe('doctor-123')
    })

    it('should set selected patient ID', () => {
      useAppointmentsStore.getState().setSelectedPatientId('patient-123')
      expect(useAppointmentsStore.getState().selectedPatientId).toBe('patient-123')
    })

    it('should set selected status', () => {
      useAppointmentsStore.getState().setSelectedStatus('COMPLETED')
      expect(useAppointmentsStore.getState().selectedStatus).toBe('COMPLETED')
    })

    it('should set date range', () => {
      const range = { from: '2024-01-01', to: '2024-01-31' }
      useAppointmentsStore.getState().setDateRange(range)
      expect(useAppointmentsStore.getState().dateRange).toEqual(range)
    })

    it('should set show inactive', () => {
      useAppointmentsStore.getState().setShowInactive(true)
      expect(useAppointmentsStore.getState().showInactive).toBe(true)
    })

    it('should set current date', () => {
      const newDate = new Date('2024-02-01')
      useAppointmentsStore.getState().setCurrentDate(newDate)
      expect(useAppointmentsStore.getState().currentDate).toEqual(newDate)
    })

    it('should set view mode', () => {
      useAppointmentsStore.getState().setViewMode('week')
      expect(useAppointmentsStore.getState().viewMode).toBe('week')
    })
  })

  describe('clearError', () => {
    it('should clear the error', () => {
      useAppointmentsStore.setState({ error: 'Some error' })
      useAppointmentsStore.getState().clearError()
      expect(useAppointmentsStore.getState().error).toBeNull()
    })
  })

  describe('reset', () => {
    it('should reset to initial state', () => {
      useAppointmentsStore.setState({
        appointments: [mockAppointment],
        calendarAppointments: [mockAppointment],
        selectedAppointment: mockAppointment,
        stats: mockStats,
        isLoading: true,
        error: 'Some error',
        selectedDoctorId: 'doctor-123',
        selectedPatientId: 'patient-123',
        selectedStatus: 'COMPLETED',
        dateRange: { from: '2024-01-01', to: '2024-01-31' },
        showInactive: true,
        viewMode: 'week',
      })

      useAppointmentsStore.getState().reset()

      const state = useAppointmentsStore.getState()
      expect(state.appointments).toEqual([])
      expect(state.calendarAppointments).toEqual([])
      expect(state.selectedAppointment).toBeNull()
      expect(state.stats).toBeNull()
      expect(state.isLoading).toBe(false)
      expect(state.error).toBeNull()
      expect(state.selectedDoctorId).toBeNull()
      expect(state.selectedPatientId).toBeNull()
      expect(state.selectedStatus).toBeNull()
      expect(state.dateRange).toBeNull()
      expect(state.showInactive).toBe(false)
      expect(state.viewMode).toBe('month')
    })
  })
})
