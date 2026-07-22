import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router'

// Mock react-i18next — return the key so assertions are stable regardless of locale
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

// Mock functions defined before vi.mock
const mockLogin = vi.fn()
const mockClearError = vi.fn()

// Mutable state for mocks
const mockAuthState = {
  isLoading: false,
  error: null as string | null,
  isAuthenticated: false,
}

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    login: mockLogin,
    isLoading: mockAuthState.isLoading,
    error: mockAuthState.error,
    clearError: mockClearError,
  }),
}))

vi.mock('@/stores/auth.store', () => ({
  useAuthStore: () => ({
    isAuthenticated: mockAuthState.isAuthenticated,
  }),
}))

// Import after mocks
import { LoginPage } from './LoginPage'

function renderLoginPage(initialRoute = '/login') {
  return render(
    <MemoryRouter initialEntries={[initialRoute]}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/:clinicSlug/login" element={<LoginPage />} />
        <Route path="/" element={<div>Home Page</div>} />
        <Route path="/register" element={<div>Register Page</div>} />
        <Route path="/forgot-password" element={<div>Forgot Password Page</div>} />
      </Routes>
    </MemoryRouter>
  )
}

// Helper to get password input by id
function getPasswordInput() {
  return document.getElementById('password') as HTMLInputElement
}

