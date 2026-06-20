import { apiClient } from './api'

// ============================================================================
// Types
// ============================================================================

export interface UserProfile {
  id: string
  tenantId: string | null
  email: string
  firstName: string
  lastName: string
  role: string
  avatar: string | null
  phone: string | null
  hasPinSet: boolean
  emailVerified: boolean
  lastLoginAt: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface CreateUserData {
  email: string
  password: string
  firstName: string
  lastName: string
  role: 'ADMIN' | 'CLINIC_ADMIN' | 'DOCTOR' | 'STAFF'
  phone?: string
}

export interface CreateProfileData {
  profileOnly: true
  firstName: string
  lastName: string
  role: 'ADMIN' | 'CLINIC_ADMIN' | 'DOCTOR' | 'STAFF'
}

export interface UpdateUserData {
  email?: string
  firstName?: string
  lastName?: string
  phone?: string
  isActive?: boolean
}

export interface UserStats {
  counts: Record<string, number>
  limits: {
    maxAdmins: number
    maxDoctors: number
    maxPatients: number
  }
}

// ============================================================================
// API Functions
// ============================================================================

export async function listUsers(options?: {
  limit?: number
  offset?: number
  includeInactive?: boolean
}): Promise<UserProfile[]> {
  const params = new URLSearchParams()
  if (options?.limit) params.set('limit', String(options.limit))
  if (options?.offset) params.set('offset', String(options.offset))
  if (options?.includeInactive) params.set('includeInactive', 'true')
  const query = params.toString()
  const { data } = await apiClient.get(`/users${query ? `?${query}` : ''}`)
  return data.data
}

export async function getUserStats(): Promise<UserStats> {
  const { data } = await apiClient.get('/users/stats')
  return data.data
}

export async function createUser(payload: CreateUserData | CreateProfileData): Promise<UserProfile> {
  const { data } = await apiClient.post('/users', payload)
  return data.data
}

export async function updateUser(userId: string, payload: UpdateUserData): Promise<UserProfile> {
  const { data } = await apiClient.put(`/users/${userId}`, payload)
  return data.data
}

export async function updateUserRole(userId: string, role: string): Promise<UserProfile> {
  const { data } = await apiClient.put(`/users/${userId}/role`, { role })
  return data.data
}

export async function deleteUser(userId: string): Promise<void> {
  await apiClient.delete(`/users/${userId}`)
}

export async function setUserPin(userId: string, pin: string): Promise<void> {
  await apiClient.put(`/users/${userId}/pin`, { pin })
}
