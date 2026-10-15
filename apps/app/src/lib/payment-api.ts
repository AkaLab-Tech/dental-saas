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
  /**
   * Task #571: money still held for open reservations (the API's own
   * `heldCents`, already held back from advancesCredit). Present exactly when
   * `reservedAdvances` is — never re-derived in the UI, or the two drift.
   */
  advancesHeld?: number
  /** Task #529: one row per budget this patient has advances reserved to. */
  reservedAdvances?: ReservedAdvanceBalance[]
}

/** Mirrors apps/api's ReservedAdvanceBalance. */
export interface ReservedAdvanceBalance {
  budgetId: string
  reserved: number
  consumed: number
  remaining: number
  /** false once the budget is complete/cancelled/deleted. */
  open: boolean
}

export interface CreatePaymentData {
  amount: number
  date: string
  note?: string
  /** Reserve the advance to one of the patient's open budgets; omit for a general advance. */
  budgetId?: string
}

/** Task #453: one row of the patient's payment-movements ledger. */
export type PaymentMovementType =
  | 'RECEIVED'
  | 'REVERSED'
  | 'CONVERTED_TO_ADVANCE'
  | 'RESTORED_TO_APPOINTMENT'

export interface PaymentMovement {
  type: PaymentMovementType
  at: string
  amount: number
  paymentId: string
  appointmentId: string | null
  /** The origin appointment's date, present whenever appointmentId is. */
  appointmentDate: string | null
  actor: ActorView | null
  reason: string | null
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

interface PaymentMovementsResponse {
  success: boolean
  data: PaymentMovement[]
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
 * The payments-create endpoint answers failures with `error` as a bare string
 * (other endpoints send `{ message, code }`), so both shapes are read here.
 *
 * A 404 is replaced by `notFoundMessage` when given. The server's text for it
 * ("Budget not found for this patient") is false for a budget that was merely
 * deactivated: the budget lookup filters on `isActive` inside its `where`, so
 * a deactivated budget falls through to the same not-found answer while the
 * user is still looking at it in a stale option list. This endpoint sends no
 * error code, so the override is keyed on the status. The caller owns that
 * choice: it is only correct for a form whose sole 404 means "the selected
 * budget is gone". The 400 (budget already completed or cancelled) keeps the
 * server's text, which is truthful as it stands.
 */
export function getPaymentApiErrorMessage(
  error: unknown,
  fallback: string,
  notFoundMessage?: string
): string {
  const status = (error as { response?: { status?: unknown } } | null)?.response?.status
  if (status === 404 && notFoundMessage) return notFoundMessage
  const serverError = (error as { response?: { data?: { error?: unknown } } } | null)?.response
    ?.data?.error
  if (typeof serverError === 'string' && serverError) return serverError
  const nested = (serverError as { message?: unknown } | undefined)?.message
  if (typeof nested === 'string' && nested) return nested
  return error instanceof Error ? error.message : fallback
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

/**
 * Task #453: the interleaved chronological ledger of payments received plus
 * every REVERSED / CONVERTED_TO_ADVANCE / RESTORED_TO_APPOINTMENT transition,
 * newest first. `from`/`to` are ISO datetime strings (the caller converts a
 * bare date to local start/end-of-day before calling this) — a bare
 * YYYY-MM-DD is still accepted by the API for direct callers.
 */
export async function getPatientPaymentMovements(
  patientId: string,
  params?: { from?: string; to?: string }
): Promise<PaymentMovement[]> {
  const queryParams = new URLSearchParams()
  if (params?.from) queryParams.set('from', params.from)
  if (params?.to) queryParams.set('to', params.to)

  const queryString = queryParams.toString()
  const url = `/patients/${patientId}/payment-movements${queryString ? `?${queryString}` : ''}`

  const response = await apiClient.get<PaymentMovementsResponse>(url)
  return response.data.data
}
