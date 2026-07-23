import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent, act, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
// Real i18next instance — NOT mocked, so t() resolves actual es/en/ar strings
// from the locale JSON. This proves the migrated `admin.tenants.*` /
// `admin.status.*` keys actually flow through t() rather than being
// hardcoded, per task #330.
import i18n, { i18nReady } from '@/i18n'

// Mock adminTenantsApi (the real HTTP seam) — everything else is real
const mockList = vi.fn()
const mockSuspend = vi.fn()
const mockActivate = vi.fn()
const mockDelete = vi.fn()

vi.mock('@/lib/admin-api', () => ({
  adminTenantsApi: {
    list: (...args: unknown[]) => mockList(...args),
    suspend: (...args: unknown[]) => mockSuspend(...args),
    activate: (...args: unknown[]) => mockActivate(...args),
    delete: (...args: unknown[]) => mockDelete(...args),
  },
}))

// Import after mocks
import { AdminTenantsPage } from './AdminTenantsPage'

async function switchLocale(code: string) {
  await act(async () => {
    await i18n.changeLanguage(code)
  })
}

function renderTenantsPage() {
  return render(
    <MemoryRouter>
      <AdminTenantsPage />
    </MemoryRouter>
  )
}

// The table row is the source of truth for a rendered tenant; scoping
// queries to it avoids false matches against the (always-rendered)
// status filter <select> options, which share translated labels.
function getTenantRow(name: string) {
  const row = screen.getByText(name).closest('tr')
  if (!row) throw new Error(`Could not find a <tr> ancestor for "${name}"`)
  return row
}

function makeTenant(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'tenant-1',
    name: 'Clinica Central',
    slug: 'clinica-central',
    timezone: 'America/Montevideo',
    currency: 'UYU',
    isActive: true,
    createdAt: '2024-01-05T00:00:00Z',
    updatedAt: '2024-01-05T00:00:00Z',
    _count: { users: 5, patients: 200, doctors: 3, appointments: 400 },
    subscription: { plan: { name: 'pro', displayName: 'Plan Pro' } },
    ...overrides,
  }
}

const baseResponse = {
  tenants: [makeTenant()],
  pagination: { page: 1, limit: 10, total: 1, totalPages: 1 },
}

