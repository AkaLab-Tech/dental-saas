import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'
import { useStatsStore } from './stats.store'
import type {
  OverviewStats,
  AppointmentStats,
  RevenueStats,
  PatientsGrowthStats,
  DoctorPerformanceStats,
} from '@/lib/stats-api'

// Mock the stats-api module
vi.mock('@/lib/stats-api', () => ({
  getOverviewStats: vi.fn(),
  getAppointmentStats: vi.fn(),
  getRevenueStats: vi.fn(),
  getPatientsGrowthStats: vi.fn(),
  getDoctorPerformanceStats: vi.fn(),
  getStatsApiErrorMessage: vi.fn((error: unknown) => {
    if (error instanceof Error) return error.message
    return 'An unexpected error occurred'
  }),
}))

// Import mocked functions
import {
  getOverviewStats,
  getAppointmentStats,
  getRevenueStats,
  getPatientsGrowthStats,
  getDoctorPerformanceStats,
} from '@/lib/stats-api'

const mockOverview: OverviewStats = {
  totalPatients: 150,
  totalDoctors: 5,
  totalAppointments: 500,
  appointmentsThisMonth: 45,
  completedAppointmentsThisMonth: 38,
  pendingLabworks: 3,
  unpaidLabworks: 1,
  monthlyCollected: 25000,
  monthlyBilledPaid: 25000,
  pendingPayments: 5000,
}

const mockAppointmentStats: AppointmentStats = {
  total: 45,
  byStatus: {
    COMPLETED: 38,
    SCHEDULED: 5,
    CANCELLED: 2,
  },
  byDay: [
    { date: '2024-01-01', count: 5 },
    { date: '2024-01-02', count: 3 },
  ],
}

const mockRevenueStats: RevenueStats = {
  total: 75000,
  paid: 70000,
  pending: 5000,
  byMonth: [
    { month: 'Nov 2024', revenue: 22000 },
    { month: 'Dec 2024', revenue: 28000 },
    { month: 'Jan 2025', revenue: 25000 },
  ],
}

const mockPatientsGrowth: PatientsGrowthStats = {
  total: 150,
  thisMonth: 12,
  lastMonth: 8,
  growthPercentage: 50,
  byMonth: [
    { month: 'Nov 2024', count: 6 },
    { month: 'Dec 2024', count: 8 },
    { month: 'Jan 2025', count: 12 },
  ],
}

const mockDoctorPerformance: DoctorPerformanceStats[] = [
  {
    doctorId: '1',
    doctorName: 'Dr. Smith',
    appointmentsCount: 20,
    completedCount: 18,
    revenue: 10000,
    completionRate: 90,
  },
  {
    doctorId: '2',
    doctorName: 'Dr. Johnson',
    appointmentsCount: 15,
    completedCount: 12,
    revenue: 8000,
    completionRate: 80,
  },
]

