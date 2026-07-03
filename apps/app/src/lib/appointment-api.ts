import { apiClient } from './api'
import { formatCurrency } from './format'
import i18n from '@/i18n'
import type { BudgetItemStatus } from './budget-api'

// ============================================================================
// Types
// ============================================================================

export type AppointmentStatus =
  | 'SCHEDULED'
  | 'CONFIRMED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'NO_SHOW'
  | 'RESCHEDULED'

export interface AppointmentPatient {
  id: string
  firstName: string
  lastName: string
  email: string | null
  phone: string | null
}

export interface AppointmentDoctor {
  id: string
  firstName: string
  lastName: string
  specialty: string | null
  email: string | null
}

export interface Appointment {
  id: string
  tenantId: string
  patientId: string
  doctorId: string
  startTime: string
  endTime: string
  duration: number
  status: AppointmentStatus
  type: string | null
  notes: string | null
  privateNotes: string | null
  cost: number | null
  isPaid: boolean
  // FIFO breakdown — present on per-patient endpoints (getAppointmentsByPatient,
  // getAppointmentById). undefined elsewhere.
  paidAmount?: number
  outstanding?: number
  isActive: boolean
  createdAt: string
  updatedAt: string
  patient?: AppointmentPatient
  doctor?: AppointmentDoctor
}

export interface AppointmentStats {
  total: number
  scheduled: number
  completed: number
  cancelled: number
  noShow: number
  todayCount: number
  weekCount: number
  revenue: number
  pendingPayment: number
}

export interface CreateAppointmentData {
  patientId: string
  doctorId: string
  startTime: string
  endTime: string
  duration?: number
  status?: AppointmentStatus
  type?: string
  notes?: string
  privateNotes?: string
  cost?: number
  isPaid?: boolean
  // Replace-set of budget item ids to associate (role SCHEDULED). Omit to
  // leave untouched; see `getAppointmentBudgetItems` for hydration on edit.
  budgetItemIds?: string[]
}

export interface UpdateAppointmentData {
  patientId?: string
  doctorId?: string
  startTime?: string
  endTime?: string
  duration?: number
  status?: AppointmentStatus
  type?: string | null
  notes?: string | null
  privateNotes?: string | null
  cost?: number | null
  isPaid?: boolean
  // Replace-set: provided = set associations (empty array clears them);
  // omit to leave existing associations untouched.
  budgetItemIds?: string[]
}

export type AppointmentBudgetItemRole = 'SCHEDULED' | 'EXECUTED'

export interface AppointmentBudgetItemSummary {
  id: string
  budgetId: string
  description: string
  toothNumber: string | null
  quantity: number
  unitPrice: string
  totalPrice: string
  plannedAppointmentType: string | null
  status: BudgetItemStatus
  notes: string | null
  order: number
  roles: AppointmentBudgetItemRole[]
}

export interface ListAppointmentsParams {
  limit?: number
  offset?: number
  includeInactive?: boolean
  doctorId?: string
  patientId?: string
  status?: AppointmentStatus
  from?: string
  to?: string
}

export interface CalendarParams {
  from: string
  to: string
  doctorId?: string
  patientId?: string
}

export interface StatsParams {
  from?: string
  to?: string
  doctorId?: string
}

interface ApiResponse<T> {
  success: boolean
  data: T
}

// ============================================================================
// API Functions
// ============================================================================

/**
 * Get list of appointments for the current tenant
 */
export async function getAppointments(params?: ListAppointmentsParams): Promise<Appointment[]> {
  const queryParams = new URLSearchParams()

  if (params?.limit) queryParams.set('limit', String(params.limit))
  if (params?.offset) queryParams.set('offset', String(params.offset))
  if (params?.includeInactive) queryParams.set('includeInactive', 'true')
  if (params?.doctorId) queryParams.set('doctorId', params.doctorId)
  if (params?.patientId) queryParams.set('patientId', params.patientId)
  if (params?.status) queryParams.set('status', params.status)
  if (params?.from) queryParams.set('from', params.from)
  if (params?.to) queryParams.set('to', params.to)

  const queryString = queryParams.toString()
  const url = `/appointments${queryString ? `?${queryString}` : ''}`

  const response = await apiClient.get<ApiResponse<Appointment[]>>(url)
  return response.data.data
}

/**
 * Get appointments for calendar view (optimized for date ranges)
 */
export async function getCalendarAppointments(params: CalendarParams): Promise<Appointment[]> {
  const queryParams = new URLSearchParams()

  queryParams.set('from', params.from)
  queryParams.set('to', params.to)
  if (params.doctorId) queryParams.set('doctorId', params.doctorId)
  if (params.patientId) queryParams.set('patientId', params.patientId)

  const url = `/appointments/calendar?${queryParams.toString()}`
  const response = await apiClient.get<ApiResponse<Appointment[]>>(url)
  return response.data.data
}

/**
 * Get a single appointment by ID
 */
