import { apiClient } from './api'

// ============================================================================
// Types
// ============================================================================

export interface OverviewStats {
  totalPatients: number
  totalDoctors: number
  totalAppointments: number
  appointmentsThisMonth: number
  completedAppointmentsThisMonth: number
  pendingLabworks: number
  unpaidLabworks: number
  monthlyRevenue: number
  pendingPayments: number
}

export interface AppointmentStats {
  total: number
  byStatus: Record<string, number>
  byDay: Array<{ date: string; count: number }>
}

export interface RevenueStats {
  total: number
  paid: number
  pending: number
  byMonth: Array<{ month: string; revenue: number }>
}

export interface PatientsGrowthStats {
  total: number
  thisMonth: number
  lastMonth: number
  growthPercentage: number
  byMonth: Array<{ month: string; count: number }>
}

export interface DoctorPerformanceStats {
  doctorId: string
  doctorName: string
  appointmentsCount: number
  completedCount: number
  revenue: number
  completionRate: number
}

export interface UpcomingAppointment {
  id: string
  patientName: string
  startTime: string
  endTime: string
  type: string | null
  status: string
}

export interface AppointmentTypeCount {
  type: string
  count: number
}

interface ApiResponse<T> {
  success: boolean
  data: T
  error?: { message: string }
}

// ============================================================================
// API Functions
// ============================================================================

/**
 * Get dashboard overview statistics
 */
export async function getOverviewStats(doctorId?: string): Promise<OverviewStats> {
  const response = doctorId
    ? await apiClient.get<ApiResponse<OverviewStats>>('/stats/overview', { params: { doctorId } })
    : await apiClient.get<ApiResponse<OverviewStats>>('/stats/overview')
  return response.data.data
}

/**
 * Get appointment statistics for a period
 */
export async function getAppointmentStats(
  startDate?: string,
  endDate?: string,
  doctorId?: string
): Promise<AppointmentStats> {
  const params: Record<string, string> = {}
  if (startDate) params.startDate = startDate
  if (endDate) params.endDate = endDate
  if (doctorId) params.doctorId = doctorId

  const response = await apiClient.get<ApiResponse<AppointmentStats>>('/stats/appointments', { params })
  return response.data.data
}

/**
 * Get revenue statistics
 */
export async function getRevenueStats(months?: number, doctorId?: string): Promise<RevenueStats> {
  const params: Record<string, string> = {}
  if (months) params.months = String(months)
  if (doctorId) params.doctorId = doctorId

  const response = await apiClient.get<ApiResponse<RevenueStats>>('/stats/revenue', { params })
  return response.data.data
}

/**
 * Get patients growth statistics
 */
export async function getPatientsGrowthStats(months?: number): Promise<PatientsGrowthStats> {
  const params: Record<string, string> = {}
  if (months) params.months = String(months)

  const response = await apiClient.get<ApiResponse<PatientsGrowthStats>>('/stats/patients-growth', { params })
  return response.data.data
}

/**
 * Get doctor performance statistics (ADMIN+ only)
 */
export async function getDoctorPerformanceStats(): Promise<DoctorPerformanceStats[]> {
  const response = await apiClient.get<ApiResponse<DoctorPerformanceStats[]>>('/stats/doctors-performance')
  return response.data.data
}

/**
 * Resolve the current user's linked doctorId
 */
export async function getMyDoctorId(): Promise<string | null> {
  const response = await apiClient.get<ApiResponse<{ doctorId: string | null }>>('/stats/my-doctor-id')
  return response.data.data.doctorId
}

/**
 * Get upcoming appointments for a doctor
 */
export async function getUpcomingAppointments(doctorId: string, limit?: number): Promise<UpcomingAppointment[]> {
  const params: Record<string, string> = { doctorId }
  if (limit) params.limit = String(limit)

  const response = await apiClient.get<ApiResponse<UpcomingAppointment[]>>('/stats/upcoming', { params })
  return response.data.data
}

/**
 * Get appointment type distribution for a doctor
 */
export async function getAppointmentTypeStats(doctorId: string): Promise<AppointmentTypeCount[]> {
  const response = await apiClient.get<ApiResponse<AppointmentTypeCount[]>>('/stats/appointment-types', {
    params: { doctorId },
  })
  return response.data.data
}

/**
 * Extract error message from API error
 */
export function getStatsApiErrorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'response' in error) {
    const axiosError = error as { response?: { data?: { error?: { message?: string } } } }
    return axiosError.response?.data?.error?.message || 'Error loading statistics'
  }
  return 'Error loading statistics'
}
