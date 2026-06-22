import { create } from 'zustand'
import {
  getOverviewStats,
  getAppointmentStats,
  getRevenueStats,
  getPatientsGrowthStats,
  getDoctorPerformanceStats,
  getMyDoctorId,
  getUpcomingAppointments,
  getAppointmentTypeStats,
  getStatsApiErrorMessage,
  type OverviewStats,
  type AppointmentStats,
  type RevenueStats,
  type PatientsGrowthStats,
  type DoctorPerformanceStats,
  type UpcomingAppointment,
  type AppointmentTypeCount,
} from '@/lib/stats-api'

// ============================================================================
// Types
// ============================================================================

export interface StatsState {
  overview: OverviewStats | null
  appointmentStats: AppointmentStats | null
  revenueStats: RevenueStats | null
  patientsGrowth: PatientsGrowthStats | null
  doctorPerformance: DoctorPerformanceStats[] | null
  upcomingAppointments: UpcomingAppointment[] | null
  appointmentTypes: AppointmentTypeCount[] | null
  myDoctorId: string | null
  isLoading: boolean
  error: string | null
}

export interface StatsActions {
  fetchOverview: () => Promise<void>
  fetchAppointmentStats: (startDate?: string, endDate?: string) => Promise<void>
  fetchRevenueStats: (months?: number) => Promise<void>
  fetchPatientsGrowth: (months?: number) => Promise<void>
  fetchDoctorPerformance: () => Promise<void>
  fetchAllStats: () => Promise<void>
  fetchMyDoctorId: () => Promise<string | null>
  fetchDoctorStats: (doctorId: string) => Promise<void>
  clearError: () => void
  reset: () => void
}

// ============================================================================
// Initial State
// ============================================================================

const initialState: StatsState = {
  overview: null,
  appointmentStats: null,
  revenueStats: null,
  patientsGrowth: null,
  doctorPerformance: null,
  upcomingAppointments: null,
  appointmentTypes: null,
  myDoctorId: null,
  isLoading: false,
  error: null,
}

// ============================================================================
// Store
// ============================================================================

export const useStatsStore = create<StatsState & StatsActions>((set) => ({
  ...initialState,

  fetchOverview: async () => {
    set({ isLoading: true, error: null })
    try {
      const overview = await getOverviewStats()
      set({ overview, isLoading: false })
    } catch (error) {
      set({ error: getStatsApiErrorMessage(error), isLoading: false })
    }
  },

  fetchAppointmentStats: async (startDate?: string, endDate?: string) => {
    set({ isLoading: true, error: null })
    try {
      const appointmentStats = await getAppointmentStats(startDate, endDate)
      set({ appointmentStats, isLoading: false })
    } catch (error) {
      set({ error: getStatsApiErrorMessage(error), isLoading: false })
    }
  },

  fetchRevenueStats: async (months?: number) => {
    set({ isLoading: true, error: null })
    try {
      const revenueStats = await getRevenueStats(months)
      set({ revenueStats, isLoading: false })
    } catch (error) {
      set({ error: getStatsApiErrorMessage(error), isLoading: false })
    }
  },

  fetchPatientsGrowth: async (months?: number) => {
    set({ isLoading: true, error: null })
    try {
      const patientsGrowth = await getPatientsGrowthStats(months)
      set({ patientsGrowth, isLoading: false })
    } catch (error) {
      set({ error: getStatsApiErrorMessage(error), isLoading: false })
    }
  },

  fetchDoctorPerformance: async () => {
    set({ isLoading: true, error: null })
    try {
      const doctorPerformance = await getDoctorPerformanceStats()
      set({ doctorPerformance, isLoading: false })
    } catch (error) {
      // Silently fail for non-admin users (403)
      if (error && typeof error === 'object' && 'response' in error) {
        const axiosError = error as { response?: { status?: number } }
        if (axiosError.response?.status === 403) {
          set({ doctorPerformance: null, isLoading: false })
          return
        }
      }
      set({ error: getStatsApiErrorMessage(error), isLoading: false })
    }
  },

  fetchAllStats: async () => {
    set({ isLoading: true, error: null })
    try {
      const [overview, appointmentStats, revenueStats, patientsGrowth] = await Promise.all([
        getOverviewStats(),
        getAppointmentStats(),
        getRevenueStats(),
        getPatientsGrowthStats(),
      ])

      // Try to fetch doctor performance (may fail for non-admin)
      let doctorPerformance: DoctorPerformanceStats[] | null = null
      try {
        doctorPerformance = await getDoctorPerformanceStats()
      } catch {
        // Silently ignore - user doesn't have permission
      }

      set({
        overview,
        appointmentStats,
        revenueStats,
        patientsGrowth,
        doctorPerformance,
        isLoading: false,
      })
    } catch (error) {
      set({ error: getStatsApiErrorMessage(error), isLoading: false })
    }
  },

  fetchMyDoctorId: async () => {
    try {
      const doctorId = await getMyDoctorId()
      set({ myDoctorId: doctorId })
      return doctorId
    } catch {
      set({ myDoctorId: null })
      return null
    }
  },

  fetchDoctorStats: async (doctorId: string) => {
    set({ isLoading: true, error: null })
    try {
      const [overview, appointmentStats, revenueStats, upcomingAppointments, appointmentTypes] =
        await Promise.all([
          getOverviewStats(doctorId),
          getAppointmentStats(undefined, undefined, doctorId),
          getRevenueStats(undefined, doctorId),
          getUpcomingAppointments(doctorId),
          getAppointmentTypeStats(doctorId),
        ])

      set({
        overview,
        appointmentStats,
        revenueStats,
        upcomingAppointments,
        appointmentTypes,
        isLoading: false,
      })
    } catch (error) {
      set({ error: getStatsApiErrorMessage(error), isLoading: false })
    }
  },

  clearError: () => set({ error: null }),

  reset: () => set(initialState),
}))
