import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  settingsApi,
  type TenantSettings,
  type TenantProfile,
} from './settings-api'
import { apiClient } from './api'

vi.mock('./api', () => ({
  apiClient: {
    get: vi.fn(),
    put: vi.fn(),
  },
}))

const mockSettings: TenantSettings = {
  id: 'settings-123',
  language: 'es',
  dateFormat: 'DD/MM/YYYY',
  timeFormat: '24h',
  defaultAppointmentDuration: 30,
  appointmentBuffer: 15,
  appointmentTypeDurations: [],
  businessHours: {
    monday: { start: '09:00', end: '18:00' },
    tuesday: { start: '09:00', end: '18:00' },
    wednesday: { start: '09:00', end: '18:00' },
    thursday: { start: '09:00', end: '18:00' },
    friday: { start: '09:00', end: '17:00' },
  },
  workingDays: [1, 2, 3, 4, 5],
  emailNotifications: true,
  smsNotifications: false,
  appointmentReminders: true,
  reminderHoursBefore: 24,
  autoLockMinutes: 0,
  updatedAt: '2024-01-15T00:00:00Z',
}

const mockTenantProfile: TenantProfile = {
  id: 'tenant-123',
  name: 'Dental Clinic',
  slug: 'dental-clinic',
  email: 'clinic@example.com',
  phone: '+1234567890',
  address: '123 Main St, City',
  logo: 'https://example.com/logo.png',
  timezone: 'America/New_York',
  currency: 'USD',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-15T00:00:00Z',
}

describe('settings-api', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('settingsApi.getSettings', () => {
    it('should fetch tenant settings', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: { settings: mockSettings },
      })

      const result = await settingsApi.getSettings()

      expect(apiClient.get).toHaveBeenCalledWith('/settings')
      expect(result).toEqual(mockSettings)
    })

    it('should throw error on fetch failure', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(new Error('Unauthorized'))

      await expect(settingsApi.getSettings()).rejects.toThrow('Unauthorized')
    })
  })

  describe('settingsApi.updateSettings', () => {
    it('should update tenant settings', async () => {
      const updatedSettings = { ...mockSettings, language: 'en' as const }
      vi.mocked(apiClient.put).mockResolvedValue({
        data: { message: 'Settings updated', settings: updatedSettings },
      })

      const result = await settingsApi.updateSettings({ language: 'en' })

      expect(apiClient.put).toHaveBeenCalledWith('/settings', { language: 'en' })
      expect(result.language).toBe('en')
    })

    it('should update multiple settings', async () => {
      const updatedSettings = {
        ...mockSettings,
        timeFormat: '12h' as const,
        defaultAppointmentDuration: 45,
      }
      vi.mocked(apiClient.put).mockResolvedValue({
        data: { message: 'Settings updated', settings: updatedSettings },
      })

      const result = await settingsApi.updateSettings({
        timeFormat: '12h',
        defaultAppointmentDuration: 45,
      })

      expect(apiClient.put).toHaveBeenCalledWith('/settings', {
        timeFormat: '12h',
        defaultAppointmentDuration: 45,
      })
      expect(result.timeFormat).toBe('12h')
      expect(result.defaultAppointmentDuration).toBe(45)
    })

    it('should update notification settings', async () => {
      const updatedSettings = { ...mockSettings, emailNotifications: false, smsNotifications: true }
      vi.mocked(apiClient.put).mockResolvedValue({
        data: { message: 'Settings updated', settings: updatedSettings },
      })

      const result = await settingsApi.updateSettings({
        emailNotifications: false,
        smsNotifications: true,
      })

      expect(result.emailNotifications).toBe(false)
      expect(result.smsNotifications).toBe(true)
    })

    it('should throw error on update failure', async () => {
      vi.mocked(apiClient.put).mockRejectedValue(new Error('Forbidden'))

      await expect(settingsApi.updateSettings({ language: 'en' })).rejects.toThrow('Forbidden')
    })
  })

  describe('settingsApi.getTenantProfile', () => {
    it('should fetch tenant profile', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: { tenant: mockTenantProfile },
      })

      const result = await settingsApi.getTenantProfile()

      expect(apiClient.get).toHaveBeenCalledWith('/tenant/profile')
      expect(result).toEqual(mockTenantProfile)
    })

    it('should throw error on fetch failure', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(new Error('Not found'))

      await expect(settingsApi.getTenantProfile()).rejects.toThrow('Not found')
    })
  })

  describe('settingsApi.updateTenantProfile', () => {
    it('should update tenant profile', async () => {
      const updatedProfile = { ...mockTenantProfile, name: 'New Clinic Name' }
      vi.mocked(apiClient.put).mockResolvedValue({
        data: { message: 'Profile updated', tenant: updatedProfile },
      })

      const result = await settingsApi.updateTenantProfile({ name: 'New Clinic Name' })

      expect(apiClient.put).toHaveBeenCalledWith('/tenant/profile', { name: 'New Clinic Name' })
      expect(result.name).toBe('New Clinic Name')
    })

    it('should update contact information', async () => {
      const updatedProfile = {
        ...mockTenantProfile,
        email: 'new@example.com',
        phone: '+9876543210',
      }
      vi.mocked(apiClient.put).mockResolvedValue({
        data: { message: 'Profile updated', tenant: updatedProfile },
      })

      const result = await settingsApi.updateTenantProfile({
        email: 'new@example.com',
        phone: '+9876543210',
      })

      expect(result.email).toBe('new@example.com')
      expect(result.phone).toBe('+9876543210')
    })

    it('should update timezone and currency', async () => {
      const updatedProfile = {
        ...mockTenantProfile,
        timezone: 'Europe/London',
        currency: 'EUR',
      }
      vi.mocked(apiClient.put).mockResolvedValue({
        data: { message: 'Profile updated', tenant: updatedProfile },
      })

      const result = await settingsApi.updateTenantProfile({
        timezone: 'Europe/London',
        currency: 'EUR',
      })

      expect(result.timezone).toBe('Europe/London')
      expect(result.currency).toBe('EUR')
    })

    it('should clear optional fields with null', async () => {
      const updatedProfile = { ...mockTenantProfile, phone: null, address: null }
      vi.mocked(apiClient.put).mockResolvedValue({
        data: { message: 'Profile updated', tenant: updatedProfile },
      })

      const result = await settingsApi.updateTenantProfile({
        phone: null,
        address: null,
      })

      expect(result.phone).toBeNull()
      expect(result.address).toBeNull()
    })

    it('should throw error on update failure', async () => {
      vi.mocked(apiClient.put).mockRejectedValue(new Error('Forbidden - Owner only'))

      await expect(settingsApi.updateTenantProfile({ name: 'Test' })).rejects.toThrow(
        'Forbidden - Owner only'
      )
    })
  })
})
