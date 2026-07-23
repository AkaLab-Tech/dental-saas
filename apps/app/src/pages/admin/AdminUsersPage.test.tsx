import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent, act, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
// Real i18next instance — NOT mocked, so t() resolves actual es/en/ar strings
// from the locale JSON. This proves the migrated `admin.users.*` /
// `admin.roles.*` / `admin.status.*` keys actually flow through t() rather
// than being hardcoded, per task #330.
import i18n, { i18nReady } from '@/i18n'

// Mock adminUsersApi (the real HTTP seam) — everything else is real
const mockList = vi.fn()
const mockSuspend = vi.fn()
const mockActivate = vi.fn()
const mockDelete = vi.fn()
const mockResetPassword = vi.fn()

vi.mock('@/lib/admin-api', () => ({
  adminUsersApi: {
    list: (...args: unknown[]) => mockList(...args),
    suspend: (...args: unknown[]) => mockSuspend(...args),
    activate: (...args: unknown[]) => mockActivate(...args),
    delete: (...args: unknown[]) => mockDelete(...args),
    resetPassword: (...args: unknown[]) => mockResetPassword(...args),
  },
}))

// Import after mocks
import { AdminUsersPage } from './AdminUsersPage'

async function switchLocale(code: string) {
  await act(async () => {
    await i18n.changeLanguage(code)
  })
}

function renderUsersPage() {
  return render(
    <MemoryRouter>
      <AdminUsersPage />
    </MemoryRouter>
  )
}

// The table row is the source of truth for a rendered user; scoping queries
// to it avoids false matches against the (always-rendered) status/role
// filter <select> options, which share translated labels like "Owner".
function getUserRow(name: string) {
  const row = screen.getByText(name).closest('tr')
  if (!row) throw new Error(`Could not find a <tr> ancestor for "${name}"`)
  return row
}

function makeUser(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'user-1',
    email: 'ana@example.com',
    firstName: 'Ana',
    lastName: 'Lopez',
    role: 'OWNER',
    isActive: true,
    emailVerified: true,
    lastLoginAt: undefined,
    createdAt: '2024-01-01T00:00:00Z',
    tenant: { id: 'tenant-1', name: 'Clinica Central', slug: 'clinica-central' },
    ...overrides,
  }
}

const baseResponse = {
  users: [makeUser()],
  pagination: { page: 1, limit: 10, total: 1, totalPages: 1 },
}

