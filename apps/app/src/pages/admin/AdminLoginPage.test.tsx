import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router'
import { AxiosError, AxiosHeaders } from 'axios'
// Real i18next instance — NOT mocked, so t() resolves actual es/en/ar strings
// from the locale JSON. This proves the migrated `admin.*` keys actually flow
// through t() rather than being hardcoded, per task #329.
import i18n, { i18nReady } from '@/i18n'

// Mock adminApiClient (the real HTTP seam) — everything else is real
const mockPost = vi.fn()

vi.mock('@/lib/admin-api', () => ({
  adminApiClient: {
    post: (...args: unknown[]) => mockPost(...args),
  },
}))

// Real admin store — reset to a clean slate before each test instead of mocking
import { useAdminStore } from '@/stores/admin.store'

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
import { AdminLoginPage } from './AdminLoginPage'

async function switchLocale(code: string) {
  await act(async () => {
    await i18n.changeLanguage(code)
  })
}

function renderAdminLoginPage() {
  return render(
    <MemoryRouter initialEntries={['/admin/login']}>
      <Routes>
        <Route path="/admin/login" element={<AdminLoginPage />} />
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

describe('AdminLoginPage', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    resetAdminStore()
    await i18nReady
    await switchLocale('es')
  })

  afterEach(async () => {
    await switchLocale('es')
  })

  describe('rendering (es)', () => {
    it('renders the translated title and subtitle', () => {
      renderAdminLoginPage()

      expect(screen.getByRole('heading', { name: 'Super Admin' })).toBeInTheDocument()
      expect(screen.getByText('Panel de Administración de Plataforma')).toBeInTheDocument()
    })

    it('renders email and password fields with translated labels', () => {
      renderAdminLoginPage()

      expect(screen.getByText('Email')).toBeInTheDocument()
      expect(screen.getByText('Contraseña')).toBeInTheDocument()
      expect(screen.getByPlaceholderText('admin@dental-saas.com')).toBeInTheDocument()
    })

    it('renders the translated submit button', () => {
      renderAdminLoginPage()

      expect(screen.getByRole('button', { name: 'Iniciar Sesión' })).toBeInTheDocument()
    })

    it('renders the translated forgot-password link', () => {
      renderAdminLoginPage()

      expect(screen.getByRole('link', { name: '¿Olvidaste tu contraseña?' })).toHaveAttribute(
        'href',
        '/admin/forgot-password'
      )
    })

    it('renders the translated first-time setup prompt and link', () => {
      renderAdminLoginPage()

      expect(screen.getByText('¿Primera vez?')).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'Configurar Super Admin' })).toHaveAttribute(
        'href',
        '/admin/setup'
      )
    })
  })

  describe('locale switching — proves strings flow through t()', () => {
    it('renders the English subtitle after switching language to en', async () => {
      renderAdminLoginPage()

      expect(screen.getByText('Panel de Administración de Plataforma')).toBeInTheDocument()

      await switchLocale('en')

      expect(screen.getByText('Platform Administration Panel')).toBeInTheDocument()
      expect(screen.queryByText('Panel de Administración de Plataforma')).not.toBeInTheDocument()
    })

    it('renders the English submit button label after switching language to en', async () => {
      renderAdminLoginPage()

      await switchLocale('en')

      expect(screen.getByRole('button', { name: 'Sign In' })).toBeInTheDocument()
    })
  })

  describe('form validation', () => {
    it('does not call the API when fields are empty', async () => {
      renderAdminLoginPage()

      fireEvent.click(screen.getByRole('button', { name: 'Iniciar Sesión' }))

      await waitFor(() => {
        expect(mockPost).not.toHaveBeenCalled()
      })
    })

    it('shows translated validation errors when fields are empty', async () => {
      renderAdminLoginPage()

      fireEvent.click(screen.getByRole('button', { name: 'Iniciar Sesión' }))

      await waitFor(() => {
        expect(screen.getByText('Email inválido')).toBeInTheDocument()
        expect(screen.getByText('La contraseña es requerida')).toBeInTheDocument()
      })
    })
  })

  describe('form submission', () => {
    it('calls the API with form data on valid submit', async () => {
      mockPost.mockResolvedValue({
        data: {
          user: {
            id: 'admin-1',
            email: 'admin@example.com',
            firstName: 'Super',
            lastName: 'Admin',
            createdAt: '2024-01-01T00:00:00Z',
          },
          accessToken: 'access-token',
          refreshToken: 'refresh-token',
        },
      })
      renderAdminLoginPage()

      fireEvent.change(screen.getByPlaceholderText('admin@dental-saas.com'), {
        target: { value: 'admin@example.com' },
      })
      fireEvent.change(screen.getByPlaceholderText('••••••••••••'), {
        target: { value: 'Password1!' },
      })
      fireEvent.click(screen.getByRole('button', { name: 'Iniciar Sesión' }))

      await waitFor(() => {
        expect(mockPost).toHaveBeenCalledWith('/auth/login', {
          email: 'admin@example.com',
          password: 'Password1!',
        })
      })
    })

    it('navigates to the dashboard after a successful login', async () => {
      mockPost.mockResolvedValue({
        data: {
          user: {
            id: 'admin-1',
            email: 'admin@example.com',
            firstName: 'Super',
            lastName: 'Admin',
            createdAt: '2024-01-01T00:00:00Z',
          },
          accessToken: 'access-token',
          refreshToken: 'refresh-token',
        },
      })
      renderAdminLoginPage()

      fireEvent.change(screen.getByPlaceholderText('admin@dental-saas.com'), {
        target: { value: 'admin@example.com' },
      })
      fireEvent.change(screen.getByPlaceholderText('••••••••••••'), {
        target: { value: 'Password1!' },
      })
      fireEvent.click(screen.getByRole('button', { name: 'Iniciar Sesión' }))

      await waitFor(() => {
        expect(screen.getByText('Admin Dashboard Page')).toBeInTheDocument()
      })
    })
  })

  describe('error handling', () => {
    it('displays the API error message', async () => {
      mockPost.mockRejectedValue(createAxiosError('Request failed', { message: 'Cuenta suspendida' }))
      renderAdminLoginPage()

      fireEvent.change(screen.getByPlaceholderText('admin@dental-saas.com'), {
        target: { value: 'admin@example.com' },
      })
      fireEvent.change(screen.getByPlaceholderText('••••••••••••'), {
        target: { value: 'wrongpassword' },
      })
      fireEvent.click(screen.getByRole('button', { name: 'Iniciar Sesión' }))

      await waitFor(() => {
        expect(screen.getByText('Cuenta suspendida')).toBeInTheDocument()
      })
    })

    it('displays the translated default invalidCredentials message when the API error has no message', async () => {
      mockPost.mockRejectedValue(createAxiosError('Request failed'))
      renderAdminLoginPage()

      fireEvent.change(screen.getByPlaceholderText('admin@dental-saas.com'), {
        target: { value: 'admin@example.com' },
      })
      fireEvent.change(screen.getByPlaceholderText('••••••••••••'), {
        target: { value: 'wrongpassword' },
      })
      fireEvent.click(screen.getByRole('button', { name: 'Iniciar Sesión' }))

      await waitFor(() => {
        expect(screen.getByText('Credenciales inválidas')).toBeInTheDocument()
      })
    })

    it('displays the translated unexpectedError message for non-Axios errors', async () => {
      mockPost.mockRejectedValue(new Error('Network error'))
      renderAdminLoginPage()

      fireEvent.change(screen.getByPlaceholderText('admin@dental-saas.com'), {
        target: { value: 'admin@example.com' },
      })
      fireEvent.change(screen.getByPlaceholderText('••••••••••••'), {
        target: { value: 'wrongpassword' },
      })
      fireEvent.click(screen.getByRole('button', { name: 'Iniciar Sesión' }))

      await waitFor(() => {
        expect(screen.getByText('Error inesperado')).toBeInTheDocument()
      })
    })
  })

  describe('loading state', () => {
    it('shows the translated submitting label and disables the button', async () => {
      mockPost.mockImplementation(() => new Promise(() => {})) // never resolves
      renderAdminLoginPage()

      fireEvent.change(screen.getByPlaceholderText('admin@dental-saas.com'), {
        target: { value: 'admin@example.com' },
      })
      fireEvent.change(screen.getByPlaceholderText('••••••••••••'), {
        target: { value: 'Password1!' },
      })
      fireEvent.click(screen.getByRole('button', { name: 'Iniciar Sesión' }))

      await waitFor(() => {
        expect(screen.getByText('Iniciando sesión...')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /Iniciando sesión/ })).toBeDisabled()
      })
    })
  })

  describe('password visibility toggle', () => {
    it('toggles the password input type', () => {
      const { container } = renderAdminLoginPage()

      const passwordInput = screen.getByPlaceholderText('••••••••••••') as HTMLInputElement
      expect(passwordInput).toHaveAttribute('type', 'password')

      const toggleButton = container.querySelector('button[type="button"]') as HTMLButtonElement
      fireEvent.click(toggleButton)

      expect(passwordInput).toHaveAttribute('type', 'text')
    })
  })

  describe('authenticated redirect', () => {
    it('redirects to the dashboard when already authenticated', () => {
      useAdminStore.setState({ isAuthenticated: true })
      renderAdminLoginPage()

      expect(screen.getByText('Admin Dashboard Page')).toBeInTheDocument()
    })
  })
})
