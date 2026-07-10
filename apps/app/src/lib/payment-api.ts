import { apiClient } from './api'

// ============================================================================
// Types
// ============================================================================

export interface Payment {
  id: string
  tenantId: string
  patientId: string
  amount: number
  date: string
  note: string | null
  createdBy: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface PatientBalance {
  totalDebt: number
  totalPaid: number
  outstanding: number
  credit: number
}

export interface CreatePaymentData {
  amount: number
  date: string
  note?: string
}

interface PaymentListResponse {
  success: boolean
  data: Payment[]
  pagination: {
    total: number
    limit: number
    offset: number
  }
}

interface BalanceResponse {
  success: boolean
  data: PatientBalance
}

interface PaymentResponse {
  success: boolean
  data: Payment
}

// ============================================================================
// API Functions
// ============================================================================

export async function getPatientBalance(patientId: string): Promise<PatientBalance> {
  const response = await apiClient.get<BalanceResponse>(`/patients/${patientId}/balance`)
  return response.data.data
}

export async function getPatientPayments(
  patientId: string,
  params?: { limit?: number; offset?: number }
): Promise<PaymentListResponse> {
  const queryParams = new URLSearchParams()

  if (params?.limit) queryParams.set('limit', String(params.limit))
  if (params?.offset) queryParams.set('offset', String(params.offset))

  const queryString = queryParams.toString()
  const url = `/patients/${patientId}/payments${queryString ? `?${queryString}` : ''}`

  const response = await apiClient.get<PaymentListResponse>(url)
  return response.data
}

export async function createPayment(
  patientId: string,
  data: CreatePaymentData
): Promise<Payment> {
  const response = await apiClient.post<PaymentResponse>(
    `/patients/${patientId}/payments`,
    data
  )
  return response.data.data
}

export async function deletePayment(
  patientId: string,
  paymentId: string
): Promise<void> {
  await apiClient.delete(`/patients/${patientId}/payments/${paymentId}`)
}
