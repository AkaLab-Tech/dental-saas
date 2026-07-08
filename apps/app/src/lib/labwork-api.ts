import { apiClient } from './api'

// ============================================================================
// Types
// ============================================================================

export interface Labwork {
  id: string
  tenantId: string
  patientId: string | null
  appointmentId: string | null
  priceIncludedInAppointment: boolean
  lab: string
  phoneNumber: string | null
  date: string
  note: string | null
  price: number
  isPaid: boolean
  isDelivered: boolean
  doctorIds: string[]
  isActive: boolean
  deletedAt: string | null
  createdAt: string
  updatedAt: string
  patient?: {
    id: string
    firstName: string
    lastName: string
    email: string | null
    phone: string | null
  } | null
}

export interface LabworkStats {
  total: number
  paid: number
  unpaid: number
  delivered: number
  pending: number
  totalValue: number
  paidValue: number
  unpaidValue: number
}

export interface CreateLabworkData {
  patientId?: string
  appointmentId?: string
  priceIncludedInAppointment?: boolean
  lab: string
  phoneNumber?: string
  date: string
  note?: string
  price?: number
  isPaid?: boolean
  isDelivered?: boolean
  doctorIds?: string[]
}

export interface UpdateLabworkData {
  patientId?: string | null
  appointmentId?: string | null
  priceIncludedInAppointment?: boolean
  lab?: string
  phoneNumber?: string | null
  date?: string
  note?: string | null
  price?: number
  isPaid?: boolean
  isDelivered?: boolean
  doctorIds?: string[]
}

export interface LabworkListParams {
  limit?: number
  offset?: number
  search?: string
  patientId?: string
  isPaid?: boolean
  isDelivered?: boolean
  from?: string
  to?: string
  includeInactive?: boolean
}

interface LabworkListResponse {
  success: boolean
  data: Labwork[]
  pagination: {
    total: number
    limit: number
    offset: number
  }
}

interface LabworkResponse {
  success: boolean
  data: Labwork
}

interface LabworkStatsResponse {
  success: boolean
  data: LabworkStats
}

interface LabNamesResponse {
  success: boolean
  data: string[]
}

// ============================================================================
// API Functions
// ============================================================================

export async function getLabworks(params?: LabworkListParams): Promise<LabworkListResponse> {
  const searchParams = new URLSearchParams()

  if (params?.limit) searchParams.set('limit', String(params.limit))
  if (params?.offset) searchParams.set('offset', String(params.offset))
  if (params?.search) searchParams.set('search', params.search)
  if (params?.patientId) searchParams.set('patientId', params.patientId)
  if (params?.isPaid !== undefined) searchParams.set('isPaid', String(params.isPaid))
  if (params?.isDelivered !== undefined) searchParams.set('isDelivered', String(params.isDelivered))
  if (params?.from) searchParams.set('from', params.from)
  if (params?.to) searchParams.set('to', params.to)
  if (params?.includeInactive) searchParams.set('includeInactive', 'true')

  const query = searchParams.toString()
  const url = query ? `/labworks?${query}` : '/labworks'

  const response = await apiClient.get<LabworkListResponse>(url)
  return response.data
}

export async function getLabworkById(id: string): Promise<LabworkResponse> {
  const response = await apiClient.get<LabworkResponse>(`/labworks/${id}`)
  return response.data
}

export async function createLabwork(data: CreateLabworkData): Promise<LabworkResponse> {
  const response = await apiClient.post<LabworkResponse>('/labworks', data)
  return response.data
}

export async function updateLabwork(id: string, data: UpdateLabworkData): Promise<LabworkResponse> {
  const response = await apiClient.put<LabworkResponse>(`/labworks/${id}`, data)
  return response.data
}

export async function deleteLabwork(id: string): Promise<LabworkResponse> {
  const response = await apiClient.delete<LabworkResponse>(`/labworks/${id}`)
  return response.data
}

export async function restoreLabwork(id: string): Promise<LabworkResponse> {
  const response = await apiClient.put<LabworkResponse>(`/labworks/${id}/restore`)
  return response.data
}

export async function getLabworkStats(params?: { from?: string; to?: string }): Promise<LabworkStatsResponse> {
  const searchParams = new URLSearchParams()
  if (params?.from) searchParams.set('from', params.from)
  if (params?.to) searchParams.set('to', params.to)

  const query = searchParams.toString()
  const url = query ? `/labworks/stats?${query}` : '/labworks/stats'

  const response = await apiClient.get<LabworkStatsResponse>(url)
  return response.data
}

export async function getLabNames(): Promise<LabNamesResponse> {
  const response = await apiClient.get<LabNamesResponse>('/labworks/labs')
  return response.data
}

// ============================================================================
// Utility Functions
// ============================================================================

export function formatLabworkDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('es-ES', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export function getLabworkStatusBadge(labwork: Labwork): { label: string; variant: 'default' | 'success' | 'warning' | 'destructive' } {
  if (!labwork.isActive) {
    return { label: 'Eliminado', variant: 'destructive' }
  }
  if (labwork.isDelivered && labwork.isPaid) {
    return { label: 'Completado', variant: 'success' }
  }
  if (labwork.isDelivered) {
    return { label: 'Entregado', variant: 'default' }
  }
  if (labwork.isPaid) {
    return { label: 'Pagado', variant: 'warning' }
  }
  return { label: 'Pendiente', variant: 'warning' }
}
