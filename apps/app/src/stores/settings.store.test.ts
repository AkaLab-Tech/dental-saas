import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'
import { useSettingsStore } from './settings.store'
import type { TenantSettings, TenantProfile } from '@/lib/settings-api'

// Mock the settings-api module
vi.mock('@/lib/settings-api', () => ({
  settingsApi: {
    getSettings: vi.fn(),
    getTenantProfile: vi.fn(),
    updateSettings: vi.fn(),
    updateTenantProfile: vi.fn(),
  },
}))

// Import mocked functions
import { settingsApi } from '@/lib/settings-api'

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
  id: 'tenant-456',
  name: 'Test Clinic',
  slug: 'test-clinic',
  email: 'clinic@example.com',
  phone: '+1234567890',
  address: '123 Main St',
  logo: null,
  timezone: 'America/Los_Angeles',
  currency: 'USD',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-15T00:00:00Z',
}

describe('settings.store', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    useSettingsStore.setState({
      settings: null,
      tenantProfile: null,
      isLoading: false,
      isSaving: false,
      error: null,
      successMessage: null,
    })
    vi.clearAllMocks()
  })

  describe('initial state', () => {
    it('should have null settings', () => {
      const state = useSettingsStore.getState()
      expect(state.settings).toBeNull()
    })

    it('should have null tenantProfile', () => {
      const state = useSettingsStore.getState()
      expect(state.tenantProfile).toBeNull()
    })

    it('should not be loading', () => {
      const state = useSettingsStore.getState()
      expect(state.isLoading).toBe(false)
    })

    it('should not be saving', () => {
      const state = useSettingsStore.getState()
      expect(state.isSaving).toBe(false)
    })

    it('should have no error or success message', () => {
      const state = useSettingsStore.getState()
      expect(state.error).toBeNull()
      expect(state.successMessage).toBeNull()
    })
  })

  describe('fetchSettings', () => {
    it('should fetch settings successfully', async () => {
      ;(settingsApi.getSettings as Mock).mockResolvedValue(mockSettings)

      await useSettingsStore.getState().fetchSettings()

      const state = useSettingsStore.getState()
      expect(state.settings).toEqual(mockSettings)
      expect(state.isLoading).toBe(false)
    })

    it('should handle fetch error', async () => {
      ;(settingsApi.getSettings as Mock).mockRejectedValue(new Error('Network error'))

      await useSettingsStore.getState().fetchSettings()

      const state = useSettingsStore.getState()
      expect(state.error).toBe('Network error')
      expect(state.isLoading).toBe(false)
    })
  })

  describe('fetchTenantProfile', () => {
    it('should fetch tenant profile successfully', async () => {
      ;(settingsApi.getTenantProfile as Mock).mockResolvedValue(mockTenantProfile)

      await useSettingsStore.getState().fetchTenantProfile()

      const state = useSettingsStore.getState()
      expect(state.tenantProfile).toEqual(mockTenantProfile)
      expect(state.isLoading).toBe(false)
    })

    it('should handle fetch error', async () => {
      ;(settingsApi.getTenantProfile as Mock).mockRejectedValue(new Error('Network error'))

      await useSettingsStore.getState().fetchTenantProfile()

      const state = useSettingsStore.getState()
      expect(state.error).toBe('Network error')
    })
  })

  describe('fetchAll', () => {
    it('should fetch both settings and tenant profile', async () => {
      ;(settingsApi.getSettings as Mock).mockResolvedValue(mockSettings)
      ;(settingsApi.getTenantProfile as Mock).mockResolvedValue(mockTenantProfile)

      await useSettingsStore.getState().fetchAll()

      const state = useSettingsStore.getState()
      expect(state.settings).toEqual(mockSettings)
      expect(state.tenantProfile).toEqual(mockTenantProfile)
      expect(state.isLoading).toBe(false)
    })

    it('should handle fetch error', async () => {
      ;(settingsApi.getSettings as Mock).mockRejectedValue(new Error('Failed'))
      ;(settingsApi.getTenantProfile as Mock).mockResolvedValue(mockTenantProfile)

      await useSettingsStore.getState().fetchAll()

      const state = useSettingsStore.getState()
      expect(state.error).toBe('Failed')
    })
  })

  describe('updateSettings', () => {
    it('should update settings successfully', async () => {
      const updatedSettings = { ...mockSettings, language: 'en' as const }
      ;(settingsApi.updateSettings as Mock).mockResolvedValue(updatedSettings)

      await useSettingsStore.getState().updateSettings({ language: 'en' })

      const state = useSettingsStore.getState()
      expect(state.settings).toEqual(updatedSettings)
      expect(state.isSaving).toBe(false)
      expect(state.successMessage).toBe('Settings saved successfully')
    })

    it('should throw error on failure', async () => {
      ;(settingsApi.updateSettings as Mock).mockRejectedValue(new Error('Update failed'))

      await expect(
        useSettingsStore.getState().updateSettings({ language: 'en' })
      ).rejects.toThrow()

      const state = useSettingsStore.getState()
      expect(state.error).toBe('Update failed')
      expect(state.isSaving).toBe(false)
    })
  })

  describe('updateTenantProfile', () => {
    it('should update tenant profile successfully', async () => {
      const updatedProfile = { ...mockTenantProfile, name: 'New Clinic Name' }
      ;(settingsApi.updateTenantProfile as Mock).mockResolvedValue(updatedProfile)

      await useSettingsStore.getState().updateTenantProfile({ name: 'New Clinic Name' })

      const state = useSettingsStore.getState()
      expect(state.tenantProfile).toEqual(updatedProfile)
      expect(state.isSaving).toBe(false)
      expect(state.successMessage).toBe('Clinic profile saved successfully')
    })

    it('should throw error on failure', async () => {
      ;(settingsApi.updateTenantProfile as Mock).mockRejectedValue(new Error('Update failed'))

      await expect(
        useSettingsStore.getState().updateTenantProfile({ name: 'New Name' })
      ).rejects.toThrow()

      const state = useSettingsStore.getState()
      expect(state.error).toBe('Update failed')
    })
  })

  describe('clearError', () => {
    it('should clear the error', () => {
      useSettingsStore.setState({ error: 'Some error' })

      useSettingsStore.getState().clearError()

      expect(useSettingsStore.getState().error).toBeNull()
    })
  })

  describe('clearSuccessMessage', () => {
    it('should clear the success message', () => {
      useSettingsStore.setState({ successMessage: 'Some success' })

      useSettingsStore.getState().clearSuccessMessage()

      expect(useSettingsStore.getState().successMessage).toBeNull()
    })
  })
})