describe('AdminUsersPage', () => {
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
      renderUsersPage()

      await waitFor(() => {
        expect(screen.getByText('Usuarios')).toBeInTheDocument()
      })
      expect(screen.getByText('Gestiona todos los usuarios de la plataforma')).toBeInTheDocument()
    })

    it('renders the translated table headers', async () => {
      renderUsersPage()

      await waitFor(() => {
        expect(screen.getByText('Usuario')).toBeInTheDocument()
      })
      expect(screen.getByText('Rol')).toBeInTheDocument()
      expect(screen.getByText('Estado')).toBeInTheDocument()
      expect(screen.getByText('Clínica')).toBeInTheDocument()
      expect(screen.getByText('Último Login')).toBeInTheDocument()
    })

    it('renders the translated role and active-status badges for a user row', async () => {
      renderUsersPage()

      await waitFor(() => {
        expect(screen.getByText('Ana Lopez')).toBeInTheDocument()
      })
      const row = within(getUserRow('Ana Lopez'))
      expect(row.getByText('Owner')).toBeInTheDocument()
      expect(row.getByText('Activo')).toBeInTheDocument()
    })

    it('renders the translated suspended badge for an inactive user', async () => {
      mockList.mockResolvedValue({
        users: [makeUser({ isActive: false })],
        pagination: { page: 1, limit: 10, total: 1, totalPages: 1 },
      })
      renderUsersPage()

      await waitFor(() => {
        expect(screen.getByText('Ana Lopez')).toBeInTheDocument()
      })
      expect(within(getUserRow('Ana Lopez')).getByText('Suspendido')).toBeInTheDocument()
    })

    it('renders the translated "never" label when the user has no last login', async () => {
      renderUsersPage()

      await waitFor(() => {
        expect(screen.getByText('Ana Lopez')).toBeInTheDocument()
      })
      expect(within(getUserRow('Ana Lopez')).getByText('Nunca')).toBeInTheDocument()
    })

    it('renders the translated empty-state message when there are no users', async () => {
      mockList.mockResolvedValue({
        users: [],
        pagination: { page: 1, limit: 10, total: 0, totalPages: 1 },
      })
      renderUsersPage()

      await waitFor(() => {
        expect(screen.getByText('No se encontraron usuarios')).toBeInTheDocument()
      })
    })

    it('renders the translated error message when loading fails', async () => {
      mockList.mockRejectedValue(new Error('network down'))
      renderUsersPage()

      await waitFor(() => {
        expect(screen.getByText('Error al cargar los usuarios')).toBeInTheDocument()
      })
    })

    it('renders the translated status and role filter options', async () => {
      renderUsersPage()

      await waitFor(() => {
        expect(screen.getByText('Todos los estados')).toBeInTheDocument()
      })
      expect(screen.getByText('Activos')).toBeInTheDocument()
      expect(screen.getByText('Inactivos')).toBeInTheDocument()
      expect(screen.getByText('Todos los roles')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Buscar' })).toBeInTheDocument()
    })
  })

  describe('pagination', () => {
    it('renders the interpolated "showing" and "page" pagination text across multiple pages', async () => {
      mockList.mockResolvedValue({
        users: [makeUser()],
        pagination: { page: 1, limit: 10, total: 25, totalPages: 3 },
      })
      renderUsersPage()

      await waitFor(() => {
        expect(screen.getByText('Mostrando 1 a 10 de 25')).toBeInTheDocument()
      })
      expect(screen.getByText('Página 1 de 3')).toBeInTheDocument()
    })
  })

  describe('delete confirmation (interpolated dialog)', () => {
    it('shows the translated confirm dialog with the user\'s full name interpolated, and skips deletion when cancelled', async () => {
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
      renderUsersPage()

      await waitFor(() => {
        expect(screen.getByText('Ana Lopez')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByRole('button', { name: '' }))
      fireEvent.click(screen.getByText('Eliminar'))

      expect(confirmSpy).toHaveBeenCalledWith('¿Estás seguro de eliminar a "Ana Lopez"?')
      expect(mockDelete).not.toHaveBeenCalled()

      confirmSpy.mockRestore()
    })

    it('deletes the user when the confirm dialog is accepted', async () => {
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
      mockDelete.mockResolvedValue({ success: true, message: 'deleted' })
      renderUsersPage()

      await waitFor(() => {
        expect(screen.getByText('Ana Lopez')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByRole('button', { name: '' }))
      fireEvent.click(screen.getByText('Eliminar'))

      await waitFor(() => {
        expect(mockDelete).toHaveBeenCalledWith('user-1')
      })

      confirmSpy.mockRestore()
    })
  })

  describe('reset password modal (interpolated dialog)', () => {
    it('renders the translated modal title and the interpolated email', async () => {
      renderUsersPage()

      await waitFor(() => {
        expect(screen.getByText('Ana Lopez')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByRole('button', { name: '' }))
      fireEvent.click(screen.getByText('Resetear contraseña'))

      expect(screen.getByText('Resetear Contraseña', { selector: 'h3' })).toBeInTheDocument()
      expect(screen.getByText('Usuario: ana@example.com')).toBeInTheDocument()
    })

    it('shows the translated password-too-short validation message', async () => {
      renderUsersPage()

      await waitFor(() => {
        expect(screen.getByText('Ana Lopez')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByRole('button', { name: '' }))
      fireEvent.click(screen.getByText('Resetear contraseña'))

      fireEvent.change(screen.getByPlaceholderText('Nueva contraseña (mín. 8 caracteres)'), {
        target: { value: 'short' },
      })

      expect(screen.getByText('La contraseña debe tener al menos 8 caracteres')).toBeInTheDocument()
    })
  })

  describe('locale switching — proves strings flow through t()', () => {
    it('renders the English title, headers and role/status badges after switching language to en', async () => {
      renderUsersPage()

      await waitFor(() => {
        expect(screen.getByText('Ana Lopez')).toBeInTheDocument()
      })

      await switchLocale('en')

      expect(screen.getByText('Users')).toBeInTheDocument()
      expect(screen.getByText('Manage all platform users')).toBeInTheDocument()
      const row = within(getUserRow('Ana Lopez'))
      expect(row.getByText('Owner')).toBeInTheDocument()
      expect(row.getByText('Active')).toBeInTheDocument()
      expect(screen.queryByText('Usuarios')).not.toBeInTheDocument()
    })

    it('renders the interpolated English delete-confirm dialog after switching language to en', async () => {
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
      renderUsersPage()

      await waitFor(() => {
        expect(screen.getByText('Ana Lopez')).toBeInTheDocument()
      })

      await switchLocale('en')

      fireEvent.click(screen.getByRole('button', { name: '' }))
      fireEvent.click(screen.getByText('Delete'))

      expect(confirmSpy).toHaveBeenCalledWith('Are you sure you want to delete "Ana Lopez"?')

      confirmSpy.mockRestore()
    })

    it('renders the Arabic title after switching language to ar', async () => {
      renderUsersPage()

      await waitFor(() => {
        expect(screen.getByText('Ana Lopez')).toBeInTheDocument()
      })

      await switchLocale('ar')

      expect(screen.getByText('المستخدمون')).toBeInTheDocument()
      expect(within(getUserRow('Ana Lopez')).getByText('نشط')).toBeInTheDocument()
    })
  })
})
