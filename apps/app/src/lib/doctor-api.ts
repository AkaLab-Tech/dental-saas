import { apiClient } from './api'

// ============================================================================
// Types
// ============================================================================

export interface Doctor {
  id: string
  tenantId: string
  firstName: string
  lastName: string
  email: string | null
  phone: string | null
  specialty: string | null
  licenseNumber: string | null
  workingDays: string[]
  workingHours: { start: string; end: string } | null
  consultingRoom: string | null
  avatar: string | null
  bio: string | null
  hourlyRate: number | null
  commissionPercentage: number | null
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface DoctorStats {
  total: number
  active: number
  inactive: number
  limit: number
  remaining: number
}

export interface CreateDoctorData {
  firstName: string
  lastName: string
  email?: string
  phone?: string
  specialty?: string
  licenseNumber?: string
  workingDays?: string[]
  workingHours?: { start: string; end: string }
  consultingRoom?: string
  bio?: string
  hourlyRate?: number
  commissionPercentage?: number
}

export interface UpdateDoctorData extends Partial<CreateDoctorData> {
  isActive?: boolean
}

export interface ListDoctorsParams {
  limit?: number
  offset?: number
  includeInactive?: boolean
  search?: string
}

interface ApiResponse<T> {
  success: boolean
  data: T
}

interface ApiErrorResponse {
  success: false
  error: {
    message: string
    code?: string
  }
}

// ============================================================================
// API Functions
// ============================================================================

/**
 * Get list of doctors for the current tenant
 */
export async function getDoctors(params?: ListDoctorsParams): Promise<Doctor[]> {
  const queryParams = new URLSearchParams()

  if (params?.limit) queryParams.set('limit', String(params.limit))
  if (params?.offset) queryParams.set('offset', String(params.offset))
  if (params?.includeInactive) queryParams.set('includeInactive', 'true')
  if (params?.search) queryParams.set('search', params.search)

  const queryString = queryParams.toString()
  const url = `/doctors${queryString ? `?${queryString}` : ''}`

  const response = await apiClient.get<ApiResponse<Doctor[]>>(url)
  return response.data.data
}

/**
 * Get a single doctor by ID
 */
export async function getDoctorById(id: string): Promise<Doctor> {
  const response = await apiClient.get<ApiResponse<Doctor>>(`/doctors/${id}`)
  return response.data.data
}

/**
 * Create a new doctor
 */
export async function createDoctor(data: CreateDoctorData): Promise<Doctor> {
  const response = await apiClient.post<ApiResponse<Doctor>>('/doctors', data)
  return response.data.data
}

/**
 * Update an existing doctor
 */
export async function updateDoctor(id: string, data: UpdateDoctorData): Promise<Doctor> {
  const response = await apiClient.put<ApiResponse<Doctor>>(`/doctors/${id}`, data)
  return response.data.data
}

/**
 * Soft delete a doctor
 */
export async function deleteDoctor(id: string): Promise<void> {
  await apiClient.delete(`/doctors/${id}`)
}

/**
 * Restore a soft-deleted doctor
 */
export async function restoreDoctor(id: string): Promise<Doctor> {
  const response = await apiClient.put<ApiResponse<Doctor>>(`/doctors/${id}/restore`)
  return response.data.data
}

/**
 * Get doctor statistics and plan limits
 */
export async function getDoctorStats(): Promise<DoctorStats> {
  const response = await apiClient.get<ApiResponse<DoctorStats>>('/doctors/stats')
  return response.data.data
}

/**
 * Check if we can add more doctors (within plan limit)
 */
export async function checkDoctorLimit(): Promise<{ allowed: boolean; message?: string; currentCount: number; limit: number }> {
  const response = await apiClient.get<ApiResponse<{ allowed: boolean; message?: string; currentCount: number; limit: number }>>('/doctors/check-limit')
  return response.data.data
}

// ============================================================================
// Error Helpers
// ============================================================================

export function isDoctorApiError(error: unknown): error is { response: { data: ApiErrorResponse } } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'response' in error &&
    typeof (error as { response?: unknown }).response === 'object' &&
    (error as { response: { data?: unknown } }).response?.data !== undefined
  )
}

export function getDoctorApiErrorMessage(error: unknown): string {
  if (isDoctorApiError(error)) {
    return error.response.data.error?.message || 'An unexpected error occurred'
  }
  if (error instanceof Error) {
    return error.message
  }
  return 'An unexpected error occurred'
}