describe('AdminTenantsPage', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    mockList.mockResolvedValue(baseResponse)
    await i18nReady
    await switchLocale('es')
  })

  afterEach(async () => {
    await switchLocale('es')
  })

  describe('rendering (es)', () => {
    it('renders the translated title and subtitle', async () => {
      renderTenantsPage()

      await waitFor(() => {
        expect(screen.getByText('Clínicas')).toBeInTheDocument()
      })
      expect(screen.getByText('Gestiona todas las clínicas de la plataforma')).toBeInTheDocument()
    })

    it('renders the translated table headers', async () => {
      renderTenantsPage()

      await waitFor(() => {
        expect(screen.getByText('Clínica')).toBeInTheDocument()
      })
      expect(screen.getByText('Estado')).toBeInTheDocument()
      expect(screen.getByText('Usuarios')).toBeInTheDocument()
      expect(screen.getByText('Pacientes')).toBeInTheDocument()
      expect(screen.getByText('Plan')).toBeInTheDocument()
      expect(screen.getByText('Creada')).toBeInTheDocument()
    })

    it('renders the translated active-status badge and plan name for a tenant row', async () => {
      renderTenantsPage()

      await waitFor(() => {
        expect(screen.getByText('Clinica Central')).toBeInTheDocument()
      })
      const row = within(getTenantRow('Clinica Central'))
      expect(row.getByText('Activo')).toBeInTheDocument()
      expect(row.getByText('Plan Pro')).toBeInTheDocument()
    })

    it('renders the translated suspended badge for an inactive tenant', async () => {
      mockList.mockResolvedValue({
        tenants: [makeTenant({ isActive: false })],
        pagination: { page: 1, limit: 10, total: 1, totalPages: 1 },
      })
      renderTenantsPage()

      await waitFor(() => {
        expect(screen.getByText('Clinica Central')).toBeInTheDocument()
      })
      expect(within(getTenantRow('Clinica Central')).getByText('Suspendido')).toBeInTheDocument()
    })

    it('renders the translated "no plan" label when the tenant has no subscription', async () => {
      mockList.mockResolvedValue({
        tenants: [makeTenant({ subscription: undefined })],
        pagination: { page: 1, limit: 10, total: 1, totalPages: 1 },
      })
      renderTenantsPage()

      await waitFor(() => {
        expect(screen.getByText('Clinica Central')).toBeInTheDocument()
      })
      expect(within(getTenantRow('Clinica Central')).getByText('Sin plan')).toBeInTheDocument()
    })

    it('renders the translated empty-state message when there are no tenants', async () => {
      mockList.mockResolvedValue({
        tenants: [],
        pagination: { page: 1, limit: 10, total: 0, totalPages: 1 },
      })
      renderTenantsPage()

      await waitFor(() => {
        expect(screen.getByText('No se encontraron clínicas')).toBeInTheDocument()
      })
    })

    it('renders the translated error message when loading fails', async () => {
      mockList.mockRejectedValue(new Error('network down'))
      renderTenantsPage()

      await waitFor(() => {
        expect(screen.getByText('Error al cargar las clínicas')).toBeInTheDocument()
      })
    })

    it('renders the translated status filter options', async () => {
      renderTenantsPage()

      await waitFor(() => {
        expect(screen.getByText('Todos los estados')).toBeInTheDocument()
      })
      expect(screen.getByText('Activos')).toBeInTheDocument()
      expect(screen.getByText('Inactivos')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Buscar' })).toBeInTheDocument()
    })
  })

  describe('pagination', () => {
    it('renders the interpolated "showing" and "page" pagination text across multiple pages', async () => {
      mockList.mockResolvedValue({
        tenants: [makeTenant()],
        pagination: { page: 1, limit: 10, total: 25, totalPages: 3 },
      })
      renderTenantsPage()

      await waitFor(() => {
        expect(screen.getByText('Mostrando 1 a 10 de 25')).toBeInTheDocument()
      })
      expect(screen.getByText('Página 1 de 3')).toBeInTheDocument()
    })
  })

  describe('delete confirmation (interpolated dialog)', () => {
    it('shows the translated confirm dialog with the tenant name interpolated, and skips deletion when cancelled', async () => {
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
      renderTenantsPage()

      await waitFor(() => {
        expect(screen.getByText('Clinica Central')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByRole('button', { name: '' }))
      fireEvent.click(screen.getByText('Eliminar'))

      expect(confirmSpy).toHaveBeenCalledWith(
        '¿Estás seguro de eliminar "Clinica Central"? Esta acción eliminará todos los datos asociados.'
      )
      expect(mockDelete).not.toHaveBeenCalled()

      confirmSpy.mockRestore()
    })

    it('deletes the tenant when the confirm dialog is accepted', async () => {
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
      mockDelete.mockResolvedValue({
        success: true,
        message: 'deleted',
        deleted: {
          tenantId: 'tenant-1',
          tenantName: 'Clinica Central',
          usersDeleted: 5,
          doctorsDeleted: 3,
          patientsDeleted: 200,
          appointmentsDeleted: 400,
        },
      })
      renderTenantsPage()

      await waitFor(() => {
        expect(screen.getByText('Clinica Central')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByRole('button', { name: '' }))
      fireEvent.click(screen.getByText('Eliminar'))

      await waitFor(() => {
        expect(mockDelete).toHaveBeenCalledWith('tenant-1')
      })

      confirmSpy.mockRestore()
    })
  })

  describe('date localization', () => {
    it('formats the created date differently in es vs en, proving toLocaleDateString uses i18n.language', async () => {
      renderTenantsPage()

      await waitFor(() => {
        expect(screen.getByText('Clinica Central')).toBeInTheDocument()
      })
      // es-formatted (d/m/y)
      const esDate = new Date('2024-01-05T00:00:00Z').toLocaleDateString('es')
      expect(within(getTenantRow('Clinica Central')).getByText(esDate)).toBeInTheDocument()

      await switchLocale('en')

      // en-formatted (m/d/y) — different digit order than es, proving the
      // locale (not a hardcoded 'es-ES') drives the format.
      const enDate = new Date('2024-01-05T00:00:00Z').toLocaleDateString('en')
      expect(within(getTenantRow('Clinica Central')).getByText(enDate)).toBeInTheDocument()
      expect(esDate).not.toBe(enDate)
    })
  })

  describe('locale switching — proves strings flow through t()', () => {
    it('renders the English title, headers and status badge after switching language to en', async () => {
      renderTenantsPage()

      await waitFor(() => {
        expect(screen.getByText('Clinica Central')).toBeInTheDocument()
      })

      await switchLocale('en')

      expect(screen.getByText('Clinics')).toBeInTheDocument()
      expect(screen.getByText('Manage all platform clinics')).toBeInTheDocument()
      expect(within(getTenantRow('Clinica Central')).getByText('Active')).toBeInTheDocument()
      expect(screen.queryByText('Clínicas')).not.toBeInTheDocument()
    })

    it('renders the interpolated English delete-confirm dialog after switching language to en', async () => {
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
      renderTenantsPage()

      await waitFor(() => {
        expect(screen.getByText('Clinica Central')).toBeInTheDocument()
      })

      await switchLocale('en')

      fireEvent.click(screen.getByRole('button', { name: '' }))
      fireEvent.click(screen.getByText('Delete'))

      expect(confirmSpy).toHaveBeenCalledWith(
        'Are you sure you want to delete "Clinica Central"? This action will delete all associated data.'
      )

      confirmSpy.mockRestore()
    })

    it('renders the Arabic title and status badge after switching language to ar', async () => {
      renderTenantsPage()

      await waitFor(() => {
        expect(screen.getByText('Clinica Central')).toBeInTheDocument()
      })

      await switchLocale('ar')

      expect(screen.getByText('العيادات')).toBeInTheDocument()
      expect(within(getTenantRow('Clinica Central')).getByText('نشط')).toBeInTheDocument()
    })
  })
})