export async function getAppointmentById(id: string): Promise<Appointment> {
  const response = await apiClient.get<ApiResponse<Appointment>>(`/appointments/${id}`)
  return response.data.data
}

/**
 * Get appointments by doctor
 */
export async function getAppointmentsByDoctor(
  doctorId: string,
  params?: { from?: string; to?: string; limit?: number; includeInactive?: boolean }
): Promise<Appointment[]> {
  const queryParams = new URLSearchParams()

  if (params?.from) queryParams.set('from', params.from)
  if (params?.to) queryParams.set('to', params.to)
  if (params?.limit) queryParams.set('limit', String(params.limit))
  if (params?.includeInactive) queryParams.set('includeInactive', 'true')

  const queryString = queryParams.toString()
  const url = `/appointments/by-doctor/${doctorId}${queryString ? `?${queryString}` : ''}`

  const response = await apiClient.get<ApiResponse<Appointment[]>>(url)
  return response.data.data
}

/**
 * Get appointments by patient
 */
export async function getAppointmentsByPatient(
  patientId: string,
  params?: { limit?: number; includeInactive?: boolean }
): Promise<Appointment[]> {
  const queryParams = new URLSearchParams()

  if (params?.limit) queryParams.set('limit', String(params.limit))
  if (params?.includeInactive) queryParams.set('includeInactive', 'true')

  const queryString = queryParams.toString()
  const url = `/appointments/by-patient/${patientId}${queryString ? `?${queryString}` : ''}`

  const response = await apiClient.get<ApiResponse<Appointment[]>>(url)
  return response.data.data
}

/**
 * Get appointment statistics
 */
export async function getAppointmentStats(params?: StatsParams): Promise<AppointmentStats> {
  const queryParams = new URLSearchParams()

  if (params?.from) queryParams.set('from', params.from)
  if (params?.to) queryParams.set('to', params.to)
  if (params?.doctorId) queryParams.set('doctorId', params.doctorId)

  const queryString = queryParams.toString()
  const url = `/appointments/stats${queryString ? `?${queryString}` : ''}`

  const response = await apiClient.get<ApiResponse<AppointmentStats>>(url)
  return response.data.data
}

/**
 * Create a new appointment
 */
export async function createAppointment(data: CreateAppointmentData): Promise<Appointment> {
  const response = await apiClient.post<ApiResponse<Appointment>>('/appointments', data)
  return response.data.data
}

/**
 * Update an existing appointment
 */
export async function updateAppointment(id: string, data: UpdateAppointmentData): Promise<Appointment> {
  const response = await apiClient.put<ApiResponse<Appointment>>(`/appointments/${id}`, data)
  return response.data.data
}

/**
 * Soft delete an appointment
 */
export async function deleteAppointment(id: string): Promise<void> {
  await apiClient.delete(`/appointments/${id}`)
}

/**
 * Restore a soft-deleted appointment
 */
export async function restoreAppointment(id: string): Promise<Appointment> {
  const response = await apiClient.put<ApiResponse<Appointment>>(`/appointments/${id}/restore`)
  return response.data.data
}

/**
 * Mark an appointment as done/completed. `executedBudgetItemIds` confirms
 * which SCHEDULED-linked budget items were executed in this appointment;
 * items not listed stay SCHEDULED (default = execute none).
 */
export async function markAppointmentDone(
  id: string,
  notes?: string,
  executedBudgetItemIds?: string[]
): Promise<Appointment> {
  const response = await apiClient.put<ApiResponse<Appointment>>(`/appointments/${id}/mark-done`, {
    notes,
    executedBudgetItemIds,
  })
  return response.data.data
}

/**
 * Get the budget items currently associated to an appointment (any role),
 * for edit/completion hydration.
 */
