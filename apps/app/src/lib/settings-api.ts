import { apiClient } from './api'

// ============================================================================
// Types
// ============================================================================

export interface TenantSettings {
  id: string
  language: 'es' | 'en' | 'pt'
  dateFormat: 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD'
  timeFormat: '12h' | '24h'
  defaultAppointmentDuration: number
  appointmentBuffer: number
  businessHours: Record<string, { start: string; end: string }>
  workingDays: number[]
  emailNotifications: boolean
  smsNotifications: boolean
  appointmentReminders: boolean
  reminderHoursBefore: number
  autoLockMinutes: number
  updatedAt: string
}

export interface TenantProfile {
  id: string
  name: string
  slug: string
  email: string
  phone: string | null
  address: string | null
  logo: string | null
  timezone: string
  currency: string
  createdAt: string
  updatedAt: string
}

export interface UpdateSettingsData {
  language?: 'es' | 'en' | 'pt'
  dateFormat?: 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD'
  timeFormat?: '12h' | '24h'
  defaultAppointmentDuration?: number
  appointmentBuffer?: number
  businessHours?: Record<string, { start: string; end: string }>
  workingDays?: number[]
  emailNotifications?: boolean
  smsNotifications?: boolean
  appointmentReminders?: boolean
  reminderHoursBefore?: number
  autoLockMinutes?: number
}

export interface UpdateTenantProfileData {
  name?: string
  email?: string
  phone?: string | null
  address?: string | null
  logo?: string | null
  timezone?: string
  currency?: string
}

// ============================================================================
// Settings API
// ============================================================================

export const settingsApi = {
  /**
   * Get tenant settings
   */
  async getSettings(): Promise<TenantSettings> {
    const response = await apiClient.get<{ settings: TenantSettings }>('/settings')
    return response.data.settings
  },

  /**
   * Update tenant settings (OWNER/ADMIN only)
   */
  async updateSettings(data: UpdateSettingsData): Promise<TenantSettings> {
    const response = await apiClient.put<{ message: string; settings: TenantSettings }>(
      '/settings',
      data
    )
    return response.data.settings
  },

  /**
   * Get tenant profile
   */
  async getTenantProfile(): Promise<TenantProfile> {
    const response = await apiClient.get<{ tenant: TenantProfile }>('/tenant/profile')
    return response.data.tenant
  },

  /**
   * Update tenant profile (OWNER only)
   */
  async updateTenantProfile(data: UpdateTenantProfileData): Promise<TenantProfile> {
    const response = await apiClient.put<{ message: string; tenant: TenantProfile }>(
      '/tenant/profile',
      data
    )
    return response.data.tenant
  },
}
