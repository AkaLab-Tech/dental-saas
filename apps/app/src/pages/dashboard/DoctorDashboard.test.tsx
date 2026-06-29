import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { BrowserRouter } from 'react-router'
import DoctorDashboard from './DoctorDashboard'
import { useStatsStore } from '@/stores/stats.store'
import { useAuthStore } from '@/stores/auth.store'

// Mock the stores
vi.mock('@/stores/stats.store')
vi.mock('@/stores/auth.store')

// Mock react-i18next — return the key so assertions are stable regardless of locale
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts?.name) return `${key} ${opts.name}`
      return key
    },
    i18n: { language: 'es' },
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}))

// Mock Recharts to avoid canvas issues in tests
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="responsive-container">{children}</div>
  ),
  BarChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="bar-chart">{children}</div>
  ),
  Bar: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
}))

const mockFetchMyDoctorId = vi.fn()
const mockFetchDoctorStats = vi.fn()

const mockDoctorUser = {
  id: '10',
  email: 'doctor@test.com',
  firstName: 'Ana',
  lastName: 'Perez',
  role: 'DOCTOR' as const,
}

function buildStoreDefaults(overrides: Record<string, unknown> = {}) {
  return {
    overview: null,
    appointmentStats: null,
    upcomingAppointments: null,
    appointmentTypes: null,
    myDoctorId: null,
    isLoading: false,
    error: null,
    fetchMyDoctorId: mockFetchMyDoctorId,
    fetchDoctorStats: mockFetchDoctorStats,
    ...overrides,
  }
}

describe('DoctorDashboard', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockFetchMyDoctorId.mockResolvedValue(null)
    mockFetchDoctorStats.mockResolvedValue(undefined)
  })

  it('renders the not-linked warning when myDoctorId is null and not loading', () => {
    ;(useStatsStore as unknown as Mock).mockReturnValue(buildStoreDefaults())
    ;(useAuthStore as unknown as Mock).mockReturnValue({
      user: mockDoctorUser,
      accessToken: 'test-access-token',
    })

    render(
      <BrowserRouter>
        <DoctorDashboard />
      </BrowserRouter>
    )

    // t('dashboard.doctor.notLinked') returns the key unchanged in tests
    expect(screen.getByText('dashboard.doctor.notLinked')).toBeInTheDocument()
  })

  it('calls fetchMyDoctorId when accessToken is present', async () => {
    // Regression guard for #208: stats fetch must fire once a real token exists.
    ;(useStatsStore as unknown as Mock).mockReturnValue(buildStoreDefaults())
    ;(useAuthStore as unknown as Mock).mockReturnValue({
      user: mockDoctorUser,
      accessToken: 'test-access-token',
    })

    render(
      <BrowserRouter>
        <DoctorDashboard />
      </BrowserRouter>
    )

    await waitFor(() => {
      expect(mockFetchMyDoctorId).toHaveBeenCalledTimes(1)
    })
  })

  it('does not call fetchMyDoctorId when accessToken is null', async () => {
    // Regression guard for #208: a null token (fresh login before auth store
    // is populated) must not trigger a stats fetch — that would result in a 401.
    ;(useStatsStore as unknown as Mock).mockReturnValue(buildStoreDefaults())
    ;(useAuthStore as unknown as Mock).mockReturnValue({
      user: mockDoctorUser,
      accessToken: null,
    })

    render(
      <BrowserRouter>
        <DoctorDashboard />
      </BrowserRouter>
    )

    // Give the effect a chance to run (if it were going to)
    await waitFor(() => {
      expect(mockFetchMyDoctorId).toHaveBeenCalledTimes(0)
    })
  })

  it('calls fetchDoctorStats with the resolved doctorId when fetchMyDoctorId returns one', async () => {
    const doctorId = 'doctor-uuid-123'
    mockFetchMyDoctorId.mockResolvedValue(doctorId)

    ;(useStatsStore as unknown as Mock).mockReturnValue(buildStoreDefaults())
    ;(useAuthStore as unknown as Mock).mockReturnValue({
      user: mockDoctorUser,
      accessToken: 'test-access-token',
    })

    render(
      <BrowserRouter>
        <DoctorDashboard />
      </BrowserRouter>
    )

    await waitFor(() => {
      expect(mockFetchDoctorStats).toHaveBeenCalledWith(doctorId)
    })
  })

  it('does not call fetchDoctorStats when fetchMyDoctorId returns null', async () => {
    mockFetchMyDoctorId.mockResolvedValue(null)

    ;(useStatsStore as unknown as Mock).mockReturnValue(buildStoreDefaults())
    ;(useAuthStore as unknown as Mock).mockReturnValue({
      user: mockDoctorUser,
      accessToken: 'test-access-token',
    })

    render(
      <BrowserRouter>
        <DoctorDashboard />
      </BrowserRouter>
    )

    await waitFor(() => {
      expect(mockFetchMyDoctorId).toHaveBeenCalledTimes(1)
    })
    expect(mockFetchDoctorStats).not.toHaveBeenCalled()
  })

  it('shows loading spinner when isLoading is true and overview is absent', () => {
    ;(useStatsStore as unknown as Mock).mockReturnValue(
      buildStoreDefaults({ isLoading: true, overview: null })
    )
    ;(useAuthStore as unknown as Mock).mockReturnValue({
      user: mockDoctorUser,
      accessToken: 'test-access-token',
    })

    render(
      <BrowserRouter>
        <DoctorDashboard />
      </BrowserRouter>
    )

    const spinner = document.querySelector('.animate-spin')
    expect(spinner).toBeInTheDocument()
  })

  it('shows error message when error is set', () => {
    ;(useStatsStore as unknown as Mock).mockReturnValue(
      buildStoreDefaults({ error: 'Failed to load doctor stats', isLoading: false })
    )
    ;(useAuthStore as unknown as Mock).mockReturnValue({
      user: mockDoctorUser,
      accessToken: 'test-access-token',
    })

    render(
      <BrowserRouter>
        <DoctorDashboard />
      </BrowserRouter>
    )

    expect(screen.getByText('Failed to load doctor stats')).toBeInTheDocument()
  })
})
