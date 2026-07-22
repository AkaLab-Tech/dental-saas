import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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
function createAxiosError(message: string, errorData?: { code?: string; message?: string }) {
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
import { ResetPasswordPage } from './ResetPasswordPage'

function renderResetPasswordPage(token: string | null = 'valid-token') {
  const route = token ? `/reset-password?token=${token}` : '/reset-password'
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/login" element={<div>Login Page</div>} />
        <Route path="/forgot-password" element={<div>Forgot Password Page</div>} />
      </Routes>
    </MemoryRouter>
  )
}

describe('ResetPasswordPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('rendering', () => {
    it('should render the reset password form with valid token', () => {
      renderResetPasswordPage()

      expect(screen.getByRole('heading', { name: 'auth.newPassword' })).toBeInTheDocument()
      expect(screen.getByLabelText('auth.newPassword')).toBeInTheDocument()
      expect(screen.getByLabelText('auth.confirmPassword')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'auth.resetPassword' })).toBeInTheDocument()
    })

    it('should render back to login link', () => {
      renderResetPasswordPage()

      const loginLink = screen.getByRole('link', { name: 'auth.backToLogin' })
      expect(loginLink).toBeInTheDocument()
      expect(loginLink).toHaveAttribute('href', '/login')
    })

    it('should show error when token is missing', () => {
      renderResetPasswordPage(null)

      expect(screen.getByText('auth.invalidResetLink')).toBeInTheDocument()
    })

    it('should show request new link when token is missing', () => {
      renderResetPasswordPage(null)

      const newLinkButton = screen.getByRole('link', { name: 'auth.requestNewResetLink' })
      expect(newLinkButton).toBeInTheDocument()
      expect(newLinkButton).toHaveAttribute('href', '/forgot-password')
    })
  })

  describe('form validation', () => {
    it('should not call API when fields are empty', async () => {
      vi.useRealTimers()
      renderResetPasswordPage()

      fireEvent.click(screen.getByRole('button', { name: 'auth.resetPassword' }))

      await waitFor(() => {
        expect(mockPost).not.toHaveBeenCalled()
      })
    })

    it('should show validation error messages when fields are empty', async () => {
      vi.useRealTimers()
      renderResetPasswordPage()

      fireEvent.click(screen.getByRole('button', { name: 'auth.resetPassword' }))

      await waitFor(() => {
        expect(screen.getByText('auth.validation.passwordMinLength')).toBeInTheDocument()
      })
    })

    it('should not call API with short password', async () => {
      vi.useRealTimers()
      renderResetPasswordPage()

      fireEvent.change(screen.getByLabelText('auth.newPassword'), { target: { value: 'short' } })
      fireEvent.change(screen.getByLabelText('auth.confirmPassword'), { target: { value: 'short' } })
      fireEvent.click(screen.getByRole('button', { name: 'auth.resetPassword' }))

      await waitFor(() => {
        expect(mockPost).not.toHaveBeenCalled()
        expect(screen.getByText('auth.validation.passwordMinLength')).toBeInTheDocument()
      })
    })

    it('should not call API with password missing special character', async () => {
      vi.useRealTimers()
      renderResetPasswordPage()

      fireEvent.change(screen.getByLabelText('auth.newPassword'), { target: { value: 'Password123' } })
      fireEvent.change(screen.getByLabelText('auth.confirmPassword'), { target: { value: 'Password123' } })
      fireEvent.click(screen.getByRole('button', { name: 'auth.resetPassword' }))

      await waitFor(() => {
        expect(mockPost).not.toHaveBeenCalled()
        expect(screen.getByText('auth.validation.passwordComplexityBasic')).toBeInTheDocument()
      })
    })

    it('should not call API when passwords do not match', async () => {
      vi.useRealTimers()
      renderResetPasswordPage()

      fireEvent.change(screen.getByLabelText('auth.newPassword'), { target: { value: 'Password1!' } })
      fireEvent.change(screen.getByLabelText('auth.confirmPassword'), { target: { value: 'Different1!' } })
      fireEvent.click(screen.getByRole('button', { name: 'auth.resetPassword' }))

      await waitFor(() => {
        expect(mockPost).not.toHaveBeenCalled()
        expect(screen.getByText('auth.validation.passwordMismatch')).toBeInTheDocument()
      })
    })
  })

  describe('form submission', () => {
    it('should call API with token and new password', async () => {
      vi.useRealTimers()
      mockPost.mockResolvedValue({})
      renderResetPasswordPage('my-reset-token')

      fireEvent.change(screen.getByLabelText('auth.newPassword'), { target: { value: 'NewPassword1!' } })
      fireEvent.change(screen.getByLabelText('auth.confirmPassword'), { target: { value: 'NewPassword1!' } })
      fireEvent.click(screen.getByRole('button', { name: 'auth.resetPassword' }))

      await waitFor(() => {
        expect(mockPost).toHaveBeenCalledWith('/auth/reset-password', {
          token: 'my-reset-token',
          password: 'NewPassword1!',
        })
      })
    })

    it('should show success state after successful reset', async () => {
      vi.useRealTimers()
      mockPost.mockResolvedValue({})
      renderResetPasswordPage()

      fireEvent.change(screen.getByLabelText('auth.newPassword'), { target: { value: 'NewPassword1!' } })
      fireEvent.change(screen.getByLabelText('auth.confirmPassword'), { target: { value: 'NewPassword1!' } })
      fireEvent.click(screen.getByRole('button', { name: 'auth.resetPassword' }))

      await waitFor(() => {
        expect(screen.getByText('auth.passwordUpdated')).toBeInTheDocument()
        expect(screen.getByText('auth.passwordResetSuccessMessage')).toBeInTheDocument()
      })
    })

    it('should hide form after successful reset', async () => {
      vi.useRealTimers()
      mockPost.mockResolvedValue({})
      renderResetPasswordPage()

      fireEvent.change(screen.getByLabelText('auth.newPassword'), { target: { value: 'NewPassword1!' } })
      fireEvent.change(screen.getByLabelText('auth.confirmPassword'), { target: { value: 'NewPassword1!' } })
      fireEvent.click(screen.getByRole('button', { name: 'auth.resetPassword' }))

      await waitFor(() => {
        expect(screen.queryByLabelText('auth.newPassword')).not.toBeInTheDocument()
        expect(screen.queryByRole('button', { name: 'auth.resetPassword' })).not.toBeInTheDocument()
      })
    })

    it('should not submit when token is missing', async () => {
      vi.useRealTimers()
      renderResetPasswordPage(null)

      // Form fields are not rendered when token is missing
      expect(screen.queryByLabelText('auth.newPassword')).not.toBeInTheDocument()
      expect(mockPost).not.toHaveBeenCalled()
    })
  })

  describe('error handling', () => {
    it('should display TOKEN_EXPIRED error message', async () => {
      vi.useRealTimers()
      mockPost.mockRejectedValue(createAxiosError('Request failed', { code: 'TOKEN_EXPIRED', message: 'Token expired' }))
      renderResetPasswordPage()

      fireEvent.change(screen.getByLabelText('auth.newPassword'), { target: { value: 'NewPassword1!' } })
      fireEvent.change(screen.getByLabelText('auth.confirmPassword'), { target: { value: 'NewPassword1!' } })
      fireEvent.click(screen.getByRole('button', { name: 'auth.resetPassword' }))

      await waitFor(() => {
        expect(screen.getByText('auth.tokenExpired')).toBeInTheDocument()
      })
    })

    it('should display TOKEN_USED error message', async () => {
      vi.useRealTimers()
      mockPost.mockRejectedValue(createAxiosError('Request failed', { code: 'TOKEN_USED', message: 'Token used' }))
      renderResetPasswordPage()

      fireEvent.change(screen.getByLabelText('auth.newPassword'), { target: { value: 'NewPassword1!' } })
      fireEvent.change(screen.getByLabelText('auth.confirmPassword'), { target: { value: 'NewPassword1!' } })
      fireEvent.click(screen.getByRole('button', { name: 'auth.resetPassword' }))

      await waitFor(() => {
        expect(screen.getByText('auth.tokenUsed')).toBeInTheDocument()
      })
    })

    it('should display INVALID_TOKEN error message', async () => {
      vi.useRealTimers()
      mockPost.mockRejectedValue(createAxiosError('Request failed', { code: 'INVALID_TOKEN', message: 'Invalid token' }))
      renderResetPasswordPage()

      fireEvent.change(screen.getByLabelText('auth.newPassword'), { target: { value: 'NewPassword1!' } })
      fireEvent.change(screen.getByLabelText('auth.confirmPassword'), { target: { value: 'NewPassword1!' } })
      fireEvent.click(screen.getByRole('button', { name: 'auth.resetPassword' }))

      await waitFor(() => {
        expect(screen.getByText('auth.invalidToken')).toBeInTheDocument()
      })
    })

    it('should display ACCOUNT_INACTIVE error message', async () => {
      vi.useRealTimers()
      mockPost.mockRejectedValue(createAxiosError('Request failed', { code: 'ACCOUNT_INACTIVE', message: 'Account inactive' }))
      renderResetPasswordPage()

      fireEvent.change(screen.getByLabelText('auth.newPassword'), { target: { value: 'NewPassword1!' } })
      fireEvent.change(screen.getByLabelText('auth.confirmPassword'), { target: { value: 'NewPassword1!' } })
      fireEvent.click(screen.getByRole('button', { name: 'auth.resetPassword' }))

      await waitFor(() => {
        expect(screen.getByText('auth.accountInactive')).toBeInTheDocument()
      })
    })

    it('should display API error message for unknown error codes', async () => {
      vi.useRealTimers()
      mockPost.mockRejectedValue(createAxiosError('Request failed', { code: 'UNKNOWN_ERROR', message: 'Something went wrong' }))
      renderResetPasswordPage()

      fireEvent.change(screen.getByLabelText('auth.newPassword'), { target: { value: 'NewPassword1!' } })
      fireEvent.change(screen.getByLabelText('auth.confirmPassword'), { target: { value: 'NewPassword1!' } })
      fireEvent.click(screen.getByRole('button', { name: 'auth.resetPassword' }))

      await waitFor(() => {
        expect(screen.getByText('Something went wrong')).toBeInTheDocument()
      })
    })

    it('should display unexpected error for non-Axios errors', async () => {
      vi.useRealTimers()
      mockPost.mockRejectedValue(new Error('Network error'))
      renderResetPasswordPage()

      fireEvent.change(screen.getByLabelText('auth.newPassword'), { target: { value: 'NewPassword1!' } })
      fireEvent.change(screen.getByLabelText('auth.confirmPassword'), { target: { value: 'NewPassword1!' } })
      fireEvent.click(screen.getByRole('button', { name: 'auth.resetPassword' }))

      await waitFor(() => {
        expect(screen.getByText('auth.unexpectedError')).toBeInTheDocument()
      })
    })
  })

  describe('loading state', () => {
    it('should show loading spinner while submitting', async () => {
      vi.useRealTimers()
      mockPost.mockImplementation(() => new Promise(() => {}))
      renderResetPasswordPage()

      fireEvent.change(screen.getByLabelText('auth.newPassword'), { target: { value: 'NewPassword1!' } })
      fireEvent.change(screen.getByLabelText('auth.confirmPassword'), { target: { value: 'NewPassword1!' } })
      fireEvent.click(screen.getByRole('button', { name: 'auth.resetPassword' }))

      await waitFor(() => {
        expect(screen.getByText('auth.updating')).toBeInTheDocument()
      })
    })

    it('should disable button while submitting', async () => {
      vi.useRealTimers()
      mockPost.mockImplementation(() => new Promise(() => {}))
      renderResetPasswordPage()

      fireEvent.change(screen.getByLabelText('auth.newPassword'), { target: { value: 'NewPassword1!' } })
      fireEvent.change(screen.getByLabelText('auth.confirmPassword'), { target: { value: 'NewPassword1!' } })
      fireEvent.click(screen.getByRole('button', { name: 'auth.resetPassword' }))

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'auth.updating' })).toBeDisabled()
      })
    })
  })

  describe('password visibility toggle', () => {
    it('should toggle password visibility', async () => {
      renderResetPasswordPage()

      const passwordInput = screen.getByLabelText('auth.newPassword')
      expect(passwordInput).toHaveAttribute('type', 'password')

      const toggleButtons = screen.getAllByRole('button', { name: 'auth.showPassword' })
      fireEvent.click(toggleButtons[0])

      expect(passwordInput).toHaveAttribute('type', 'text')
    })

    it('should toggle confirm password visibility', async () => {
      renderResetPasswordPage()

      const confirmPasswordInput = screen.getByLabelText('auth.confirmPassword')
      expect(confirmPasswordInput).toHaveAttribute('type', 'password')

      const toggleButtons = screen.getAllByRole('button', { name: 'auth.showPassword' })
      fireEvent.click(toggleButtons[1])

      expect(confirmPasswordInput).toHaveAttribute('type', 'text')
    })
  })
})
