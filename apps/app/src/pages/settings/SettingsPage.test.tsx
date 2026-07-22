import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { BrowserRouter } from 'react-router'
import i18n from 'i18next'
import '@/i18n'
import SettingsPage from './SettingsPage'
import { useSettingsStore } from '@/stores/settings.store'
import { useAuthStore } from '@/stores/auth.store'

// SettingsPage (and its BusinessHoursForm / DataExportForm children) now
// render every user-facing string through t(). Initialize the real i18n
// instance (Spanish, the app default) so assertions exercise the actual
// translated/interpolated output rather than raw keys or jsdom's default
// `en` locale detection — mirrors the pattern used by LabworksPage.test.tsx
// and DoctorsPage.test.tsx for the same reason (tasks #325/#326).
beforeAll(async () => {
  await i18n.changeLanguage('es')
})

// Mock the stores
vi.mock('@/stores/settings.store', () => ({
  useSettingsStore: vi.fn(),
}))

vi.mock('@/stores/auth.store', () => ({
  useAuthStore: vi.fn(),
}))

const mockSettings = {
  id: 'settings-1',
  language: 'es' as const,
  dateFormat: 'DD/MM/YYYY' as const,
  timeFormat: '24h' as const,
  defaultAppointmentDuration: 30,
  appointmentBuffer: 0,
  businessHours: { mon: { start: '09:00', end: '18:00' } },
  workingDays: [1, 2, 3, 4, 5],
  emailNotifications: true,
  smsNotifications: false,
  appointmentReminders: true,
  reminderHoursBefore: 24,
  updatedAt: '2025-01-15T00:00:00Z',
}

const mockTenantProfile = {
  id: 'tenant-1',
  name: 'Test Clinic',
  slug: 'test-clinic',
  email: 'clinic@test.com',
  phone: '+1234567890',
  address: '123 Main St',
  logo: null,
  timezone: 'America/Argentina/Buenos_Aires',
  currency: 'ARS',
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-15T00:00:00Z',
}

const mockOwnerUser = {
  id: 'user-1',
  email: 'owner@test.com',
  firstName: 'Test',
  lastName: 'Owner',
  role: 'OWNER' as const,
  tenantId: 'tenant-1',
}

const mockAdminUser = {
  ...mockOwnerUser,
  role: 'ADMIN' as const,
}

const mockStaffUser = {
  ...mockOwnerUser,
  role: 'STAFF' as const,
}

