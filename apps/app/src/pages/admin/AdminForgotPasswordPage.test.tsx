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
import { AdminForgotPasswordPage } from './AdminForgotPasswordPage'

async function switchLocale(code: string) {
  await act(async () => {
    await i18n.changeLanguage(code)
  })
}

function renderAdminForgotPasswordPage() {
  return render(
    <MemoryRouter initialEntries={['/admin/forgot-password']}>
      <Routes>
        <Route path="/admin/forgot-password" element={<AdminForgotPasswordPage />} />
        <Route path="/admin/login" element={<div>Admin Login Page</div>} />
      </Routes>
    </MemoryRouter>
  )
}

describe('AdminForgotPasswordPage', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    await i18nReady
    await switchLocale('es')
  })

  afterEach(async () => {
    await switchLocale('es')
  })

  describe('rendering (es)', () => {
    it('renders the translated title and super-admin panel subtitle', () => {
      renderAdminForgotPasswordPage()

      expect(screen.getByRole('heading', { name: 'Recuperar Contraseña' })).toBeInTheDocument()
      expect(screen.getByText('Panel de Super Administrador')).toBeInTheDocument()
    })

    it('renders the translated form intro and email field', () => {
      renderAdminForgotPasswordPage()

      expect(
        screen.getByText('Ingresa tu correo electrónico y te enviaremos un enlace para restablecer tu contraseña.')
      ).toBeInTheDocument()
      expect(screen.getByLabelText('Email')).toBeInTheDocument()
    })

    it('renders the translated submit button', () => {
      renderAdminForgotPasswordPage()

      expect(screen.getByRole('button', { name: 'Enviar enlace de recuperación' })).toBeInTheDocument()
    })

    it('renders the translated back-to-login link', () => {
      renderAdminForgotPasswordPage()

      expect(screen.getByRole('link', { name: 'Volver al inicio de sesión' })).toHaveAttribute(
        'href',
        '/admin/login'
      )
    })

    it('renders the translated footer copyright with the current year interpolated', () => {
      renderAdminForgotPasswordPage()

      const year = new Date().getFullYear()
      expect(
        screen.getByText(`© ${year} Alveo System. Todos los derechos reservados.`)
      ).toBeInTheDocument()
    })
  })

  describe('locale switching — proves strings flow through t()', () => {
    it('renders the English title and submit label after switching language to en', async () => {
      renderAdminForgotPasswordPage()

      expect(screen.getByRole('heading', { name: 'Recuperar Contraseña' })).toBeInTheDocument()

      await switchLocale('en')

      expect(screen.getByRole('heading', { name: 'Recover Password' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Send recovery link' })).toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'Recuperar Contraseña' })).not.toBeInTheDocument()
    })
  })

  describe('form validation', () => {
    it('does not call the API when the email field is empty', async () => {
      renderAdminForgotPasswordPage()

      fireEvent.click(screen.getByRole('button', { name: 'Enviar enlace de recuperación' }))

      await waitFor(() => {
        expect(mockPost).not.toHaveBeenCalled()
      })
    })

    it('shows the translated invalid-email validation error when the field is empty', async () => {
      // Native type="email" HTML5 constraint validation would block submission
      // for a badly-formatted non-empty value before React Hook Form ever runs
      // the zod resolver — so we drive the zod message via the empty-string case.
      renderAdminForgotPasswordPage()

      fireEvent.click(screen.getByRole('button', { name: 'Enviar enlace de recuperación' }))

      await waitFor(() => {
        expect(screen.getByText('Email inválido')).toBeInTheDocument()
        expect(mockPost).not.toHaveBeenCalled()
      })
    })

    it('does not call the API with a malformed email (native + zod validation)', async () => {
      renderAdminForgotPasswordPage()

      fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'not-an-email' } })
      fireEvent.click(screen.getByRole('button', { name: 'Enviar enlace de recuperación' }))

      await waitFor(() => {
        expect(mockPost).not.toHaveBeenCalled()
      })
    })
  })

  describe('form submission', () => {
    it('calls the API with the email on valid submit', async () => {
      mockPost.mockResolvedValue({})
      renderAdminForgotPasswordPage()

      fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'admin@example.com' } })
      fireEvent.click(screen.getByRole('button', { name: 'Enviar enlace de recuperación' }))

      await waitFor(() => {
        expect(mockPost).toHaveBeenCalledWith('/auth/forgot-password', { email: 'admin@example.com' })
      })
    })

    it('shows the translated success state after successful submission', async () => {
      mockPost.mockResolvedValue({})
      renderAdminForgotPasswordPage()

      fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'admin@example.com' } })
      fireEvent.click(screen.getByRole('button', { name: 'Enviar enlace de recuperación' }))

      await waitFor(() => {
        expect(screen.getByText('Revisa tu correo')).toBeInTheDocument()
        expect(
          screen.getByText(
            'Si existe una cuenta con ese correo, recibirás un enlace para restablecer tu contraseña. El enlace expira en 15 minutos.'
          )
        ).toBeInTheDocument()
        expect(screen.getByText('Revisa también tu carpeta de spam')).toBeInTheDocument()
      })
    })

    it('hides the form after successful submission', async () => {
      mockPost.mockResolvedValue({})
      renderAdminForgotPasswordPage()

      fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'admin@example.com' } })
      fireEvent.click(screen.getByRole('button', { name: 'Enviar enlace de recuperación' }))

      await waitFor(() => {
        expect(screen.queryByLabelText('Email')).not.toBeInTheDocument()
        expect(screen.queryByRole('button', { name: 'Enviar enlace de recuperación' })).not.toBeInTheDocument()
      })
    })
  })

  describe('error handling', () => {
    it('displays the API error message', async () => {
      mockPost.mockRejectedValue(createAxiosError('Request failed', { message: 'Correo no encontrado' }))
      renderAdminForgotPasswordPage()

      fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'admin@example.com' } })
      fireEvent.click(screen.getByRole('button', { name: 'Enviar enlace de recuperación' }))

      await waitFor(() => {
        expect(screen.getByText('Correo no encontrado')).toBeInTheDocument()
      })
    })

    it('displays the translated default errorProcessingRequest message when the API error has no message', async () => {
      mockPost.mockRejectedValue(createAxiosError('Request failed'))
      renderAdminForgotPasswordPage()

      fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'admin@example.com' } })
      fireEvent.click(screen.getByRole('button', { name: 'Enviar enlace de recuperación' }))

      await waitFor(() => {
        expect(screen.getByText('Error al procesar la solicitud')).toBeInTheDocument()
      })
    })

    it('displays the translated unexpectedError message for non-Axios errors', async () => {
      mockPost.mockRejectedValue(new Error('Network error'))
      renderAdminForgotPasswordPage()

      fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'admin@example.com' } })
      fireEvent.click(screen.getByRole('button', { name: 'Enviar enlace de recuperación' }))

      await waitFor(() => {
        expect(screen.getByText('Error inesperado')).toBeInTheDocument()
      })
    })
  })

  describe('loading state', () => {
    it('shows the translated sending label and disables the button while submitting', async () => {
      mockPost.mockImplementation(() => new Promise(() => {})) // never resolves
      renderAdminForgotPasswordPage()

      fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'admin@example.com' } })
      fireEvent.click(screen.getByRole('button', { name: 'Enviar enlace de recuperación' }))

      await waitFor(() => {
        expect(screen.getByText('Enviando...')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /Enviando/ })).toBeDisabled()
      })
    })
  })
})
