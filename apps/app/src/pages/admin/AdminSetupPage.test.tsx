import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router'
import { AxiosError, AxiosHeaders } from 'axios'
// Real i18next instance — NOT mocked, so t() resolves actual es/en/ar strings
// from the locale JSON. This proves the migrated `admin.*` keys actually flow
// through t() rather than being hardcoded, per task #329.
import i18n, { i18nReady } from '@/i18n'

// Mock adminSetupApi (the real HTTP seam)
const mockCheckStatus = vi.fn()
const mockCreateSuperAdmin = vi.fn()

vi.mock('@/lib/admin-api', () => ({
  adminSetupApi: {
    checkStatus: (...args: unknown[]) => mockCheckStatus(...args),
    createSuperAdmin: (...args: unknown[]) => mockCreateSuperAdmin(...args),
  },
}))

// Helper to create AxiosError
function createAxiosError(message: string, errorData?: { message?: string }) {
  return new AxiosError(
    message,
    'ERR_BAD_REQUEST',
    undefined,
    undefined,
    {
      data: errorData ? { error: errorData } : {},
      status: 400,
      statusText: 'Bad Request',
      headers: {},
      config: { headers: new AxiosHeaders() },
    } as never
  )
}

// Import after mocks
import { AdminSetupPage } from './AdminSetupPage'
import { useAdminStore } from '@/stores/admin.store'

async function switchLocale(code: string) {
  await act(async () => {
    await i18n.changeLanguage(code)
  })
}

function renderAdminSetupPage() {
  return render(
    <MemoryRouter initialEntries={['/admin/setup']}>
      <Routes>
        <Route path="/admin/setup" element={<AdminSetupPage />} />
        <Route path="/admin/dashboard" element={<div>Admin Dashboard Page</div>} />
      </Routes>
    </MemoryRouter>
  )
}

function resetAdminStore() {
  useAdminStore.setState({
    superAdmin: null,
    accessToken: null,
    refreshToken: null,
    isAuthenticated: false,
    isLoading: false,
    error: null,
  })
}

async function fillValidForm() {
  fireEvent.change(screen.getByPlaceholderText('Ingresa la SETUP_KEY'), {
    target: { value: 'super-secret-setup-key' },
  })
  fireEvent.change(screen.getByPlaceholderText('Mike'), { target: { value: 'Ada' } })
  fireEvent.change(screen.getByPlaceholderText('Admin'), { target: { value: 'Lovelace' } })
  fireEvent.change(screen.getByPlaceholderText('admin@dental-saas.com'), {
    target: { value: 'ada@example.com' },
  })
  fireEvent.change(screen.getByPlaceholderText('Mínimo 12 caracteres'), {
    target: { value: 'Password123!' },
  })
  fireEvent.change(screen.getByPlaceholderText('Repite la contraseña'), {
    target: { value: 'Password123!' },
  })
}