describe('stats.store', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    useStatsStore.setState({
      overview: null,
      appointmentStats: null,
      revenueStats: null,
      patientsGrowth: null,
      doctorPerformance: null,
      isLoading: false,
      error: null,
    })
    vi.clearAllMocks()
  })

  describe('initial state', () => {
    it('should have null for all stats', () => {
      const state = useStatsStore.getState()
      expect(state.overview).toBeNull()
      expect(state.appointmentStats).toBeNull()
      expect(state.revenueStats).toBeNull()
      expect(state.patientsGrowth).toBeNull()
      expect(state.doctorPerformance).toBeNull()
    })

    it('should not be loading', () => {
      const state = useStatsStore.getState()
      expect(state.isLoading).toBe(false)
    })

    it('should have no error', () => {
      const state = useStatsStore.getState()
      expect(state.error).toBeNull()
    })
  })

  describe('fetchOverview', () => {
    it('should fetch overview stats successfully', async () => {
      ;(getOverviewStats as Mock).mockResolvedValue(mockOverview)

      await useStatsStore.getState().fetchOverview()

      const state = useStatsStore.getState()
      expect(state.overview).toEqual(mockOverview)
      expect(state.isLoading).toBe(false)
    })

    it('should handle fetch error', async () => {
      ;(getOverviewStats as Mock).mockRejectedValue(new Error('Network error'))

      await useStatsStore.getState().fetchOverview()

      const state = useStatsStore.getState()
      expect(state.error).toBe('Network error')
    })
  })

  describe('fetchAppointmentStats', () => {
    it('should fetch appointment stats successfully', async () => {
      ;(getAppointmentStats as Mock).mockResolvedValue(mockAppointmentStats)

      await useStatsStore.getState().fetchAppointmentStats()

      const state = useStatsStore.getState()
      expect(state.appointmentStats).toEqual(mockAppointmentStats)
    })

    it('should pass date parameters', async () => {
      ;(getAppointmentStats as Mock).mockResolvedValue(mockAppointmentStats)

      await useStatsStore.getState().fetchAppointmentStats('2024-01-01', '2024-01-31')

      expect(getAppointmentStats).toHaveBeenCalledWith('2024-01-01', '2024-01-31')
    })
  })

  describe('fetchRevenueStats', () => {
    it('should fetch revenue stats successfully', async () => {
      ;(getRevenueStats as Mock).mockResolvedValue(mockRevenueStats)

      await useStatsStore.getState().fetchRevenueStats()

      const state = useStatsStore.getState()
      expect(state.revenueStats).toEqual(mockRevenueStats)
    })

    it('should pass months parameter', async () => {
      ;(getRevenueStats as Mock).mockResolvedValue(mockRevenueStats)

      await useStatsStore.getState().fetchRevenueStats(6)

      expect(getRevenueStats).toHaveBeenCalledWith(6)
    })
  })

  describe('fetchPatientsGrowth', () => {
    it('should fetch patients growth stats successfully', async () => {
      ;(getPatientsGrowthStats as Mock).mockResolvedValue(mockPatientsGrowth)

      await useStatsStore.getState().fetchPatientsGrowth()

      const state = useStatsStore.getState()
      expect(state.patientsGrowth).toEqual(mockPatientsGrowth)
    })

    it('should pass months parameter', async () => {
      ;(getPatientsGrowthStats as Mock).mockResolvedValue(mockPatientsGrowth)

      await useStatsStore.getState().fetchPatientsGrowth(3)

      expect(getPatientsGrowthStats).toHaveBeenCalledWith(3)
    })
  })

  describe('fetchDoctorPerformance', () => {
    it('should fetch doctor performance stats successfully', async () => {
      ;(getDoctorPerformanceStats as Mock).mockResolvedValue(mockDoctorPerformance)

      await useStatsStore.getState().fetchDoctorPerformance()

      const state = useStatsStore.getState()
      expect(state.doctorPerformance).toEqual(mockDoctorPerformance)
    })

    it('should silently handle 403 error for non-admin users', async () => {
      const axiosError = {
        response: { status: 403 },
      }
      ;(getDoctorPerformanceStats as Mock).mockRejectedValue(axiosError)

      await useStatsStore.getState().fetchDoctorPerformance()

      const state = useStatsStore.getState()
      expect(state.doctorPerformance).toBeNull()
      expect(state.error).toBeNull()
      expect(state.isLoading).toBe(false)
    })

    it('should set error for non-403 errors', async () => {
      ;(getDoctorPerformanceStats as Mock).mockRejectedValue(new Error('Server error'))

      await useStatsStore.getState().fetchDoctorPerformance()

      const state = useStatsStore.getState()
      expect(state.error).toBe('Server error')
    })
  })

  describe('fetchAllStats', () => {
    it('should fetch all stats successfully', async () => {
      ;(getOverviewStats as Mock).mockResolvedValue(mockOverview)
      ;(getAppointmentStats as Mock).mockResolvedValue(mockAppointmentStats)
      ;(getRevenueStats as Mock).mockResolvedValue(mockRevenueStats)
      ;(getPatientsGrowthStats as Mock).mockResolvedValue(mockPatientsGrowth)
      ;(getDoctorPerformanceStats as Mock).mockResolvedValue(mockDoctorPerformance)

      await useStatsStore.getState().fetchAllStats()

      const state = useStatsStore.getState()
      expect(state.overview).toEqual(mockOverview)
      expect(state.appointmentStats).toEqual(mockAppointmentStats)
      expect(state.revenueStats).toEqual(mockRevenueStats)
      expect(state.patientsGrowth).toEqual(mockPatientsGrowth)
      expect(state.doctorPerformance).toEqual(mockDoctorPerformance)
      expect(state.isLoading).toBe(false)
    })

    it('should continue even if doctor performance fails', async () => {
      ;(getOverviewStats as Mock).mockResolvedValue(mockOverview)
      ;(getAppointmentStats as Mock).mockResolvedValue(mockAppointmentStats)
      ;(getRevenueStats as Mock).mockResolvedValue(mockRevenueStats)
      ;(getPatientsGrowthStats as Mock).mockResolvedValue(mockPatientsGrowth)
      ;(getDoctorPerformanceStats as Mock).mockRejectedValue(new Error('Forbidden'))

      await useStatsStore.getState().fetchAllStats()

      const state = useStatsStore.getState()
      expect(state.overview).toEqual(mockOverview)
      expect(state.doctorPerformance).toBeNull()
      expect(state.error).toBeNull() // Should not set error for this case
    })

    it('should set error if main stats fail', async () => {
      ;(getOverviewStats as Mock).mockRejectedValue(new Error('Network error'))
      ;(getAppointmentStats as Mock).mockResolvedValue(mockAppointmentStats)
      ;(getRevenueStats as Mock).mockResolvedValue(mockRevenueStats)
      ;(getPatientsGrowthStats as Mock).mockResolvedValue(mockPatientsGrowth)

      await useStatsStore.getState().fetchAllStats()

      const state = useStatsStore.getState()
      expect(state.error).toBe('Network error')
    })
  })

  describe('clearError', () => {
    it('should clear the error', () => {
      useStatsStore.setState({ error: 'Some error' })

      useStatsStore.getState().clearError()

      expect(useStatsStore.getState().error).toBeNull()
    })
  })

  describe('reset', () => {
    it('should reset to initial state', () => {
      useStatsStore.setState({
        overview: mockOverview,
        appointmentStats: mockAppointmentStats,
        revenueStats: mockRevenueStats,
        patientsGrowth: mockPatientsGrowth,
        doctorPerformance: mockDoctorPerformance,
        isLoading: true,
        error: 'Some error',
      })

      useStatsStore.getState().reset()

      const state = useStatsStore.getState()
      expect(state.overview).toBeNull()
      expect(state.appointmentStats).toBeNull()
      expect(state.revenueStats).toBeNull()
      expect(state.patientsGrowth).toBeNull()
      expect(state.doctorPerformance).toBeNull()
      expect(state.isLoading).toBe(false)
      expect(state.error).toBeNull()
    })
  })
})