describe('SettingsPage', () => {
  const mockFetchAll = vi.fn()
  const mockClearError = vi.fn()
  const mockClearSuccessMessage = vi.fn()

  beforeEach(() => {
    vi.resetAllMocks()

    vi.mocked(useSettingsStore).mockReturnValue({
      settings: mockSettings,
      tenantProfile: mockTenantProfile,
      isLoading: false,
      isSaving: false,
      error: null,
      successMessage: null,
      fetchAll: mockFetchAll,
      fetchSettings: vi.fn(),
      fetchTenantProfile: vi.fn(),
      updateSettings: vi.fn(),
      updateTenantProfile: vi.fn(),
      clearError: mockClearError,
      clearSuccessMessage: mockClearSuccessMessage,
    })

    vi.mocked(useAuthStore).mockReturnValue({
      user: mockOwnerUser,
      accessToken: 'token',
      refreshToken: 'refresh',
      isAuthenticated: true,
      isLoading: false,
      error: null,
      setAuth: vi.fn(),
      setTokens: vi.fn(),
      setUser: vi.fn(),
      setLoading: vi.fn(),
      setError: vi.fn(),
      logout: vi.fn(),
      clearError: vi.fn(),
    })
  })

  const renderPage = () => {
    return render(
      <BrowserRouter>
        <SettingsPage />
      </BrowserRouter>
    )
  }

  it('should render the page title', () => {
    renderPage()
    expect(screen.getByText('Configuración')).toBeInTheDocument()
  })

  it('should show loading state when data is loading', () => {
    vi.mocked(useSettingsStore).mockReturnValue({
      ...useSettingsStore(),
      settings: null,
      tenantProfile: null,
      isLoading: true,
      fetchAll: mockFetchAll,
      clearError: mockClearError,
      clearSuccessMessage: mockClearSuccessMessage,
    } as ReturnType<typeof useSettingsStore>)

    renderPage()
    // Check that the spinner is present by its class
    const spinner = document.querySelector('.animate-spin')
    expect(spinner).toBeTruthy()
  })

  it('should call fetchAll on mount', () => {
    renderPage()
    expect(mockFetchAll).toHaveBeenCalled()
  })

  it('should render four tabs', () => {
    renderPage()
    expect(screen.getByText('Perfil de Clínica')).toBeInTheDocument()
    expect(screen.getByText('Preferencias')).toBeInTheDocument()
    expect(screen.getByText('Horarios')).toBeInTheDocument()
    expect(screen.getByText('Datos')).toBeInTheDocument()
  })

  it('should switch tabs when clicked', async () => {
    renderPage()

    // Click on Preferences tab
    fireEvent.click(screen.getByText('Preferencias'))
    await waitFor(() => {
      expect(screen.getByText('Localización')).toBeInTheDocument()
    })

    // Click on Hours tab
    fireEvent.click(screen.getByText('Horarios'))
    await waitFor(() => {
      expect(screen.getByText('Días Laborables')).toBeInTheDocument()
    })
  })

  it('should show error alert when error exists', () => {
    vi.mocked(useSettingsStore).mockReturnValue({
      ...useSettingsStore(),
      settings: mockSettings,
      tenantProfile: mockTenantProfile,
      isLoading: false,
      error: 'Failed to load settings',
      fetchAll: mockFetchAll,
      clearError: mockClearError,
      clearSuccessMessage: mockClearSuccessMessage,
    } as ReturnType<typeof useSettingsStore>)

    renderPage()
    expect(screen.getByText('Failed to load settings')).toBeInTheDocument()
  })

  it('should show success alert when successMessage exists', () => {
    vi.mocked(useSettingsStore).mockReturnValue({
      ...useSettingsStore(),
      settings: mockSettings,
      tenantProfile: mockTenantProfile,
      isLoading: false,
      successMessage: 'Settings saved successfully',
      fetchAll: mockFetchAll,
      clearError: mockClearError,
      clearSuccessMessage: mockClearSuccessMessage,
    } as ReturnType<typeof useSettingsStore>)

    renderPage()
    expect(screen.getByText('Settings saved successfully')).toBeInTheDocument()
  })

  it('should show clinic profile form in first tab', () => {
    renderPage()
    expect(screen.getByLabelText('Nombre de la Clínica *')).toBeInTheDocument()
    expect(screen.getByLabelText('Email de Contacto *')).toBeInTheDocument()
  })

  it('should allow OWNER to edit profile', () => {
    renderPage()
    const nameInput = screen.getByLabelText('Nombre de la Clínica *')
    expect(nameInput).not.toBeDisabled()
  })

  it('should not allow ADMIN to edit profile', () => {
    vi.mocked(useAuthStore).mockReturnValue({
      ...useAuthStore(),
      user: mockAdminUser,
    } as ReturnType<typeof useAuthStore>)

    renderPage()
    const nameInput = screen.getByLabelText('Nombre de la Clínica *')
    expect(nameInput).toBeDisabled()
  })

  it('should allow ADMIN to edit preferences', async () => {
    vi.mocked(useAuthStore).mockReturnValue({
      ...useAuthStore(),
      user: mockAdminUser,
    } as ReturnType<typeof useAuthStore>)

    renderPage()
    fireEvent.click(screen.getByText('Preferencias'))

    await waitFor(() => {
      const languageSelect = screen.getByLabelText('Idioma')
      expect(languageSelect).not.toBeDisabled()
    })
  })

  it('should not allow STAFF to edit preferences', async () => {
    vi.mocked(useAuthStore).mockReturnValue({
      ...useAuthStore(),
      user: mockStaffUser,
    } as ReturnType<typeof useAuthStore>)

    renderPage()
    fireEvent.click(screen.getByText('Preferencias'))

    await waitFor(() => {
      const languageSelect = screen.getByLabelText('Idioma')
      expect(languageSelect).toBeDisabled()
    })
  })

  it('should show data export form for OWNER', async () => {
    renderPage()
    fireEvent.click(screen.getByText('Datos'))

    await waitFor(() => {
      expect(screen.getByText('Exportar Datos')).toBeInTheDocument()
      expect(screen.getByText('Descargar Datos')).toBeInTheDocument()
    })
  })

  it('should show data export form for ADMIN', async () => {
    vi.mocked(useAuthStore).mockReturnValue({
      ...useAuthStore(),
      user: mockAdminUser,
    } as ReturnType<typeof useAuthStore>)

    renderPage()
    fireEvent.click(screen.getByText('Datos'))

    await waitFor(() => {
      expect(screen.getByText('Exportar Datos')).toBeInTheDocument()
    })
  })

  it('should not allow STAFF to access data export', async () => {
    vi.mocked(useAuthStore).mockReturnValue({
      ...useAuthStore(),
      user: mockStaffUser,
    } as ReturnType<typeof useAuthStore>)

    renderPage()
    fireEvent.click(screen.getByText('Datos'))

    await waitFor(() => {
      expect(screen.getByText('No tienes permisos para exportar datos')).toBeInTheDocument()
    })
  })
})
