import { apiClient } from './api'

// ============================================================================
// Types
// ============================================================================

export type BudgetStatus = 'DRAFT' | 'APPROVED' | 'PARTIAL' | 'COMPLETED' | 'CANCELLED'

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

export async function getBudget(budgetId: string): Promise<Budget> {
  const response = await apiClient.get<ApiResponse<Budget>>(`/budgets/${budgetId}`)
  return response.data.data
}

export async function createBudget(
  patientId: string,
  data: CreateBudgetData
): Promise<Budget> {
  const response = await apiClient.post<ApiResponse<Budget>>(
    `/patients/${patientId}/budgets`,
    data
  )
  return response.data.data
}

export async function updateBudget(
  budgetId: string,
  data: UpdateBudgetData
): Promise<Budget> {
  const response = await apiClient.patch<ApiResponse<Budget>>(`/budgets/${budgetId}`, data)
  return response.data.data
}

export async function deleteBudget(budgetId: string): Promise<Budget> {
  const response = await apiClient.delete<ApiResponse<Budget>>(`/budgets/${budgetId}`)
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
): Promise<Budget> {
  const response = await apiClient.post<ApiResponse<Budget>>(
    `/budgets/${budgetId}/items`,
    item
  )
  return response.data.data
}

export async function updateBudgetItem(
  budgetId: string,
  itemId: string,
  data: UpdateBudgetItemData
): Promise<Budget> {
  const response = await apiClient.patch<ApiResponse<Budget>>(
    `/budgets/${budgetId}/items/${itemId}`,
    data
  )
  return response.data.data
}

export async function deleteBudgetItem(
  budgetId: string,
  itemId: string
): Promise<Budget> {
  const response = await apiClient.delete<ApiResponse<Budget>>(
    `/budgets/${budgetId}/items/${itemId}`
  )
  return response.data.data
}

// ============================================================================
// Helpers
// ============================================================================

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
