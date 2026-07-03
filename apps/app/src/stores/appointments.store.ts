import { create } from 'zustand'
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
  getAppointmentApiErrorMessage,
  type Appointment,
  type AppointmentStats,
  type AppointmentStatus,
  type CreateAppointmentData,
  type UpdateAppointmentData,
  type ListAppointmentsParams,
  type CalendarParams,
  type StatsParams,
} from '@/lib/appointment-api'

// ============================================================================
// Types
// ============================================================================

export interface AppointmentsState {
  appointments: Appointment[]
  calendarAppointments: Appointment[]
  selectedAppointment: Appointment | null
  stats: AppointmentStats | null
  isLoading: boolean
  error: string | null

  // Filters
  selectedDoctorId: string | null
  selectedPatientId: string | null
  selectedStatus: AppointmentStatus | null
  dateRange: { from: string; to: string } | null
  showInactive: boolean

  // Calendar view
  currentDate: Date
  viewMode: 'month' | 'week' | 'day'
}

export interface AppointmentsActions {
  // Fetch actions
  fetchAppointments: (params?: ListAppointmentsParams) => Promise<void>
  fetchCalendarAppointments: (params: CalendarParams) => Promise<void>
  fetchAppointmentById: (id: string) => Promise<Appointment | null>
  fetchStats: (params?: StatsParams) => Promise<void>

  // CRUD actions
  addAppointment: (data: CreateAppointmentData) => Promise<Appointment>
  editAppointment: (id: string, data: UpdateAppointmentData) => Promise<Appointment>
  removeAppointment: (id: string) => Promise<void>
  restoreDeletedAppointment: (id: string) => Promise<Appointment>
  completeAppointment: (id: string, notes?: string, executedBudgetItemIds?: string[]) => Promise<Appointment>

  // UI state actions
  setSelectedAppointment: (appointment: Appointment | null) => void
  setSelectedDoctorId: (doctorId: string | null) => void
  setSelectedPatientId: (patientId: string | null) => void
  setSelectedStatus: (status: AppointmentStatus | null) => void
  setDateRange: (range: { from: string; to: string } | null) => void
  setShowInactive: (show: boolean) => void
  setCurrentDate: (date: Date) => void
  setViewMode: (mode: 'month' | 'week' | 'day') => void
  clearError: () => void
  reset: () => void
}

// ============================================================================
// Initial State
// ============================================================================

const initialState: AppointmentsState = {
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
  currentDate: new Date(),
  viewMode: 'month',
}

// ============================================================================
// Store
// ============================================================================

