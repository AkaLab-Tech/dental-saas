import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router'
import { AxiosError, AxiosHeaders } from 'axios'
// Real i18next instance — NOT mocked, so t() resolves actual es/en/ar strings
// from the locale JSON. This proves the migrated `admin.*` keys actually flow
// through t() rather than being hardcoded, per task #329.
import i18n, { i18nReady } from '@/i18n'

// Mock adminApiClient (the real HTTP seam)
const mockPost = vi.fn()

vi.mock('@/lib/admin-api', () => ({
  adminApiClient: {
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
import { AdminResetPasswordPage } from './AdminResetPasswordPage'

async function switchLocale(code: string) {
  await act(async () => {
    await i18n.changeLanguage(code)
  })
}

function renderAdminResetPasswordPage(token: string | null = 'valid-token') {
  const route = token ? `/admin/reset-password?token=${token}` : '/admin/reset-password'
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route path="/admin/reset-password" element={<AdminResetPasswordPage />} />
        <Route path="/admin/login" element={<div>Admin Login Page</div>} />
        <Route path="/admin/forgot-password" element={<div>Admin Forgot Password Page</div>} />
      </Routes>
    </MemoryRouter>
  )
}

describe('AdminResetPasswordPage', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    await i18nReady
    await switchLocale('es')
  })

  afterEach(async () => {
    await switchLocale('es')
  })

  describe('rendering (es)', () => {
    it('renders the translated title and form fields for a valid token', () => {
      renderAdminResetPasswordPage()

      expect(screen.getByRole('heading', { name: 'Nueva Contraseña' })).toBeInTheDocument()
      expect(screen.getByText('Panel de Super Administrador')).toBeInTheDocument()
      expect(screen.getByLabelText('Nueva contraseña')).toBeInTheDocument()
      expect(screen.getByLabelText('Confirmar contraseña')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Restablecer contraseña' })).toBeInTheDocument()
    })

    it('renders the translated back-to-login link', () => {
      renderAdminResetPasswordPage()

      expect(screen.getByRole('link', { name: 'Volver al inicio de sesión' })).toHaveAttribute(
        'href',
        '/admin/login'
      )
    })

    it('shows the translated invalid-link message when the token is missing', () => {
      renderAdminResetPasswordPage(null)

      expect(screen.getByText('Enlace inválido')).toBeInTheDocument()
      expect(
        screen.getByText('Este enlace de restablecimiento no es válido o ha expirado.')
      ).toBeInTheDocument()
    })

    it('shows the translated request-new-link action when the token is missing', () => {
      renderAdminResetPasswordPage(null)

      expect(screen.getByRole('link', { name: 'Solicitar nuevo enlace' })).toHaveAttribute(
        'href',
        '/admin/forgot-password'
      )
    })
  })

  describe('locale switching — proves strings flow through t()', () => {
    it('renders the English title and submit label after switching language to en', async () => {
      renderAdminResetPasswordPage()

      expect(screen.getByRole('heading', { name: 'Nueva Contraseña' })).toBeInTheDocument()

      await switchLocale('en')

      expect(screen.getByRole('heading', { name: 'New Password' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Reset password' })).toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'Nueva Contraseña' })).not.toBeInTheDocument()
    })
  })

  describe('form validation', () => {
    it('does not call the API when fields are empty', async () => {
      renderAdminResetPasswordPage()

      fireEvent.click(screen.getByRole('button', { name: 'Restablecer contraseña' }))

      await waitFor(() => {
        expect(mockPost).not.toHaveBeenCalled()
      })
    })

    it('shows the translated passwordMinLength8 error for a short password', async () => {
      renderAdminResetPasswordPage()

      fireEvent.change(screen.getByLabelText('Nueva contraseña'), { target: { value: 'Ab1!' } })
      fireEvent.change(screen.getByLabelText('Confirmar contraseña'), { target: { value: 'Ab1!' } })
      fireEvent.click(screen.getByRole('button', { name: 'Restablecer contraseña' }))

      await waitFor(() => {
        expect(mockPost).not.toHaveBeenCalled()
        expect(
          screen.getByText('La contraseña debe tener al menos 8 caracteres')
        ).toBeInTheDocument()
      })
    })

    it('shows the translated passwordComplexity error for a password missing special characters', async () => {
      renderAdminResetPasswordPage()

      fireEvent.change(screen.getByLabelText('Nueva contraseña'), { target: { value: 'Password123' } })
      fireEvent.change(screen.getByLabelText('Confirmar contraseña'), { target: { value: 'Password123' } })
      fireEvent.click(screen.getByRole('button', { name: 'Restablecer contraseña' }))

      await waitFor(() => {
        expect(mockPost).not.toHaveBeenCalled()
        expect(
          screen.getByText('Debe incluir mayúscula, minúscula, número y carácter especial')
        ).toBeInTheDocument()
      })
    })

    it('shows the translated passwordMismatch error when confirmation differs', async () => {
      renderAdminResetPasswordPage()

      fireEvent.change(screen.getByLabelText('Nueva contraseña'), { target: { value: 'Password1!' } })
      fireEvent.change(screen.getByLabelText('Confirmar contraseña'), { target: { value: 'Different1!' } })
      fireEvent.click(screen.getByRole('button', { name: 'Restablecer contraseña' }))

      await waitFor(() => {
        expect(mockPost).not.toHaveBeenCalled()
        expect(screen.getByText('Las contraseñas no coinciden')).toBeInTheDocument()
      })
    })
  })

  describe('form submission', () => {
    it('calls the API with the token and new password', async () => {
      mockPost.mockResolvedValue({})
      renderAdminResetPasswordPage('my-reset-token')

      fireEvent.change(screen.getByLabelText('Nueva contraseña'), { target: { value: 'NewPassword1!' } })
      fireEvent.change(screen.getByLabelText('Confirmar contraseña'), { target: { value: 'NewPassword1!' } })
      fireEvent.click(screen.getByRole('button', { name: 'Restablecer contraseña' }))

      await waitFor(() => {
        expect(mockPost).toHaveBeenCalledWith('/auth/reset-password', {
          token: 'my-reset-token',
          password: 'NewPassword1!',
        })
      })
    })

    it('shows the translated success state after a successful reset', async () => {
      mockPost.mockResolvedValue({})
      renderAdminResetPasswordPage()

      fireEvent.change(screen.getByLabelText('Nueva contraseña'), { target: { value: 'NewPassword1!' } })
      fireEvent.change(screen.getByLabelText('Confirmar contraseña'), { target: { value: 'NewPassword1!' } })
      fireEvent.click(screen.getByRole('button', { name: 'Restablecer contraseña' }))

      await waitFor(() => {
        expect(screen.getByText('¡Contraseña actualizada!')).toBeInTheDocument()
        expect(
          screen.getByText('Tu contraseña ha sido restablecida exitosamente. Serás redirigido al inicio de sesión...')
        ).toBeInTheDocument()
        expect(screen.getByText('Redirigiendo...')).toBeInTheDocument()
      })
    })

    it('does not submit when the token is missing', () => {
      renderAdminResetPasswordPage(null)

      expect(screen.queryByLabelText('Nueva contraseña')).not.toBeInTheDocument()
      expect(mockPost).not.toHaveBeenCalled()
    })
  })

  describe('error handling', () => {
    it('displays the translated tokenExpired message and a request-new-link action', async () => {
      mockPost.mockRejectedValue(
        createAxiosError('Request failed', { code: 'TOKEN_EXPIRED', message: 'Token expired' })
      )
      renderAdminResetPasswordPage()

      fireEvent.change(screen.getByLabelText('Nueva contraseña'), { target: { value: 'NewPassword1!' } })
      fireEvent.change(screen.getByLabelText('Confirmar contraseña'), { target: { value: 'NewPassword1!' } })
      fireEvent.click(screen.getByRole('button', { name: 'Restablecer contraseña' }))

      await waitFor(() => {
        expect(
          screen.getByText('El enlace de restablecimiento ha expirado. Por favor solicita uno nuevo.')
        ).toBeInTheDocument()
        expect(screen.getByRole('link', { name: 'Solicitar nuevo enlace' })).toBeInTheDocument()
      })
    })

    it('displays the translated tokenUsed message', async () => {
      mockPost.mockRejectedValue(
        createAxiosError('Request failed', { code: 'TOKEN_USED', message: 'Token used' })
      )
      renderAdminResetPasswordPage()

      fireEvent.change(screen.getByLabelText('Nueva contraseña'), { target: { value: 'NewPassword1!' } })
      fireEvent.change(screen.getByLabelText('Confirmar contraseña'), { target: { value: 'NewPassword1!' } })
      fireEvent.click(screen.getByRole('button', { name: 'Restablecer contraseña' }))

      await waitFor(() => {
        expect(
          screen.getByText('Este enlace ya fue utilizado. Por favor solicita uno nuevo.')
        ).toBeInTheDocument()
      })
    })

    it('displays the translated invalidToken message', async () => {
      mockPost.mockRejectedValue(
        createAxiosError('Request failed', { code: 'INVALID_TOKEN', message: 'Invalid token' })
      )
      renderAdminResetPasswordPage()

      fireEvent.change(screen.getByLabelText('Nueva contraseña'), { target: { value: 'NewPassword1!' } })
      fireEvent.change(screen.getByLabelText('Confirmar contraseña'), { target: { value: 'NewPassword1!' } })
      fireEvent.click(screen.getByRole('button', { name: 'Restablecer contraseña' }))

      await waitFor(() => {
        expect(screen.getByText('El enlace de restablecimiento es inválido')).toBeInTheDocument()
      })
    })

    it('displays the translated accountInactive message', async () => {
      mockPost.mockRejectedValue(
        createAxiosError('Request failed', { code: 'ACCOUNT_INACTIVE', message: 'Account inactive' })
      )
      renderAdminResetPasswordPage()

      fireEvent.change(screen.getByLabelText('Nueva contraseña'), { target: { value: 'NewPassword1!' } })
      fireEvent.change(screen.getByLabelText('Confirmar contraseña'), { target: { value: 'NewPassword1!' } })
      fireEvent.click(screen.getByRole('button', { name: 'Restablecer contraseña' }))

      await waitFor(() => {
        expect(screen.getByText('La cuenta está desactivada')).toBeInTheDocument()
      })
    })

    it('displays the API error message for unknown error codes', async () => {
      mockPost.mockRejectedValue(
        createAxiosError('Request failed', { code: 'UNKNOWN_ERROR', message: 'Something went wrong' })
      )
      renderAdminResetPasswordPage()

      fireEvent.change(screen.getByLabelText('Nueva contraseña'), { target: { value: 'NewPassword1!' } })
      fireEvent.change(screen.getByLabelText('Confirmar contraseña'), { target: { value: 'NewPassword1!' } })
      fireEvent.click(screen.getByRole('button', { name: 'Restablecer contraseña' }))

      await waitFor(() => {
        expect(screen.getByText('Something went wrong')).toBeInTheDocument()
      })
    })

    it('displays the translated unexpectedError message for non-Axios errors', async () => {
      mockPost.mockRejectedValue(new Error('Network error'))
      renderAdminResetPasswordPage()

      fireEvent.change(screen.getByLabelText('Nueva contraseña'), { target: { value: 'NewPassword1!' } })
      fireEvent.change(screen.getByLabelText('Confirmar contraseña'), { target: { value: 'NewPassword1!' } })
      fireEvent.click(screen.getByRole('button', { name: 'Restablecer contraseña' }))

      await waitFor(() => {
        expect(screen.getByText('Error inesperado')).toBeInTheDocument()
      })
    })
  })

  describe('loading state', () => {
    it('shows the translated updating label and disables the button while submitting', async () => {
      mockPost.mockImplementation(() => new Promise(() => {})) // never resolves
      renderAdminResetPasswordPage()

      fireEvent.change(screen.getByLabelText('Nueva contraseña'), { target: { value: 'NewPassword1!' } })
      fireEvent.change(screen.getByLabelText('Confirmar contraseña'), { target: { value: 'NewPassword1!' } })
      fireEvent.click(screen.getByRole('button', { name: 'Restablecer contraseña' }))

      await waitFor(() => {
        expect(screen.getByText('Restableciendo...')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /Restableciendo/ })).toBeDisabled()
      })
    })
  })

  describe('password visibility toggle', () => {
    it('toggles the new-password input type independently of confirm-password', () => {
      const { container } = renderAdminResetPasswordPage()

      const passwordInput = screen.getByLabelText('Nueva contraseña') as HTMLInputElement
      const confirmInput = screen.getByLabelText('Confirmar contraseña') as HTMLInputElement
      expect(passwordInput).toHaveAttribute('type', 'password')
      expect(confirmInput).toHaveAttribute('type', 'password')

      const toggleButtons = container.querySelectorAll('button[type="button"]')
      expect(toggleButtons).toHaveLength(2)

      fireEvent.click(toggleButtons[0])
      expect(passwordInput).toHaveAttribute('type', 'text')
      expect(confirmInput).toHaveAttribute('type', 'password')

      fireEvent.click(toggleButtons[1])
      expect(confirmInput).toHaveAttribute('type', 'text')
    })
  })
})
