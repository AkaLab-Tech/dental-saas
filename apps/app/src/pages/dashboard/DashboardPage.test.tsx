import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BrowserRouter } from 'react-router'
import DashboardPage from './DashboardPage'
import { useStatsStore } from '@/stores/stats.store'
import { useAuthStore } from '@/stores/auth.store'
import { useLockStore } from '@/stores/lock.store'

// Mock the stores
vi.mock('@/stores/stats.store')
vi.mock('@/stores/auth.store')
vi.mock('@/stores/lock.store')

// Mock Recharts to avoid canvas issues in tests
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div data-testid="responsive-container">{children}</div>,
  BarChart: ({ children }: { children: React.ReactNode }) => <div data-testid="bar-chart">{children}</div>,
  LineChart: ({ children }: { children: React.ReactNode }) => <div data-testid="line-chart">{children}</div>,
  Bar: () => null,
  Line: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
}))

const mockFetchAllStats = vi.fn()

const mockOverview = {
  totalPatients: 150,
  totalDoctors: 5,
  totalAppointments: 500,
  appointmentsThisMonth: 45,
  completedAppointmentsThisMonth: 38,
  monthlyRevenue: 25000,
  pendingPayments: 5000,
  pendingLabworks: 3,
  unpaidLabworks: 1,
}

const mockAppointmentStats = {
  total: 45,
  byStatus: {
    COMPLETED: 38,
    SCHEDULED: 5,
    CANCELLED: 2,
  },
  byDay: [
    { date: '2026-01-01', count: 5 },
    { date: '2026-01-02', count: 3 },
  ],
}

const mockRevenueStats = {
  total: 75000,
  byMonth: [
    { month: 'Nov 2025', revenue: 22000 },
    { month: 'Dec 2025', revenue: 28000 },
    { month: 'Jan 2026', revenue: 25000 },
  ],
}

const mockPatientsGrowth = {
  thisMonth: 12,
  lastMonth: 8,
  growthPercentage: 50,
}

const mockDoctorPerformance = [
  {
    doctorId: '1',
    doctorName: 'Dr. Smith',
    appointmentsCount: 20,
    completedCount: 18,
    completionRate: 90,
    revenue: 10000,
  },
  {
    doctorId: '2',
    doctorName: 'Dr. Johnson',
    appointmentsCount: 15,
    completedCount: 12,
    completionRate: 80,
    revenue: 8000,
  },
]

const mockAdminUser = {
  id: '1',
  email: 'admin@test.com',
  firstName: 'Admin',
  lastName: 'User',
  role: 'ADMIN' as const,
}

const mockStaffUser = {
  id: '2',
  email: 'staff@test.com',
  firstName: 'Staff',
  lastName: 'User',
  role: 'STAFF' as const,
}