export const useAppointmentsStore = create<AppointmentsState & AppointmentsActions>()((set, get) => ({
  ...initialState,

  // --------------------------------------------------------------------------
  // Fetch Actions
  // --------------------------------------------------------------------------

  fetchAppointments: async (params?: ListAppointmentsParams) => {
    set({ isLoading: true, error: null })
    try {
      const { selectedDoctorId, selectedPatientId, selectedStatus, dateRange, showInactive } = get()
      const appointments = await getAppointments({
        ...params,
        doctorId: params?.doctorId ?? selectedDoctorId ?? undefined,
        patientId: params?.patientId ?? selectedPatientId ?? undefined,
        status: params?.status ?? selectedStatus ?? undefined,
        from: params?.from ?? dateRange?.from,
        to: params?.to ?? dateRange?.to,
        includeInactive: params?.includeInactive ?? showInactive,
      })
      set({ appointments, isLoading: false })
    } catch (error) {
      set({ error: getAppointmentApiErrorMessage(error), isLoading: false })
    }
  },

  fetchCalendarAppointments: async (params: CalendarParams) => {
    set({ isLoading: true, error: null })
    try {
      const { selectedDoctorId, selectedPatientId } = get()
      const calendarAppointments = await getCalendarAppointments({
        ...params,
        doctorId: params.doctorId ?? selectedDoctorId ?? undefined,
        patientId: params.patientId ?? selectedPatientId ?? undefined,
      })
      set({ calendarAppointments, isLoading: false })
    } catch (error) {
      set({ error: getAppointmentApiErrorMessage(error), isLoading: false })
    }
  },

  fetchAppointmentById: async (id: string) => {
    set({ isLoading: true, error: null })
    try {
      const appointment = await getAppointmentById(id)
      set({ selectedAppointment: appointment, isLoading: false })
      return appointment
    } catch (error) {
      set({ error: getAppointmentApiErrorMessage(error), isLoading: false })
      return null
    }
  },

  fetchStats: async (params?: StatsParams) => {
    try {
      const { selectedDoctorId, dateRange } = get()
      const stats = await getAppointmentStats({
        ...params,
        doctorId: params?.doctorId ?? selectedDoctorId ?? undefined,
        from: params?.from ?? dateRange?.from,
        to: params?.to ?? dateRange?.to,
      })
      set({ stats })
    } catch (error) {
      console.warn('Failed to fetch appointment stats:', getAppointmentApiErrorMessage(error))
    }
  },

  // --------------------------------------------------------------------------
  // CRUD Actions
  // --------------------------------------------------------------------------

  addAppointment: async (data: CreateAppointmentData) => {
    set({ isLoading: true, error: null })
    try {
      const newAppointment = await createAppointment(data)
      if (data.isPaid && data.cost && Number(data.cost) > 0) {
        // Auto-payment triggers FIFO recalculation on all patient appointments;
        // refetch the full list so isPaid changes are reflected in the UI
        set({ isLoading: false })
        await get().fetchAppointments()
      } else {
        set((state) => ({
          appointments: [...state.appointments, newAppointment],
          calendarAppointments: [...state.calendarAppointments, newAppointment],
          isLoading: false,
        }))
      }
      get().fetchStats()
      return newAppointment
    } catch (error) {
      const message = getAppointmentApiErrorMessage(error)
      set({ error: message, isLoading: false })
      throw new Error(message)
    }
  },

  editAppointment: async (id: string, data: UpdateAppointmentData) => {
    set({ isLoading: true, error: null })
    try {
      const updatedAppointment = await updateAppointment(id, data)
      set((state) => ({
        appointments: state.appointments.map((a) => (a.id === id ? updatedAppointment : a)),
        calendarAppointments: state.calendarAppointments.map((a) => (a.id === id ? updatedAppointment : a)),
        selectedAppointment: state.selectedAppointment?.id === id ? updatedAppointment : state.selectedAppointment,
        isLoading: false,
      }))
      get().fetchStats()
      return updatedAppointment
    } catch (error) {
      const message = getAppointmentApiErrorMessage(error)
      set({ error: message, isLoading: false })
      throw new Error(message)
    }
  },

  removeAppointment: async (id: string) => {
    set({ isLoading: true, error: null })
    try {
      await deleteAppointment(id)
      set((state) => ({
        appointments: state.showInactive
          ? state.appointments.map((a) => (a.id === id ? { ...a, isActive: false, status: 'CANCELLED' as AppointmentStatus } : a))
          : state.appointments.filter((a) => a.id !== id),
        calendarAppointments: state.calendarAppointments.filter((a) => a.id !== id),
        selectedAppointment: state.selectedAppointment?.id === id ? null : state.selectedAppointment,
        isLoading: false,
      }))
      get().fetchStats()
    } catch (error) {
      const message = getAppointmentApiErrorMessage(error)
      set({ error: message, isLoading: false })
      throw new Error(message)
    }
  },

  restoreDeletedAppointment: async (id: string) => {
    set({ isLoading: true, error: null })
    try {
      const restoredAppointment = await restoreAppointment(id)
      set((state) => ({
        appointments: state.appointments.map((a) => (a.id === id ? restoredAppointment : a)),
        calendarAppointments: [...state.calendarAppointments, restoredAppointment],
        isLoading: false,
      }))
      get().fetchStats()
      return restoredAppointment
    } catch (error) {
      const message = getAppointmentApiErrorMessage(error)
      set({ error: message, isLoading: false })
      throw new Error(message)
    }
  },

  completeAppointment: async (id: string, notes?: string, executedBudgetItemIds?: string[]) => {
    set({ isLoading: true, error: null })
    try {
      const completedAppointment = await markAppointmentDone(id, notes, executedBudgetItemIds)
      set((state) => ({
        appointments: state.appointments.map((a) => (a.id === id ? completedAppointment : a)),
        calendarAppointments: state.calendarAppointments.map((a) => (a.id === id ? completedAppointment : a)),
        selectedAppointment: state.selectedAppointment?.id === id ? completedAppointment : state.selectedAppointment,
        isLoading: false,
      }))
      get().fetchStats()
      return completedAppointment
    } catch (error) {
      const message = getAppointmentApiErrorMessage(error)
      set({ error: message, isLoading: false })
      throw new Error(message)
    }
  },

  // --------------------------------------------------------------------------
  // UI State Actions
  // --------------------------------------------------------------------------

  setSelectedAppointment: (appointment) => {
    set({ selectedAppointment: appointment })
  },

  setSelectedDoctorId: (doctorId) => {
    set({ selectedDoctorId: doctorId })
  },

  setSelectedPatientId: (patientId) => {
    set({ selectedPatientId: patientId })
  },

  setSelectedStatus: (status) => {
    set({ selectedStatus: status })
  },

  setDateRange: (range) => {
    set({ dateRange: range })
  },

  setShowInactive: (show) => {
    set({ showInactive: show })
  },

  setCurrentDate: (date) => {
    set({ currentDate: date })
  },

  setViewMode: (mode) => {
    set({ viewMode: mode })
  },

  clearError: () => {
    set({ error: null })
  },

  reset: () => {
    set(initialState)
  },
}))
