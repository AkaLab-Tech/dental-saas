import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  getOverviewStats,
  getAppointmentStats,
  getRevenueStats,
  getPatientsGrowthStats,
  getDoctorPerformanceStats,
  getStatsApiErrorMessage,
  type OverviewStats,
  type AppointmentStats,
  type RevenueStats,
  type PatientsGrowthStats,
  type DoctorPerformanceStats,
} from './stats-api'
import { apiClient } from './api'

vi.mock('./api', () => ({
  apiClient: {
    get: vi.fn(),
  },
}))

const mockOverviewStats: OverviewStats = {
  totalPatients: 150,
  totalDoctors: 5,
  totalAppointments: 500,
  appointmentsThisMonth: 45,
  completedAppointmentsThisMonth: 38,
  pendingLabworks: 12,
  unpaidLabworks: 8,
  monthlyCollected: 15000,
  monthlyBilledPaid: 15000,
  pendingPayments: 3500,
}

const mockAppointmentStats: AppointmentStats = {
  total: 100,
  byStatus: {
    SCHEDULED: 20,
    CONFIRMED: 15,
    COMPLETED: 50,
    CANCELLED: 10,
    NO_SHOW: 5,
  },
  byDay: [
    { date: '2024-01-15', count: 8 },
    { date: '2024-01-16', count: 12 },
    { date: '2024-01-17', count: 10 },
  ],
}

const mockRevenueStats: RevenueStats = {
  total: 50000,
  paid: 42000,
  pending: 8000,
  byMonth: [
    { month: '2024-01', revenue: 15000 },
    { month: '2024-02', revenue: 18000 },
    { month: '2024-03', revenue: 17000 },
  ],
}

const mockPatientsGrowthStats: PatientsGrowthStats = {
  total: 150,
  thisMonth: 12,
  lastMonth: 10,
  growthPercentage: 20,
  byMonth: [
    { month: '2024-01', count: 10 },
    { month: '2024-02', count: 12 },
    { month: '2024-03', count: 15 },
  ],
}

const mockDoctorPerformanceStats: DoctorPerformanceStats[] = [
  {
    doctorId: 'doctor-1',
    doctorName: 'Dr. Jane Smith',
    appointmentsCount: 80,
    completedCount: 72,
    revenue: 12000,
    completionRate: 90,
  },
  {
    doctorId: 'doctor-2',
    doctorName: 'Dr. John Doe',
    appointmentsCount: 60,
    completedCount: 55,
    revenue: 9500,
    completionRate: 91.67,
  },
]