export async function getAppointmentBudgetItems(id: string): Promise<AppointmentBudgetItemSummary[]> {
  const response = await apiClient.get<ApiResponse<AppointmentBudgetItemSummary[]>>(
    `/appointments/${id}/budget-items`
  )
  return response.data.data
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get human-readable status label
 */
export function getStatusLabel(status: AppointmentStatus): string {
  const labels: Record<AppointmentStatus, string> = {
    SCHEDULED: 'Programada',
    CONFIRMED: 'Confirmada',
    IN_PROGRESS: 'En Progreso',
    COMPLETED: 'Completada',
    CANCELLED: 'Cancelada',
    NO_SHOW: 'No Asistió',
    RESCHEDULED: 'Reprogramada',
  }
  return labels[status] || status
}

/**
 * Get status color for styling
 */
export function getStatusColor(status: AppointmentStatus): string {
  const colors: Record<AppointmentStatus, string> = {
    SCHEDULED: 'blue',
    CONFIRMED: 'green',
    IN_PROGRESS: 'yellow',
    COMPLETED: 'emerald',
    CANCELLED: 'red',
    NO_SHOW: 'gray',
    RESCHEDULED: 'purple',
  }
  return colors[status] || 'gray'
}

/**
 * Get i18n key for appointment status (matches keys in appointments.status.*)
 */
export function getStatusI18nKey(status: AppointmentStatus): string {
  const keys: Record<AppointmentStatus, string> = {
    SCHEDULED: 'scheduled',
    CONFIRMED: 'confirmed',
    IN_PROGRESS: 'inProgress',
    COMPLETED: 'completed',
    CANCELLED: 'cancelled',
    NO_SHOW: 'noShow',
    RESCHEDULED: 'rescheduled',
  }
  return keys[status] || status.toLowerCase()
}

/**
 * Get Tailwind CSS classes for status badge
 */
export function getStatusBadgeClasses(status: AppointmentStatus): string {
  const classes: Record<AppointmentStatus, string> = {
    SCHEDULED: 'bg-blue-100 text-blue-800',
    CONFIRMED: 'bg-green-100 text-green-800',
    IN_PROGRESS: 'bg-yellow-100 text-yellow-800',
    COMPLETED: 'bg-emerald-100 text-emerald-800',
    CANCELLED: 'bg-red-100 text-red-800',
    NO_SHOW: 'bg-gray-100 text-gray-800',
    RESCHEDULED: 'bg-purple-100 text-purple-800',
  }
  return classes[status] || 'bg-gray-100 text-gray-800'
}

/**
 * Format appointment time range
 */
export function formatTimeRange(startTime: string, endTime: string): string {
  const start = new Date(startTime)
  const end = new Date(endTime)

  const timeFormat: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' }

  return `${start.toLocaleTimeString(i18n.language, timeFormat)} - ${end.toLocaleTimeString(i18n.language, timeFormat)}`
}

/**
 * Format appointment date
 */
export function formatAppointmentDate(startTime: string): string {
  const date = new Date(startTime)
  return date.toLocaleDateString(i18n.language, {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

/**
 * Check if appointment is in the past
 */
export function isAppointmentPast(endTime: string): boolean {
  return new Date(endTime) < new Date()
}

/**
 * Check if appointment is today
 */
export function isAppointmentToday(startTime: string): boolean {
  const today = new Date()
  const appointmentDate = new Date(startTime)
  return (
    today.getFullYear() === appointmentDate.getFullYear() &&
    today.getMonth() === appointmentDate.getMonth() &&
    today.getDate() === appointmentDate.getDate()
  )
}

/**
 * Get patient full name from appointment
 */
export function getAppointmentPatientName(appointment: Appointment): string {
  if (!appointment.patient) return 'Unknown Patient'
  return `${appointment.patient.firstName} ${appointment.patient.lastName}`
}

/**
 * Get doctor full name from appointment
 */
export function getAppointmentDoctorName(appointment: Appointment): string {
  if (!appointment.doctor) return 'Unknown Doctor'
  return `${appointment.doctor.firstName} ${appointment.doctor.lastName}`
}

/**
 * Format cost as currency
 */
export function formatCost(cost: number | null, currency = 'USD'): string {
  if (cost === null) return '-'
  return formatCurrency(cost, currency)
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

export function isAppointmentApiError(error: unknown): error is { response: { data: ApiErrorResponse } } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'response' in error &&
    typeof (error as { response?: unknown }).response === 'object' &&
    (error as { response: { data?: unknown } }).response?.data !== undefined
  )
}

const APPOINTMENT_ERROR_KEY_MAP: Record<string, string> = {
  TIME_CONFLICT: 'appointments.errors.timeConflict',
  INVALID_PATIENT: 'appointments.errors.invalidPatient',
  INVALID_DOCTOR: 'appointments.errors.invalidDoctor',
  INVALID_TIME_RANGE: 'appointments.errors.invalidTimeRange',
  CANNOT_UNMARK_PAID: 'appointments.errors.cannotUnmarkPaid',
  EXCEEDS_BALANCE: 'appointments.errors.exceedsBalance',
  PAYMENT_FAILED: 'appointments.errors.paymentFailed',
}

// Use the language i18next actually resolved (saved preference in
// localStorage, otherwise the browser language), so error messages produced
// by this non-React module match what the rest of the UI is showing instead
// of reading localStorage directly and defaulting to Spanish.
function getUserLanguage(): string {
  return i18n.resolvedLanguage || i18n.language || 'es'
}

export function getAppointmentApiErrorMessage(error: unknown): string {
  const lng = getUserLanguage()

  if (isAppointmentApiError(error)) {
    const code = error.response.data.error?.code

    if (code && APPOINTMENT_ERROR_KEY_MAP[code]) {
      return i18n.t(APPOINTMENT_ERROR_KEY_MAP[code], { lng })
    }

    return error.response.data.error?.message || i18n.t('appointments.errors.unexpected', { lng })
  }
  if (error instanceof Error) {
    return error.message
  }
  return i18n.t('appointments.errors.unexpected', { lng })
}
