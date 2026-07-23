import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
// Real i18next instance — NOT mocked, so t() resolves actual es/en/ar strings
// from the locale JSON. This proves the migrated `admin.dashboard.*` /
// `admin.roles.*` keys actually flow through t() rather than being
// hardcoded, per task #330.
import i18n, { i18nReady } from '@/i18n'

// Mock adminStatsApi (the real HTTP seam) — everything else is real
const mockGetStats = vi.fn()
const mockGetTopTenants = vi.fn()
const mockGetRecentActivity = vi.fn()

vi.mock('@/lib/admin-api', () => ({
  adminStatsApi: {
    getStats: (...args: unknown[]) => mockGetStats(...args),
    getTopTenants: (...args: unknown[]) => mockGetTopTenants(...args),
    getRecentActivity: (...args: unknown[]) => mockGetRecentActivity(...args),
  },
}))

// Import after mocks
import { AdminDashboardPage } from './AdminDashboardPage'

async function switchLocale(code: string) {
  await act(async () => {
    await i18n.changeLanguage(code)
  })
}

function renderDashboard() {
  return render(
    <MemoryRouter>
      <AdminDashboardPage />
    </MemoryRouter>
  )
}

const baseStats = {
  tenants: { total: 12, active: 9, inactive: 3 },
  users: { total: 40, active: 35, byRole: { OWNER: 10, STAFF: 30 } },
  patients: { total: 500 },
  appointments: { total: 900, thisMonth: 42 },
}

const baseTopTenants = [
  { id: 't1', name: 'Clinica Uno', slug: 'clinica-uno', _count: { patients: 100, appointments: 50 } },
]

const baseActivity = [
  {
    type: 'tenant_created' as const,
    id: 'a1',
    name: 'Clinica Dos',
    createdAt: '2024-01-01T00:00:00Z',
  },
  {
    type: 'user_created' as const,
    id: 'a2',
    email: 'nuevo@example.com',
    tenantName: 'Clinica Tres',
    createdAt: '2024-01-02T00:00:00Z',
  },
]

describe('AdminDashboardPage', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    mockGetStats.mockResolvedValue(baseStats)
    mockGetTopTenants.mockResolvedValue(baseTopTenants)
    mockGetRecentActivity.mockResolvedValue(baseActivity)
    await i18nReady
    await switchLocale('es')
  })

  afterEach(async () => {
    await switchLocale('es')
  })

  describe('rendering (es)', () => {
    it('renders the translated title and subtitle', async () => {
      renderDashboard()

      await waitFor(() => {
        expect(screen.getByText('Dashboard')).toBeInTheDocument()
      })
      expect(screen.getByText('Resumen de la plataforma Alveo System')).toBeInTheDocument()
    })

    it('renders the translated stat card titles', async () => {
      renderDashboard()

      await waitFor(() => {
        expect(screen.getByText('Total Clínicas')).toBeInTheDocument()
      })
      expect(screen.getByText('Total Usuarios')).toBeInTheDocument()
      expect(screen.getByText('Total Pacientes')).toBeInTheDocument()
      expect(screen.getByText('Citas Este Mes')).toBeInTheDocument()
    })

    it('renders the translated section headings and roles heading', async () => {
      renderDashboard()

      await waitFor(() => {
        expect(screen.getByText('Top Clínicas')).toBeInTheDocument()
      })
      expect(screen.getByText('Actividad Reciente')).toBeInTheDocument()
      expect(screen.getByText('Usuarios por Rol')).toBeInTheDocument()
    })

    it('renders translated role labels from admin.roles.* for byRole entries', async () => {
      renderDashboard()

      await waitFor(() => {
        expect(screen.getByText('Owner')).toBeInTheDocument()
      })
      expect(screen.getByText('Staff')).toBeInTheDocument()
    })

    it('shows the empty-state messages when there are no top tenants or activity', async () => {
      mockGetTopTenants.mockResolvedValue([])
      mockGetRecentActivity.mockResolvedValue([])
      renderDashboard()

      await waitFor(() => {
        expect(screen.getByText('No hay clínicas registradas')).toBeInTheDocument()
      })
      expect(screen.getByText('No hay actividad reciente')).toBeInTheDocument()
    })

    it('shows the translated error message when loading data fails', async () => {
      mockGetStats.mockRejectedValue(new Error('network down'))
      renderDashboard()

      await waitFor(() => {
        expect(screen.getByText('Error')).toBeInTheDocument()
      })
      expect(screen.getByText('Error al cargar los datos del dashboard')).toBeInTheDocument()
    })
  })

  describe('interpolation', () => {
    it('interpolates the active-tenants count into the tenants stat subtitle', async () => {
      renderDashboard()

      await waitFor(() => {
        expect(screen.getByText('9 activas')).toBeInTheDocument()
      })
    })

    it('interpolates patient and appointment counts into the top-tenants stats line', async () => {
      renderDashboard()

      await waitFor(() => {
        expect(screen.getByText('100 pacientes • 50 citas')).toBeInTheDocument()
      })
    })

    it('interpolates the tenant name into the "new user" activity line', async () => {
      renderDashboard()

      await waitFor(() => {
        expect(screen.getByText('en Clinica Tres')).toBeInTheDocument()
      })
    })
  })

  describe('locale switching — proves strings flow through t()', () => {
    it('renders the English title, subtitle and stat titles after switching language to en', async () => {
      renderDashboard()

      await waitFor(() => {
        expect(screen.getByText('Resumen de la plataforma Alveo System')).toBeInTheDocument()
      })

      await switchLocale('en')

      expect(screen.getByText('Overview of the Alveo System platform')).toBeInTheDocument()
      expect(screen.getByText('Total Clinics')).toBeInTheDocument()
      expect(screen.getByText('9 active')).toBeInTheDocument()
      expect(screen.queryByText('Resumen de la plataforma Alveo System')).not.toBeInTheDocument()
    })

    it('renders the Arabic title after switching language to ar', async () => {
      renderDashboard()

      await waitFor(() => {
        expect(screen.getByText('Resumen de la plataforma Alveo System')).toBeInTheDocument()
      })

      await switchLocale('ar')

      expect(screen.getByText('نظرة عامة على منصة Alveo System')).toBeInTheDocument()
      expect(screen.getByText('إجمالي العيادات')).toBeInTheDocument()
    })
  })
})