describe('DashboardPage', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    // Default: no active profile user (admin context)
    ;(useLockStore as unknown as Mock).mockImplementation((selector: (s: { activeUser: null }) => unknown) =>
      selector({ activeUser: null })
    )
  })

  it('should show loading state when data is loading', () => {
    (useStatsStore as unknown as Mock).mockReturnValue({
      overview: null,
      appointmentStats: null,
      revenueStats: null,
      patientsGrowth: null,
      doctorPerformance: null,
      isLoading: true,
      error: null,
      fetchAllStats: mockFetchAllStats,
    })
    ;(useAuthStore as unknown as Mock).mockReturnValue({
      user: mockAdminUser,
    })

    render(
      <BrowserRouter>
        <DashboardPage />
      </BrowserRouter>
    )

    // Should show loading spinner (no text, just the spinner div)
    const spinner = document.querySelector('.animate-spin')
    expect(spinner).toBeInTheDocument()
  })

  it('should show error state when there is an error', () => {
    (useStatsStore as unknown as Mock).mockReturnValue({
      overview: null,
      appointmentStats: null,
      revenueStats: null,
      patientsGrowth: null,
      doctorPerformance: null,
      isLoading: false,
      error: 'Failed to fetch statistics',
      fetchAllStats: mockFetchAllStats,
    })
    ;(useAuthStore as unknown as Mock).mockReturnValue({
      user: mockAdminUser,
    })

    render(
      <BrowserRouter>
        <DashboardPage />
      </BrowserRouter>
    )

    expect(screen.getByText('Failed to fetch statistics')).toBeInTheDocument()
  })

  it('should render dashboard with stats for admin user', async () => {
    (useStatsStore as unknown as Mock).mockReturnValue({
      overview: mockOverview,
      appointmentStats: mockAppointmentStats,
      revenueStats: mockRevenueStats,
      patientsGrowth: mockPatientsGrowth,
      doctorPerformance: mockDoctorPerformance,
      isLoading: false,
      error: null,
      fetchAllStats: mockFetchAllStats,
    })
    ;(useAuthStore as unknown as Mock).mockReturnValue({
      user: mockAdminUser,
    })

    render(
      <BrowserRouter>
        <DashboardPage />
      </BrowserRouter>
    )

    // Check header
    expect(screen.getByText('Dashboard')).toBeInTheDocument()
    expect(screen.getByText(/Bienvenido, Admin/)).toBeInTheDocument()

    // Check stat cards
    expect(screen.getByText('Pacientes Activos')).toBeInTheDocument()
    expect(screen.getByText('150')).toBeInTheDocument()
    expect(screen.getByText('Doctores')).toBeInTheDocument()
    // '5' appears multiple times (doctors count + appointment status count)
    expect(screen.getAllByText('5').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Citas del Mes')).toBeInTheDocument()
    expect(screen.getByText('45')).toBeInTheDocument()
    expect(screen.getByText('Ingresos del Mes')).toBeInTheDocument()

    // Check charts are rendered
    expect(screen.getByText('Citas por Día (Últimos 14 días)')).toBeInTheDocument()
    expect(screen.getByText('Ingresos por Mes')).toBeInTheDocument()

    // Admin should see doctor performance table
    expect(screen.getByText('Rendimiento de Doctores (Este Mes)')).toBeInTheDocument()
    expect(screen.getByText('Dr. Smith')).toBeInTheDocument()
    expect(screen.getByText('Dr. Johnson')).toBeInTheDocument()

    // Check appointment status breakdown
    expect(screen.getByText('Estado de Citas (Este Mes)')).toBeInTheDocument()
    expect(screen.getByText('COMPLETED')).toBeInTheDocument()
  })

  it('should show doctor dashboard for staff users', () => {
    const mockFetchMyDoctorId = vi.fn().mockResolvedValue(null)
    ;(useStatsStore as unknown as Mock).mockReturnValue({
      overview: null,
      appointmentStats: null,
      revenueStats: null,
      patientsGrowth: null,
      doctorPerformance: null,
      upcomingAppointments: null,
      appointmentTypes: null,
      myDoctorId: null,
      isLoading: false,
      error: null,
      fetchAllStats: mockFetchAllStats,
      fetchMyDoctorId: mockFetchMyDoctorId,
      fetchDoctorStats: vi.fn(),
    })
    ;(useAuthStore as unknown as Mock).mockReturnValue({
      user: mockStaffUser,
    })

    render(
      <BrowserRouter>
        <DashboardPage />
      </BrowserRouter>
    )

    // Staff sees doctor dashboard — shows "not linked" message when no doctorId
    expect(screen.queryByText('Rendimiento de Doctores (Este Mes)')).not.toBeInTheDocument()
  })

  it('should call fetchAllStats on mount', () => {
    (useStatsStore as unknown as Mock).mockReturnValue({
      overview: null,
      appointmentStats: null,
      revenueStats: null,
      patientsGrowth: null,
      doctorPerformance: null,
      isLoading: true,
      error: null,
      fetchAllStats: mockFetchAllStats,
    })
    ;(useAuthStore as unknown as Mock).mockReturnValue({
      user: mockAdminUser,
    })

    render(
      <BrowserRouter>
        <DashboardPage />
      </BrowserRouter>
    )

    expect(mockFetchAllStats).toHaveBeenCalledTimes(1)
  })

  it('should show empty state for charts when no data', () => {
    (useStatsStore as unknown as Mock).mockReturnValue({
      overview: mockOverview,
      appointmentStats: { total: 0, byStatus: {}, byDay: [] },
      revenueStats: { total: 0, byMonth: [] },
      patientsGrowth: mockPatientsGrowth,
      doctorPerformance: [],
      isLoading: false,
      error: null,
      fetchAllStats: mockFetchAllStats,
    })
    ;(useAuthStore as unknown as Mock).mockReturnValue({
      user: mockAdminUser,
    })

    render(
      <BrowserRouter>
        <DashboardPage />
      </BrowserRouter>
    )

    expect(screen.getByText('No hay datos de citas para mostrar')).toBeInTheDocument()
    expect(screen.getByText('No hay datos de ingresos para mostrar')).toBeInTheDocument()
  })

  it('should show growth trend indicator', () => {
    (useStatsStore as unknown as Mock).mockReturnValue({
      overview: mockOverview,
      appointmentStats: mockAppointmentStats,
      revenueStats: mockRevenueStats,
      patientsGrowth: mockPatientsGrowth,
      doctorPerformance: mockDoctorPerformance,
      isLoading: false,
      error: null,
      fetchAllStats: mockFetchAllStats,
    })
    ;(useAuthStore as unknown as Mock).mockReturnValue({
      user: mockAdminUser,
    })

    render(
      <BrowserRouter>
        <DashboardPage />
      </BrowserRouter>
    )

    // Should show growth percentage
    expect(screen.getByText(/\+50% vs mes anterior/)).toBeInTheDocument()
  })
})
