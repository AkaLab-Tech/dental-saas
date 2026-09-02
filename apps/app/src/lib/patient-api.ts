import { apiClient } from './api'
import { ToothStatus, type ToothData, type TeethData } from '@dental/shared'

// ============================================================================
// Types
// ============================================================================

export interface Patient {
  id: string
  tenantId: string
  firstName: string
  lastName: string
  email: string | null
  phone: string | null
  dob: string | null
  gender: 'male' | 'female' | 'other' | 'prefer_not_to_say' | null
  coverageType: 'PARTICULAR' | 'CONVENIO'
  convenioName: string | null
  address: string | null
  notes: Record<string, unknown> | null
  teeth: TeethData | null
  showPrimaryTeeth: boolean
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface PatientStats {
  total: number
  active: number
  inactive: number
  limit: number
  remaining: number
}

export interface CreatePatientData {
  firstName: string
  lastName: string
  email?: string
  phone?: string
  dob?: string
  gender?: 'male' | 'female' | 'other' | 'prefer_not_to_say'
  coverageType?: 'PARTICULAR' | 'CONVENIO'
  convenioName?: string | null
  address?: string
  notes?: Record<string, unknown>
}

export interface UpdatePatientData extends Partial<CreatePatientData> {
  isActive?: boolean
}

export interface ListPatientsParams {
  limit?: number
  offset?: number
  includeInactive?: boolean
  search?: string
}

export interface PatientAppointment {
  id: string
  tenantId: string
  patientId: string
  doctorId: string
  startTime: string
  endTime: string
  duration: number
  status: string
  type: string | null
  notes: string | null
  cost: number | null
  isPaid: boolean
  doctor: {
    id: string
    firstName: string
    lastName: string
    specialty: string | null
  }
}

interface ApiResponse<T> {
  success: boolean
  data: T
}

// ============================================================================
// API Functions
// ============================================================================

/**
 * Get list of patients for the current tenant
 */
export async function getPatients(params?: ListPatientsParams): Promise<Patient[]> {
  const queryParams = new URLSearchParams()

  if (params?.limit) queryParams.set('limit', String(params.limit))
  if (params?.offset) queryParams.set('offset', String(params.offset))
  if (params?.includeInactive) queryParams.set('includeInactive', 'true')
  if (params?.search) queryParams.set('search', params.search)

  const queryString = queryParams.toString()
  const url = `/patients${queryString ? `?${queryString}` : ''}`

  const response = await apiClient.get<ApiResponse<Patient[]>>(url)
  return response.data.data
}

/**
 * Get a single patient by ID
 */
export async function getPatientById(id: string): Promise<Patient> {
  const response = await apiClient.get<ApiResponse<Patient>>(`/patients/${id}`)
  return response.data.data
}

/**
 * Get appointments for a patient
 */
export async function getPatientAppointments(
  id: string,
  params?: { limit?: number; offset?: number }
): Promise<PatientAppointment[]> {
  const queryParams = new URLSearchParams()

  if (params?.limit) queryParams.set('limit', String(params.limit))
  if (params?.offset) queryParams.set('offset', String(params.offset))

  const queryString = queryParams.toString()
  const url = `/patients/${id}/appointments${queryString ? `?${queryString}` : ''}`

  const response = await apiClient.get<ApiResponse<PatientAppointment[]>>(url)
  return response.data.data
}

/**
 * Create a new patient
 */
export async function createPatient(data: CreatePatientData): Promise<Patient> {
  const response = await apiClient.post<ApiResponse<Patient>>('/patients', data)
  return response.data.data
}

/**
 * Update an existing patient
 */
export async function updatePatient(id: string, data: UpdatePatientData): Promise<Patient> {
  const response = await apiClient.put<ApiResponse<Patient>>(`/patients/${id}`, data)
  return response.data.data
}

/**
 * Soft delete a patient
 */
export async function deletePatient(id: string): Promise<void> {
  await apiClient.delete(`/patients/${id}`)
}

/**
 * Restore a soft-deleted patient
 */
export async function restorePatient(id: string): Promise<Patient> {
  const response = await apiClient.put<ApiResponse<Patient>>(`/patients/${id}/restore`)
  return response.data.data
}

/**
 * Get patient statistics and plan limits
 */
export async function getPatientStats(): Promise<PatientStats> {
  const response = await apiClient.get<ApiResponse<PatientStats>>('/patients/stats')
  return response.data.data
}

/**
 * Get the tenant's previously used convenio (insurance agreement) names, for autocomplete
 */
export async function getConvenioNames(): Promise<string[]> {
  const response = await apiClient.get<ApiResponse<string[]>>('/patients/convenios')
  return response.data.data
}

/**
 * Calculate patient age from date of birth
 * Returns null for invalid dates or dates in the future
 */
export function calculateAge(dob: string | null): number | null {
  if (!dob) return null
  const birthDate = new Date(dob)
  if (isNaN(birthDate.getTime())) return null
  const today = new Date()
  // Return null for future dates
  if (birthDate > today) return null
  let age = today.getFullYear() - birthDate.getFullYear()
  const monthDiff = today.getMonth() - birthDate.getMonth()
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--
  }
  return age
}