describe('LoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthState.isLoading = false
    mockAuthState.error = null
    mockAuthState.isAuthenticated = false
  })

  describe('rendering', () => {
    it('should render the login form', () => {
      renderLoginPage()

      expect(screen.getByRole('heading', { name: 'auth.login' })).toBeInTheDocument()
      expect(screen.getByLabelText('auth.clinicSlug')).toBeInTheDocument()
      expect(screen.getByLabelText('auth.email')).toBeInTheDocument()
      expect(getPasswordInput()).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'auth.login' })).toBeInTheDocument()
    })

    it('should render register link', () => {
      renderLoginPage()

      const registerLink = screen.getByRole('link', { name: 'auth.registerHere' })
      expect(registerLink).toBeInTheDocument()
      expect(registerLink).toHaveAttribute('href', '/register')
    })

    it('should render forgot password link', () => {
      renderLoginPage()

      const forgotLink = screen.getByRole('link', { name: 'auth.forgotPassword' })
      expect(forgotLink).toBeInTheDocument()
      expect(forgotLink).toHaveAttribute('href', '/forgot-password')
    })

    it('should hide clinic slug input when slug is in URL', () => {
      render(
        <MemoryRouter initialEntries={['/my-clinic/login']}>
          <Routes>
            <Route path="/:clinicSlug/login" element={<LoginPage />} />
          </Routes>
        </MemoryRouter>
      )

      expect(screen.queryByLabelText('auth.clinicSlug')).not.toBeInTheDocument()
    })

    it('should show "Cambiar clínica" link pointing to /login when slug is in URL', () => {
      render(
        <MemoryRouter initialEntries={['/my-clinic/login']}>
          <Routes>
            <Route path="/:clinicSlug/login" element={<LoginPage />} />
          </Routes>
        </MemoryRouter>
      )

      const changeLink = screen.getByRole('link', { name: 'auth.changeClinic' })
      expect(changeLink).toBeInTheDocument()
      expect(changeLink).toHaveAttribute('href', '/login')
    })

    it('should show clinic slug input and hide "Cambiar clínica" when no slug in URL', () => {
      renderLoginPage()

      expect(screen.getByLabelText('auth.clinicSlug')).toBeInTheDocument()
      expect(screen.queryByRole('link', { name: 'auth.changeClinic' })).not.toBeInTheDocument()
    })
  })

  describe('form validation', () => {
    it('should not call login when fields are empty', async () => {
      renderLoginPage()

      fireEvent.click(screen.getByRole('button', { name: 'auth.login' }))

      await waitFor(() => {
        expect(mockLogin).not.toHaveBeenCalled()
      })
    })

    it('should show validation error messages when fields are empty', async () => {
      renderLoginPage()

      fireEvent.click(screen.getByRole('button', { name: 'auth.login' }))

      await waitFor(() => {
        expect(screen.getByText('auth.validation.clinicSlugRequired')).toBeInTheDocument()
        expect(screen.getByText('auth.validation.invalidEmail')).toBeInTheDocument()
        expect(screen.getByText('auth.validation.passwordRequired')).toBeInTheDocument()
      })
    })

    it('should not call login with incomplete data', async () => {
      renderLoginPage()

      fireEvent.change(screen.getByLabelText('auth.email'), { target: { value: 'test@example.com' } })
      fireEvent.click(screen.getByRole('button', { name: 'auth.login' }))

      await waitFor(() => {
        expect(mockLogin).not.toHaveBeenCalled()
      })
    })
  })

  describe('form submission', () => {
    it('should call login with form data on valid submit', async () => {
      mockLogin.mockResolvedValue({})
      renderLoginPage()

      fireEvent.change(screen.getByLabelText('auth.clinicSlug'), { target: { value: 'my-clinic' } })
      fireEvent.change(screen.getByLabelText('auth.email'), { target: { value: 'test@example.com' } })
      fireEvent.change(getPasswordInput(), { target: { value: 'password123' } })
      fireEvent.click(screen.getByRole('button', { name: 'auth.login' }))

      await waitFor(() => {
        expect(mockClearError).toHaveBeenCalled()
        expect(mockLogin).toHaveBeenCalledWith({
          email: 'test@example.com',
          password: 'password123',
          clinicSlug: 'my-clinic',
        })
      })
    })

    it('should submit with clinic slug from URL when input is hidden', async () => {
      mockLogin.mockResolvedValue({})
      render(
        <MemoryRouter initialEntries={['/my-clinic/login']}>
          <Routes>
            <Route path="/:clinicSlug/login" element={<LoginPage />} />
          </Routes>
        </MemoryRouter>
      )

      fireEvent.change(screen.getByLabelText('auth.email'), { target: { value: 'test@example.com' } })
      fireEvent.change(getPasswordInput(), { target: { value: 'password123' } })
      fireEvent.click(screen.getByRole('button', { name: 'auth.login' }))

      await waitFor(() => {
        expect(mockLogin).toHaveBeenCalledWith({
          email: 'test@example.com',
          password: 'password123',
          clinicSlug: 'my-clinic',
        })
      })
    })

    it('should handle login error', async () => {
      const error = new Error('Login failed')
      mockLogin.mockRejectedValue(error)
      renderLoginPage()

      fireEvent.change(screen.getByLabelText('auth.clinicSlug'), { target: { value: 'my-clinic' } })
      fireEvent.change(screen.getByLabelText('auth.email'), { target: { value: 'test@example.com' } })
      fireEvent.change(getPasswordInput(), { target: { value: 'wrongpassword' } })
      fireEvent.click(screen.getByRole('button', { name: 'auth.login' }))

      await waitFor(() => {
        expect(mockLogin).toHaveBeenCalled()
      })
    })
  })

  describe('loading state', () => {
    it('should show loading spinner when submitting', () => {
      mockAuthState.isLoading = true
      renderLoginPage()

      expect(screen.getByText('common.loading')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'common.loading' })).toBeDisabled()
    })

    it('should disable submit button when loading', () => {
      mockAuthState.isLoading = true
      renderLoginPage()

      const submitButton = screen.getByRole('button', { name: 'common.loading' })
      expect(submitButton).toBeDisabled()
    })
  })

  describe('error display', () => {
    it('should display error message from auth state', () => {
      mockAuthState.error = 'Credenciales inválidas'
      renderLoginPage()

      expect(screen.getByText('Credenciales inválidas')).toBeInTheDocument()
    })
  })

  describe('password visibility toggle', () => {
    it('should toggle password visibility', async () => {
      renderLoginPage()

      const passwordInput = getPasswordInput()
      expect(passwordInput).toHaveAttribute('type', 'password')

      const toggleButton = screen.getByRole('button', { name: 'auth.showPassword' })
      fireEvent.click(toggleButton)

      expect(passwordInput).toHaveAttribute('type', 'text')

      fireEvent.click(screen.getByRole('button', { name: 'auth.hidePassword' }))
      expect(passwordInput).toHaveAttribute('type', 'password')
    })
  })

  describe('authenticated redirect', () => {
    it('should redirect to home if already authenticated', () => {
      mockAuthState.isAuthenticated = true
      renderLoginPage()

      expect(screen.getByText('Home Page')).toBeInTheDocument()
    })
  })
})