describe('AdminSetupPage', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    resetAdminStore()
    mockCheckStatus.mockResolvedValue({ setupAvailable: true, message: 'ok' })
    await i18nReady
    await switchLocale('es')
  })

  afterEach(async () => {
    await switchLocale('es')
  })

  describe('rendering (es)', () => {
    it('shows the translated checking-status message while the status check is pending', () => {
      mockCheckStatus.mockImplementation(() => new Promise(() => {})) // never resolves
      renderAdminSetupPage()

      expect(screen.getByText('Verificando estado del sistema...')).toBeInTheDocument()
    })

    it('renders the translated title, subtitle and fields once setup is available', async () => {
      renderAdminSetupPage()

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: 'Configuración Inicial' })).toBeInTheDocument()
      })
      expect(screen.getByText('Crea el primer Super Administrador de la plataforma')).toBeInTheDocument()
      expect(screen.getByText('Clave de Configuración')).toBeInTheDocument()
      expect(screen.getByText('Nombre')).toBeInTheDocument()
      expect(screen.getByText('Apellido')).toBeInTheDocument()
      expect(screen.getByText('Email')).toBeInTheDocument()
      expect(screen.getByText('Contraseña')).toBeInTheDocument()
      expect(screen.getByText('Confirmar Contraseña')).toBeInTheDocument()
    })

    it('renders the translated submit button once setup is available', async () => {
      renderAdminSetupPage()

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Crear Super Admin' })).toBeInTheDocument()
      })
    })

    it('shows the translated unavailable message when setup has already been done', async () => {
      mockCheckStatus.mockResolvedValue({ setupAvailable: false, message: 'already set up' })
      renderAdminSetupPage()

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: 'Configuración No Disponible' })).toBeInTheDocument()
      })
      expect(
        screen.getByText('El super administrador ya ha sido configurado. Por favor inicia sesión.')
      ).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'Ir a Iniciar Sesión' })).toHaveAttribute(
        'href',
        '/admin/login'
      )
    })

    it('shows the translated errorCheckingStatus message when the status check fails', async () => {
      mockCheckStatus.mockRejectedValue(new Error('network down'))
      renderAdminSetupPage()

      await waitFor(() => {
        expect(screen.getByText('Error al verificar el estado del sistema')).toBeInTheDocument()
      })
    })
  })

  describe('locale switching — proves strings flow through t()', () => {
    it('renders the English title and submit label after switching language to en', async () => {
      renderAdminSetupPage()

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: 'Configuración Inicial' })).toBeInTheDocument()
      })

      await switchLocale('en')

      expect(screen.getByRole('heading', { name: 'Initial Setup' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Create Super Admin' })).toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'Configuración Inicial' })).not.toBeInTheDocument()
    })
  })

  describe('form validation', () => {
    it('does not call the API when fields are empty', async () => {
      renderAdminSetupPage()

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Crear Super Admin' })).toBeInTheDocument()
      })

      fireEvent.click(screen.getByRole('button', { name: 'Crear Super Admin' }))

      await waitFor(() => {
        expect(mockCreateSuperAdmin).not.toHaveBeenCalled()
      })
    })

    it('shows the translated validation errors when fields are empty', async () => {
      renderAdminSetupPage()

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Crear Super Admin' })).toBeInTheDocument()
      })

      fireEvent.click(screen.getByRole('button', { name: 'Crear Super Admin' }))

      await waitFor(() => {
        expect(screen.getByText('La clave de configuración es requerida')).toBeInTheDocument()
        expect(screen.getByText('Nombre requerido')).toBeInTheDocument()
        expect(screen.getByText('Apellido requerido')).toBeInTheDocument()
        expect(screen.getByText('Email inválido')).toBeInTheDocument()
        expect(screen.getByText('La contraseña debe tener al menos 12 caracteres')).toBeInTheDocument()
      })
    })

    it('shows the translated passwordComplexity error for a 12+ char password missing complexity', async () => {
      renderAdminSetupPage()

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Crear Super Admin' })).toBeInTheDocument()
      })

      fireEvent.change(screen.getByPlaceholderText('Mínimo 12 caracteres'), {
        target: { value: 'lowercaseonly12' },
      })
      fireEvent.change(screen.getByPlaceholderText('Repite la contraseña'), {
        target: { value: 'lowercaseonly12' },
      })
      fireEvent.click(screen.getByRole('button', { name: 'Crear Super Admin' }))

      await waitFor(() => {
        expect(mockCreateSuperAdmin).not.toHaveBeenCalled()
        expect(
          screen.getByText('Debe incluir mayúscula, minúscula, número y carácter especial')
        ).toBeInTheDocument()
      })
    })

    it('shows the translated passwordMismatch error when confirmation differs', async () => {
      renderAdminSetupPage()

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Crear Super Admin' })).toBeInTheDocument()
      })

      await fillValidForm()
      fireEvent.change(screen.getByPlaceholderText('Repite la contraseña'), {
        target: { value: 'Different123!' },
      })
      fireEvent.click(screen.getByRole('button', { name: 'Crear Super Admin' }))

      await waitFor(() => {
        expect(mockCreateSuperAdmin).not.toHaveBeenCalled()
        expect(screen.getByText('Las contraseñas no coinciden')).toBeInTheDocument()
      })
    })
  })

  describe('form submission', () => {
    it('calls the API with the form data on valid submit', async () => {
      mockCreateSuperAdmin.mockResolvedValue({
        success: true,
        message: 'created',
        user: {
          id: 'admin-1',
          email: 'ada@example.com',
          firstName: 'Ada',
          lastName: 'Lovelace',
          role: 'SUPER_ADMIN',
          createdAt: '2024-01-01T00:00:00Z',
        },
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      })
      renderAdminSetupPage()

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Crear Super Admin' })).toBeInTheDocument()
      })

      await fillValidForm()
      fireEvent.click(screen.getByRole('button', { name: 'Crear Super Admin' }))

      await waitFor(() => {
        expect(mockCreateSuperAdmin).toHaveBeenCalledWith({
          email: 'ada@example.com',
          password: 'Password123!',
          firstName: 'Ada',
          lastName: 'Lovelace',
          setupKey: 'super-secret-setup-key',
        })
      })
    })

    it('shows the translated success state after a successful setup', async () => {
      mockCreateSuperAdmin.mockResolvedValue({
        success: true,
        message: 'created',
        user: {
          id: 'admin-1',
          email: 'ada@example.com',
          firstName: 'Ada',
          lastName: 'Lovelace',
          role: 'SUPER_ADMIN',
          createdAt: '2024-01-01T00:00:00Z',
        },
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      })
      renderAdminSetupPage()

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Crear Super Admin' })).toBeInTheDocument()
      })

      await fillValidForm()
      fireEvent.click(screen.getByRole('button', { name: 'Crear Super Admin' }))

      await waitFor(() => {
        expect(screen.getByText('¡Super Admin Creado!')).toBeInTheDocument()
        expect(screen.getByText('Redirigiendo al panel de administración...')).toBeInTheDocument()
      })
    })
  })

  describe('error handling', () => {
    it('displays the API error message', async () => {
      mockCreateSuperAdmin.mockRejectedValue(
        createAxiosError('Request failed', { message: 'La clave de configuración es incorrecta' })
      )
      renderAdminSetupPage()

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Crear Super Admin' })).toBeInTheDocument()
      })

      await fillValidForm()
      fireEvent.click(screen.getByRole('button', { name: 'Crear Super Admin' }))

      await waitFor(() => {
        expect(screen.getByText('La clave de configuración es incorrecta')).toBeInTheDocument()
      })
    })

    it('displays the translated default errorCreatingSuperAdmin message when the API error has no message', async () => {
      mockCreateSuperAdmin.mockRejectedValue(createAxiosError('Request failed'))
      renderAdminSetupPage()

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Crear Super Admin' })).toBeInTheDocument()
      })

      await fillValidForm()
      fireEvent.click(screen.getByRole('button', { name: 'Crear Super Admin' }))

      await waitFor(() => {
        expect(screen.getByText('Error al crear el super admin')).toBeInTheDocument()
      })
    })

    it('displays the translated unexpectedError message for non-Axios errors', async () => {
      mockCreateSuperAdmin.mockRejectedValue(new Error('Network error'))
      renderAdminSetupPage()

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Crear Super Admin' })).toBeInTheDocument()
      })

      await fillValidForm()
      fireEvent.click(screen.getByRole('button', { name: 'Crear Super Admin' }))

      await waitFor(() => {
        expect(screen.getByText('Error inesperado')).toBeInTheDocument()
      })
    })
  })

  describe('loading state', () => {
    it('shows the translated submitting label and disables the button', async () => {
      mockCreateSuperAdmin.mockImplementation(() => new Promise(() => {})) // never resolves
      renderAdminSetupPage()

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Crear Super Admin' })).toBeInTheDocument()
      })

      await fillValidForm()
      fireEvent.click(screen.getByRole('button', { name: 'Crear Super Admin' }))

      await waitFor(() => {
        expect(screen.getByText('Creando Super Admin...')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /Creando Super Admin/ })).toBeDisabled()
      })
    })
  })

  describe('authenticated redirect', () => {
    it('redirects to the dashboard when already authenticated', () => {
      useAdminStore.setState({ isAuthenticated: true })
      renderAdminSetupPage()

      expect(screen.getByText('Admin Dashboard Page')).toBeInTheDocument()
    })
  })
})
