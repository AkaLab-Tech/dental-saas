import { apiClient } from './api'

// ============================================================================
// Types
// ============================================================================

/**
 * Task #461: a recorded actor, resolved by the API for display. `null` (where a
 * field allows it) means the actor was never recorded; `removed` means a user
 * who no longer exists. The two must never render alike.
 */
export type ActorView =
  | { kind: 'user'; name: string; active: boolean }
  | { kind: 'removed' }
  | { kind: 'system' }

export interface Payment {
  id: string
  tenantId: string
  patientId: string
  amount: number
  date: string
  note: string | null
  createdBy: string | null
  isActive: boolean
  /**
   * Task #392: set only when the list was requested with includeReversed.
   * `actor`/`reason` are null for a reversal recorded before #392 — the actor is
   * genuinely unrecoverable and a placeholder would read as a record.
   */
  reversal?: { at: string; actor: ActorView | null; reason: string | null } | null
  kind: 'APPOINTMENT' | 'ADVANCE'
  appointmentId: string | null
  createdAt: string
  updatedAt: string
}

export interface PatientBalance {
  totalDebt: number
  totalPaid: number
  outstanding: number
  credit: number
}

// The three numbers are deliberately kept apart: remainingBudgetProjection is
// a projection of planned work, never debt, and must never be folded into any
// other field or summed with them in the UI (mirrors apps/api's
// PatientAccountStatement).
export interface AccountStatement {
  appointmentsDebt: number
  advancesCredit: number
  remainingBudgetProjection: number
  totalBilled: number
  totalPaid: number
  advancesTotal: number
}

export interface CreatePaymentData {
  amount: number
  date: string
  note?: string
}

export interface Debtor {
  patientId: string
  name: string
  totalDebt: number
  totalPaid: number
  outstanding: number
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

interface AccountStatementResponse {
  success: boolean
  data: AccountStatement
}

interface PaymentResponse {
  success: boolean
  data: Payment
}

interface DebtorsResponse {
  success: boolean
  data: Debtor[]
}

// ============================================================================
// API Functions
// ============================================================================

export async function getPatientBalance(patientId: string): Promise<PatientBalance> {
  const response = await apiClient.get<BalanceResponse>(`/patients/${patientId}/balance`)
  return response.data.data
}

export async function getAccountStatement(patientId: string): Promise<AccountStatement> {
  const response = await apiClient.get<AccountStatementResponse>(`/patients/${patientId}/statement`)
  return response.data.data
}

export async function getPatientPayments(
  patientId: string,
  params?: {
    limit?: number
    offset?: number
    kind?: 'APPOINTMENT' | 'ADVANCE'
    /** Task #392: also return reversed payments, marked rather than hidden. */
    includeReversed?: boolean
  }
): Promise<PaymentListResponse> {
  const queryParams = new URLSearchParams()

  if (params?.limit) queryParams.set('limit', String(params.limit))
  if (params?.offset) queryParams.set('offset', String(params.offset))
  if (params?.kind) queryParams.set('kind', params.kind)
  if (params?.includeReversed) queryParams.set('includeReversed', 'true')

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

/**
 * Task #392: reversing a payment requires a reason. Sent as a DELETE body —
 * express.json() parses it and axios supports it — rather than a query string,
 * so operator-written free text never lands in a URL or a server access log.
 */
export async function deletePayment(
  patientId: string,
  paymentId: string,
  reason: string
): Promise<void> {
  await apiClient.delete(`/patients/${patientId}/payments/${paymentId}`, {
    data: { reason },
  })
}

export async function getDebtors(): Promise<Debtor[]> {
  const response = await apiClient.get<DebtorsResponse>('/patients/debts')
  return response.data.data
}