describe('stats-api', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getOverviewStats', () => {
    it('should fetch overview statistics', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: { success: true, data: mockOverviewStats },
      })

      const result = await getOverviewStats()

      expect(apiClient.get).toHaveBeenCalledWith('/stats/overview')
      expect(result).toEqual(mockOverviewStats)
    })

    it('should throw error on fetch failure', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(new Error('Unauthorized'))

      await expect(getOverviewStats()).rejects.toThrow('Unauthorized')
    })
  })

  describe('getAppointmentStats', () => {
    it('should fetch appointment stats without params', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: { success: true, data: mockAppointmentStats },
      })

      const result = await getAppointmentStats()

      expect(apiClient.get).toHaveBeenCalledWith('/stats/appointments', { params: {} })
      expect(result).toEqual(mockAppointmentStats)
    })

    it('should fetch appointment stats with date range', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: { success: true, data: mockAppointmentStats },
      })

      const result = await getAppointmentStats('2024-01-01', '2024-01-31')

      expect(apiClient.get).toHaveBeenCalledWith('/stats/appointments', {
        params: { startDate: '2024-01-01', endDate: '2024-01-31' },
      })
      expect(result).toEqual(mockAppointmentStats)
    })

    it('should fetch appointment stats with only start date', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: { success: true, data: mockAppointmentStats },
      })

      const result = await getAppointmentStats('2024-01-01')

      expect(apiClient.get).toHaveBeenCalledWith('/stats/appointments', {
        params: { startDate: '2024-01-01' },
      })
      expect(result).toEqual(mockAppointmentStats)
    })

    it('should throw error on fetch failure', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(new Error('Server error'))

      await expect(getAppointmentStats()).rejects.toThrow('Server error')
    })
  })

  describe('getRevenueStats', () => {
    it('should fetch revenue stats without params', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: { success: true, data: mockRevenueStats },
      })

      const result = await getRevenueStats()

      expect(apiClient.get).toHaveBeenCalledWith('/stats/revenue', { params: {} })
      expect(result).toEqual(mockRevenueStats)
    })

    it('should fetch revenue stats with months param', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: { success: true, data: mockRevenueStats },
      })

      const result = await getRevenueStats(6)

      expect(apiClient.get).toHaveBeenCalledWith('/stats/revenue', {
        params: { months: '6' },
      })
      expect(result).toEqual(mockRevenueStats)
    })

    it('should throw error on fetch failure', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(new Error('Network error'))

      await expect(getRevenueStats()).rejects.toThrow('Network error')
    })
  })

  describe('getPatientsGrowthStats', () => {
    it('should fetch patients growth stats without params', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: { success: true, data: mockPatientsGrowthStats },
      })

      const result = await getPatientsGrowthStats()

      expect(apiClient.get).toHaveBeenCalledWith('/stats/patients-growth', { params: {} })
      expect(result).toEqual(mockPatientsGrowthStats)
    })

    it('should fetch patients growth stats with months param', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: { success: true, data: mockPatientsGrowthStats },
      })

      const result = await getPatientsGrowthStats(12)

      expect(apiClient.get).toHaveBeenCalledWith('/stats/patients-growth', {
        params: { months: '12' },
      })
      expect(result).toEqual(mockPatientsGrowthStats)
    })

    it('should throw error on fetch failure', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(new Error('Forbidden'))

      await expect(getPatientsGrowthStats()).rejects.toThrow('Forbidden')
    })
  })

  describe('getDoctorPerformanceStats', () => {
    it('should fetch doctor performance stats', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: { success: true, data: mockDoctorPerformanceStats },
      })

      const result = await getDoctorPerformanceStats()

      expect(apiClient.get).toHaveBeenCalledWith('/stats/doctors-performance')
      expect(result).toEqual(mockDoctorPerformanceStats)
      expect(result).toHaveLength(2)
    })

    it('should return empty array when no doctors', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: { success: true, data: [] },
      })

      const result = await getDoctorPerformanceStats()

      expect(result).toEqual([])
    })

    it('should throw error on fetch failure', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(new Error('Admin access required'))

      await expect(getDoctorPerformanceStats()).rejects.toThrow('Admin access required')
    })
  })

  describe('getStatsApiErrorMessage', () => {
    it('should extract message from API error response', () => {
      const error = {
        response: {
          data: {
            error: { message: 'Statistics unavailable' },
          },
        },
      }

      expect(getStatsApiErrorMessage(error)).toBe('Statistics unavailable')
    })

    it('should return default message for API error without message', () => {
      const error = {
        response: {
          data: {},
        },
      }

      expect(getStatsApiErrorMessage(error)).toBe('Error loading statistics')
    })

    it('should return default message for error without response', () => {
      const error = new Error('Network error')

      expect(getStatsApiErrorMessage(error)).toBe('Error loading statistics')
    })

    it('should return default message for null error', () => {
      expect(getStatsApiErrorMessage(null)).toBe('Error loading statistics')
    })

    it('should return default message for undefined error', () => {
      expect(getStatsApiErrorMessage(undefined)).toBe('Error loading statistics')
    })

    it('should return default message for non-object error', () => {
      expect(getStatsApiErrorMessage('string error')).toBe('Error loading statistics')
      expect(getStatsApiErrorMessage(123)).toBe('Error loading statistics')
    })
  })
})
