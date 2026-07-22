import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router'
import { AxiosError, AxiosHeaders } from 'axios'

// Mock react-i18next — return the key so assertions are stable regardless of locale
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

// Mock apiClient
const mockPost = vi.fn()

vi.mock('@/lib/api', () => ({
  apiClient: {
    post: (...args: unknown[]) => mockPost(...args),
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
import { ForgotPasswordPage } from './ForgotPasswordPage'

function renderForgotPasswordPage() {
  return render(
    <MemoryRouter initialEntries={['/forgot-password']}>
      <Routes>
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/login" element={<div>Login Page</div>} />
      </Routes>
    </MemoryRouter>
  )
}

describe('ForgotPasswordPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('rendering', () => {
    it('should render the forgot password form', () => {
      renderForgotPasswordPage()

      expect(screen.getByRole('heading', { name: 'auth.recoverPasswordTitle' })).toBeInTheDocument()
      expect(screen.getByLabelText('auth.clinicSlug')).toBeInTheDocument()
      expect(screen.getByLabelText('auth.email')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'auth.sendResetLink' })).toBeInTheDocument()
    })

    it('should render back to login link', () => {
      renderForgotPasswordPage()

      const loginLink = screen.getByRole('link', { name: 'auth.backToLogin' })
      expect(loginLink).toBeInTheDocument()
      expect(loginLink).toHaveAttribute('href', '/login')
    })

    it('should render description text', () => {
      renderForgotPasswordPage()

      expect(screen.getByText('auth.recoverPasswordSubtitle')).toBeInTheDocument()
    })
  })

  describe('form validation', () => {
    it('should not call API when fields are empty', async () => {
      renderForgotPasswordPage()

      fireEvent.click(screen.getByRole('button', { name: 'auth.sendResetLink' }))

      await waitFor(() => {
        expect(mockPost).not.toHaveBeenCalled()
      })
    })

    it('should not call API with invalid email', async () => {
      renderForgotPasswordPage()

      fireEvent.change(screen.getByLabelText('auth.email'), { target: { value: 'invalid-email' } })
      fireEvent.change(screen.getByLabelText('auth.clinicSlug'), { target: { value: 'my-clinic' } })
      fireEvent.click(screen.getByRole('button', { name: 'auth.sendResetLink' }))

      await waitFor(() => {
        expect(mockPost).not.toHaveBeenCalled()
      })
    })

    it('should show validation error messages when fields are empty', async () => {
      renderForgotPasswordPage()

      fireEvent.click(screen.getByRole('button', { name: 'auth.sendResetLink' }))

      await waitFor(() => {
        expect(screen.getByText('auth.validation.clinicSlugRequired')).toBeInTheDocument()
        expect(screen.getByText('auth.validation.invalidEmail')).toBeInTheDocument()
      })
    })

    it('should not call API with empty clinic slug', async () => {
      renderForgotPasswordPage()

      fireEvent.change(screen.getByLabelText('auth.email'), { target: { value: 'test@example.com' } })
      fireEvent.click(screen.getByRole('button', { name: 'auth.sendResetLink' }))

      await waitFor(() => {
        expect(mockPost).not.toHaveBeenCalled()
      })
    })
  })

  describe('form submission', () => {
    it('should call API with form data on valid submit', async () => {
      mockPost.mockResolvedValue({})
      renderForgotPasswordPage()

      fireEvent.change(screen.getByLabelText('auth.clinicSlug'), { target: { value: 'my-clinic' } })
      fireEvent.change(screen.getByLabelText('auth.email'), { target: { value: 'test@example.com' } })
      fireEvent.click(screen.getByRole('button', { name: 'auth.sendResetLink' }))

      await waitFor(() => {
        expect(mockPost).toHaveBeenCalledWith('/auth/forgot-password', {
          email: 'test@example.com',
          clinicSlug: 'my-clinic',
        })
      })
    })

    it('should show success state after successful submission', async () => {
      mockPost.mockResolvedValue({})
      renderForgotPasswordPage()

      fireEvent.change(screen.getByLabelText('auth.clinicSlug'), { target: { value: 'my-clinic' } })
      fireEvent.change(screen.getByLabelText('auth.email'), { target: { value: 'test@example.com' } })
      fireEvent.click(screen.getByRole('button', { name: 'auth.sendResetLink' }))

      await waitFor(() => {
        expect(screen.getByText('auth.checkYourEmail')).toBeInTheDocument()
        expect(screen.getByText('auth.forgotPasswordSuccessMessage')).toBeInTheDocument()
      })
    })

    it('should show spam folder reminder after success', async () => {
      mockPost.mockResolvedValue({})
      renderForgotPasswordPage()

      fireEvent.change(screen.getByLabelText('auth.clinicSlug'), { target: { value: 'my-clinic' } })
      fireEvent.change(screen.getByLabelText('auth.email'), { target: { value: 'test@example.com' } })
      fireEvent.click(screen.getByRole('button', { name: 'auth.sendResetLink' }))

      await waitFor(() => {
        expect(screen.getByText('auth.checkSpamFolder')).toBeInTheDocument()
      })
    })

    it('should hide form after successful submission', async () => {
      mockPost.mockResolvedValue({})
      renderForgotPasswordPage()

      fireEvent.change(screen.getByLabelText('auth.clinicSlug'), { target: { value: 'my-clinic' } })
      fireEvent.change(screen.getByLabelText('auth.email'), { target: { value: 'test@example.com' } })
      fireEvent.click(screen.getByRole('button', { name: 'auth.sendResetLink' }))

      await waitFor(() => {
        expect(screen.queryByLabelText('auth.email')).not.toBeInTheDocument()
        expect(screen.queryByRole('button', { name: 'auth.sendResetLink' })).not.toBeInTheDocument()
      })
    })
  })

  describe('error handling', () => {
    it('should display API error message', async () => {
      mockPost.mockRejectedValue(createAxiosError('Request failed', { message: 'Usuario no encontrado' }))
      renderForgotPasswordPage()

      fireEvent.change(screen.getByLabelText('auth.clinicSlug'), { target: { value: 'my-clinic' } })
      fireEvent.change(screen.getByLabelText('auth.email'), { target: { value: 'test@example.com' } })
      fireEvent.click(screen.getByRole('button', { name: 'auth.sendResetLink' }))

      await waitFor(() => {
        expect(screen.getByText('Usuario no encontrado')).toBeInTheDocument()
      })
    })

    it('should display default error message for API error without message', async () => {
      mockPost.mockRejectedValue(createAxiosError('Request failed'))
      renderForgotPasswordPage()

      fireEvent.change(screen.getByLabelText('auth.clinicSlug'), { target: { value: 'my-clinic' } })
      fireEvent.change(screen.getByLabelText('auth.email'), { target: { value: 'test@example.com' } })
      fireEvent.click(screen.getByRole('button', { name: 'auth.sendResetLink' }))

      await waitFor(() => {
        expect(screen.getByText('auth.errorProcessingRequest')).toBeInTheDocument()
      })
    })

    it('should display unexpected error message for non-Axios errors', async () => {
      mockPost.mockRejectedValue(new Error('Network error'))
      renderForgotPasswordPage()

      fireEvent.change(screen.getByLabelText('auth.clinicSlug'), { target: { value: 'my-clinic' } })
      fireEvent.change(screen.getByLabelText('auth.email'), { target: { value: 'test@example.com' } })
      fireEvent.click(screen.getByRole('button', { name: 'auth.sendResetLink' }))

      await waitFor(() => {
        expect(screen.getByText('auth.unexpectedError')).toBeInTheDocument()
      })
    })
  })

  describe('loading state', () => {
    it('should show loading spinner while submitting', async () => {
      mockPost.mockImplementation(() => new Promise(() => {})) // Never resolves
      renderForgotPasswordPage()

      fireEvent.change(screen.getByLabelText('auth.clinicSlug'), { target: { value: 'my-clinic' } })
      fireEvent.change(screen.getByLabelText('auth.email'), { target: { value: 'test@example.com' } })
      fireEvent.click(screen.getByRole('button', { name: 'auth.sendResetLink' }))

      await waitFor(() => {
        expect(screen.getByText('auth.sending')).toBeInTheDocument()
      })
    })

    it('should disable button while submitting', async () => {
      mockPost.mockImplementation(() => new Promise(() => {}))
      renderForgotPasswordPage()

      fireEvent.change(screen.getByLabelText('auth.clinicSlug'), { target: { value: 'my-clinic' } })
      fireEvent.change(screen.getByLabelText('auth.email'), { target: { value: 'test@example.com' } })
      fireEvent.click(screen.getByRole('button', { name: 'auth.sendResetLink' }))

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'auth.sending' })).toBeDisabled()
      })
    })
  })
})
