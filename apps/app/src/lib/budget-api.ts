import { apiClient } from './api'

// ============================================================================
// Types
// ============================================================================

export type BudgetStatus = 'DRAFT' | 'APPROVED' | 'PARTIAL' | 'COMPLETED' | 'CANCELLED'

// `PARTIAL` and `COMPLETED` are derived by the backend from item states
// (see `deriveBudgetStatus` in `budget.service.ts`) and are normalized on
// every write, so they must not appear as user-selectable options.
export const USER_SETTABLE_BUDGET_STATUSES = [
  'DRAFT',
  'APPROVED',
  'CANCELLED',
] as const satisfies readonly BudgetStatus[]

export type BudgetItemStatus =
  | 'PENDING'
  | 'SCHEDULED'
  | 'IN_PROGRESS'
  | 'EXECUTED'
  | 'CANCELLED'

export interface BudgetItem {
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
  createdAt: string
  updatedAt: string
}

export interface BudgetMoney {
  total: number
  billed: number
  covered: number
  remaining: number
  notBilled: number
}

export interface Budget {
  id: string
  tenantId: string
  patientId: string
  createdById: string | null
  status: BudgetStatus
  notes: string | null
  validUntil: string | null
  totalAmount: string
  publicToken: string | null
  publicTokenExpiresAt: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
  items: BudgetItem[]
  money: BudgetMoney
}

export interface BudgetVisit {
  appointmentId: string
  date: string
  lines: { budgetItemId: string; description: string; notes: string | null }[]
  charged: number
  covered: number
}

/** Single-budget shape; the list route returns plain `Budget`. */
export interface BudgetWithVisits extends Budget {
  visits: BudgetVisit[]
}

export interface BudgetItemInput {
  description: string
  toothNumber?: string | null
  quantity: number
  unitPrice: number
  plannedAppointmentType?: string | null
  notes?: string | null
  order?: number
}

export interface CreateBudgetData {
  notes?: string | null
  validUntil?: string | null
  status?: BudgetStatus
  items: BudgetItemInput[]
}

export interface UpdateBudgetData {
  notes?: string | null
  validUntil?: string | null
  status?: BudgetStatus
}

export interface UpdateBudgetItemData {
  description?: string
  toothNumber?: string | null
  quantity?: number
  unitPrice?: number
  plannedAppointmentType?: string | null
  notes?: string | null
  order?: number
  status?: BudgetItemStatus
}

export interface ListBudgetsByPatientParams {
  limit?: number
  offset?: number
  includeInactive?: boolean
}

interface ApiResponse<T> {
  success: boolean
  data: T
  pagination?: {
    total: number
    limit: number
    offset: number
  }
}

// ============================================================================
// Budget CRUD
// ============================================================================

export async function listBudgetsByPatient(
  patientId: string,
  params?: ListBudgetsByPatientParams
): Promise<{ data: Budget[]; total: number }> {
  const response = await apiClient.get<ApiResponse<Budget[]>>(
    `/patients/${patientId}/budgets`,
    { params }
  )
  return {
    data: response.data.data,
    total: response.data.pagination?.total ?? response.data.data.length,
  }
}

export async function getBudget(budgetId: string): Promise<BudgetWithVisits> {
  const response = await apiClient.get<ApiResponse<BudgetWithVisits>>(`/budgets/${budgetId}`)
  return response.data.data
}

export async function createBudget(
  patientId: string,
  data: CreateBudgetData
): Promise<BudgetWithVisits> {
  const response = await apiClient.post<ApiResponse<BudgetWithVisits>>(
    `/patients/${patientId}/budgets`,
    data
  )
  return response.data.data
}

export async function updateBudget(
  budgetId: string,
  data: UpdateBudgetData
): Promise<BudgetWithVisits> {
  const response = await apiClient.patch<ApiResponse<BudgetWithVisits>>(`/budgets/${budgetId}`, data)
  return response.data.data
}

export async function deleteBudget(budgetId: string): Promise<BudgetWithVisits> {
  const response = await apiClient.delete<ApiResponse<BudgetWithVisits>>(`/budgets/${budgetId}`)
  return response.data.data
}

// ============================================================================
// Share link
// ============================================================================

export interface ShareBudgetData {
  expiresInDays?: number
}

export interface ShareBudgetResult {
  token: string
  url: string
  expiresAt: string | null
}

export async function shareBudget(
  budgetId: string,
  data?: ShareBudgetData
): Promise<ShareBudgetResult> {
  const response = await apiClient.post<ApiResponse<ShareBudgetResult>>(
    `/budgets/${budgetId}/share`,
    data ?? {}
  )
  return response.data.data
}

// ============================================================================
// Budget items
// ============================================================================

export async function addBudgetItem(
  budgetId: string,
  item: BudgetItemInput
): Promise<BudgetWithVisits> {
  const response = await apiClient.post<ApiResponse<BudgetWithVisits>>(
    `/budgets/${budgetId}/items`,
    item
  )
  return response.data.data
}

export async function updateBudgetItem(
  budgetId: string,
  itemId: string,
  data: UpdateBudgetItemData
): Promise<BudgetWithVisits> {
  const response = await apiClient.patch<ApiResponse<BudgetWithVisits>>(
    `/budgets/${budgetId}/items/${itemId}`,
    data
  )
  return response.data.data
}

export async function deleteBudgetItem(
  budgetId: string,
  itemId: string
): Promise<BudgetWithVisits> {
  const response = await apiClient.delete<ApiResponse<BudgetWithVisits>>(
    `/budgets/${budgetId}/items/${itemId}`
  )
  return response.data.data
}

// ============================================================================
// Helpers
// ============================================================================

// Statuses a user may pick for this budget. APPROVED is offered only when there
// are no active (non-CANCELLED) lines or none of them is EXECUTED: otherwise the
// backend derives PARTIAL (some executed) or COMPLETED (all executed) and the
// choice would not persist. PARTIAL and COMPLETED are never offered.
export function getSettableBudgetStatuses(budget: Pick<Budget, 'items'>): BudgetStatus[] {
  const active = budget.items.filter((i) => i.status !== 'CANCELLED')
  const anyExecuted = active.some((i) => i.status === 'EXECUTED')
  return USER_SETTABLE_BUDGET_STATUSES.filter((s) => !(anyExecuted && s === 'APPROVED'))
}

/**
 * Returns the amount of items in EXECUTED status vs the total. Useful for
 * progress indicators in list/card views.
 */
export function getExecutedItemsCount(budget: Pick<Budget, 'items'>): {
  executed: number
  total: number
} {
  const total = budget.items.length
  const executed = budget.items.filter((i) => i.status === 'EXECUTED').length
  return { executed, total }
}