/**
 * Format patient full name
 */
export function getPatientFullName(patient: Pick<Patient, 'firstName' | 'lastName'>): string {
  return `${patient.firstName} ${patient.lastName}`
}

/**
 * Get patient initials for avatar
 */
export function getPatientInitials(patient: Pick<Patient, 'firstName' | 'lastName'>): string {
  return `${patient.firstName.charAt(0)}${patient.lastName.charAt(0)}`.toUpperCase()
}

// ============================================================================
// Dental Chart (Teeth) API Functions
// ============================================================================

/**
 * Get dental chart data for a patient
 */
export async function getPatientTeeth(patientId: string): Promise<TeethData> {
  const response = await apiClient.get<ApiResponse<TeethData>>(`/patients/${patientId}/teeth`)
  return response.data.data
}

/**
 * Update dental chart data for a patient
 * Merges with existing data. Empty note + healthy status removes the tooth entry.
 */
export async function updatePatientTeeth(
  patientId: string,
  teeth: TeethData
): Promise<Patient> {
  const response = await apiClient.patch<ApiResponse<Patient>>(`/patients/${patientId}/teeth`, teeth)
  return response.data.data
}

/**
 * Update a single tooth data (note and status)
 */
export async function updateToothData(
  patientId: string,
  toothNumber: string,
  data: ToothData
): Promise<Patient> {
  return updatePatientTeeth(patientId, { [toothNumber]: data })
}

/**
 * Delete tooth data (set to empty note with healthy status)
 */
export async function deleteToothData(
  patientId: string,
  toothNumber: string
): Promise<Patient> {
  return updatePatientTeeth(patientId, { [toothNumber]: { note: '', status: ToothStatus.HEALTHY } })
}

/**
 * Toggle the primary-teeth chart visibility for a patient.
 * Persists at the patient level so the choice is remembered across sessions.
 */
export async function updateShowPrimaryTeeth(
  patientId: string,
  showPrimaryTeeth: boolean
): Promise<boolean> {
  const response = await apiClient.patch<ApiResponse<{ showPrimaryTeeth: boolean }>>(
    `/patients/${patientId}/show-primary-teeth`,
    { showPrimaryTeeth }
  )
  return response.data.data.showPrimaryTeeth
}

/**
 * @deprecated Use updateToothData instead
 */
export async function updateToothNote(
  patientId: string,
  toothNumber: string,
  note: string
): Promise<Patient> {
  return updateToothData(patientId, toothNumber, { note, status: ToothStatus.HEALTHY })
}

/**
 * @deprecated Use deleteToothData instead
 */
export async function deleteToothNote(
  patientId: string,
  toothNumber: string
): Promise<Patient> {
  return deleteToothData(patientId, toothNumber)
}

// ============================================================================
// Error Helpers
// ============================================================================

interface ApiErrorResponse {
  success: false
  error: {
    message: string
    code?: string
  }
}

export function isPatientApiError(error: unknown): error is { response: { data: ApiErrorResponse } } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'response' in error &&
    typeof (error as { response?: unknown }).response === 'object' &&
    (error as { response: { data?: unknown } }).response?.data !== undefined
  )
}

export function getPatientApiErrorMessage(error: unknown): string {
  if (isPatientApiError(error)) {
    return error.response.data.error?.message || 'An unexpected error occurred'
  }
  if (error instanceof Error) {
    return error.message
  }
  return 'An unexpected error occurred'
}
