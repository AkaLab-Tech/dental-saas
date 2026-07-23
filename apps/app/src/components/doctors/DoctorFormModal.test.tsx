import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import i18n from 'i18next'
import '@/i18n'
import { DoctorFormModal } from './DoctorFormModal'
import type { Doctor } from '@/lib/doctor-api'

// DoctorFormModal now renders every user-facing string through t(). Initialize
// the real i18n instance (Spanish, the app default) so assertions exercise
// the actual translated output rather than raw keys.
beforeAll(async () => {
  await i18n.changeLanguage('es')
})

describe('DoctorFormModal', () => {
  const mockOnClose = vi.fn()
  const mockOnSubmit = vi.fn()

  const mockDoctor: Doctor = {
    id: '1',
    tenantId: 'tenant1',
    firstName: 'Dr. Juan',
    lastName: 'González',
    email: 'doctor@example.com',
    phone: '+1234567890',
    specialty: 'Orthodontist',
    licenseNumber: 'LIC123',
    workingDays: ['MON', 'TUE', 'WED'],
    workingHours: { start: '09:00', end: '17:00' },
    consultingRoom: 'Room 101',
    bio: 'Experienced orthodontist',
    hourlyRate: 100,
    isActive: true,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('rendering', () => {
    it('should not render when closed', () => {
      render(
        <DoctorFormModal
          isOpen={false}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      )

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('should render create modal title', () => {
      render(
        <DoctorFormModal
          isOpen={true}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      )

      expect(screen.getByRole('dialog')).toBeInTheDocument()
      expect(screen.getByText('Nuevo Doctor')).toBeInTheDocument()
    })

    it('should render edit modal title', () => {
      render(
        <DoctorFormModal
          isOpen={true}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
          doctor={mockDoctor}
        />
      )

      expect(screen.getByText('Editar Doctor')).toBeInTheDocument()
    })

    it('should render all form fields', () => {
      render(
        <DoctorFormModal
          isOpen={true}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      )

      expect(screen.getByPlaceholderText('Juan')).toBeInTheDocument()
      expect(screen.getByPlaceholderText('Pérez')).toBeInTheDocument()
      expect(screen.getByPlaceholderText('doctor@clinica.com')).toBeInTheDocument()
      expect(screen.getByPlaceholderText('+1 234 567 890')).toBeInTheDocument()
      expect(screen.getByPlaceholderText('Odontología General')).toBeInTheDocument()
    })

    it('should render working days checkboxes', () => {
      render(
        <DoctorFormModal
          isOpen={true}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      )

      expect(screen.getByText('Lunes')).toBeInTheDocument()
      expect(screen.getByText('Martes')).toBeInTheDocument()
      expect(screen.getByText('Miércoles')).toBeInTheDocument()
      expect(screen.getByText('Jueves')).toBeInTheDocument()
      expect(screen.getByText('Viernes')).toBeInTheDocument()
      expect(screen.getByText('Sábado')).toBeInTheDocument()
      expect(screen.getByText('Domingo')).toBeInTheDocument()
    })

    it('should render action buttons', () => {
      render(
        <DoctorFormModal
          isOpen={true}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      )

      expect(screen.getByRole('button', { name: /cancelar/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /crear doctor/i })).toBeInTheDocument()
    })
  })

  describe('form reset', () => {
    it('should reset form when opening create modal', () => {
      render(
        <DoctorFormModal
          isOpen={true}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      )

      const firstNameInput = screen.getByPlaceholderText('Juan') as HTMLInputElement
      const lastNameInput = screen.getByPlaceholderText('Pérez') as HTMLInputElement

      expect(firstNameInput.value).toBe('')
      expect(lastNameInput.value).toBe('')
    })

    it('should populate form when opening edit modal', () => {
      render(
        <DoctorFormModal
          isOpen={true}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
          doctor={mockDoctor}
        />
      )

      const firstNameInput = screen.getByPlaceholderText('Juan') as HTMLInputElement
      const lastNameInput = screen.getByPlaceholderText('Pérez') as HTMLInputElement
      const emailInput = screen.getByPlaceholderText('doctor@clinica.com') as HTMLInputElement
      const specialtyInput = screen.getByPlaceholderText('Odontología General') as HTMLInputElement

      expect(firstNameInput.value).toBe('Dr. Juan')
      expect(lastNameInput.value).toBe('González')
      expect(emailInput.value).toBe('doctor@example.com')
      expect(specialtyInput.value).toBe('Orthodontist')
    })
  })

  describe('form validation', () => {
    it('should show error for required firstName', async () => {
      render(
        <DoctorFormModal
          isOpen={true}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      )

      const lastNameInput = screen.getByPlaceholderText('Pérez')
      fireEvent.change(lastNameInput, { target: { value: 'Doe' } })

      const submitButton = screen.getByRole('button', { name: /crear doctor/i })
      fireEvent.click(submitButton)

      await waitFor(() => {
        expect(screen.getByText('El nombre es requerido')).toBeInTheDocument()
      })

      expect(mockOnSubmit).not.toHaveBeenCalled()
    })

    it('should show error for required lastName', async () => {
      render(
        <DoctorFormModal
          isOpen={true}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      )

      const firstNameInput = screen.getByPlaceholderText('Juan')
      fireEvent.change(firstNameInput, { target: { value: 'John' } })

      const submitButton = screen.getByRole('button', { name: /crear doctor/i })
      fireEvent.click(submitButton)

      await waitFor(() => {
        expect(screen.getByText('El apellido es requerido')).toBeInTheDocument()
      })

      expect(mockOnSubmit).not.toHaveBeenCalled()
    })

    // These two cases fire the form's `submit` event directly rather than
    // clicking the submit button: the `email`/`hourlyRate` inputs carry
    // native HTML constraints (type="email"; type="number" min="0") that
    // jsdom (like real browsers) enforces *before* dispatching `submit` when
    // a button-click drives the request — which would short-circuit the
    // RHF+Zod validation path entirely and never reach our translated
    // message. Dispatching `submit` directly exercises the
    // handleSubmit(handleFormSubmit) wiring in isolation, matching how the
    // sibling required/bio-length cases already validate the Zod message
    // independent of the browser's own (non-localized) constraint UI.
    it('should show error for invalid email', async () => {
      render(
        <DoctorFormModal
          isOpen={true}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      )

      const firstNameInput = screen.getByPlaceholderText('Juan')
      const lastNameInput = screen.getByPlaceholderText('Pérez')
      const emailInput = screen.getByPlaceholderText('doctor@clinica.com')

      fireEvent.change(firstNameInput, { target: { value: 'John' } })
      fireEvent.change(lastNameInput, { target: { value: 'Doe' } })
      fireEvent.change(emailInput, { target: { value: 'not-an-email' } })

      fireEvent.submit(firstNameInput.closest('form')!)

      await waitFor(() => {
        expect(screen.getByText('Email inválido')).toBeInTheDocument()
      })

      expect(mockOnSubmit).not.toHaveBeenCalled()
    })

    it('should show error for non-positive hourly rate', async () => {
      render(
        <DoctorFormModal
          isOpen={true}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      )

      const firstNameInput = screen.getByPlaceholderText('Juan')
      const lastNameInput = screen.getByPlaceholderText('Pérez')
      const hourlyRateInput = screen.getByPlaceholderText('100.00')

      fireEvent.change(firstNameInput, { target: { value: 'John' } })
      fireEvent.change(lastNameInput, { target: { value: 'Doe' } })
      fireEvent.change(hourlyRateInput, { target: { value: '-5' } })

      fireEvent.submit(firstNameInput.closest('form')!)

      await waitFor(() => {
        expect(screen.getByText('Debe ser un número positivo')).toBeInTheDocument()
      })

      expect(mockOnSubmit).not.toHaveBeenCalled()
    })

    it('should show error for out-of-range commissionPercentage', async () => {
      render(
        <DoctorFormModal
          isOpen={true}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      )

      const firstNameInput = screen.getByPlaceholderText('Juan')
      const lastNameInput = screen.getByPlaceholderText('Pérez')
      const commissionInput = screen.getByPlaceholderText('20.00')

      fireEvent.change(firstNameInput, { target: { value: 'John' } })
      fireEvent.change(lastNameInput, { target: { value: 'Doe' } })
      fireEvent.change(commissionInput, { target: { value: '150' } })

      // Same rationale as the hourlyRate case above: type="number" max="100"
      // is a native browser constraint that would short-circuit a
      // button-click submit before reaching RHF+Zod, so dispatch `submit`
      // directly to exercise the Zod validation path.
      fireEvent.submit(firstNameInput.closest('form')!)

      await waitFor(() => {
        expect(screen.getByText('Debe estar entre 0 y 100')).toBeInTheDocument()
      })

      expect(mockOnSubmit).not.toHaveBeenCalled()
    })

    it('should show error for bio too long', async () => {
      render(
        <DoctorFormModal
          isOpen={true}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      )

      const firstNameInput = screen.getByPlaceholderText('Juan')
      const lastNameInput = screen.getByPlaceholderText('Pérez')

      // Find bio textarea by placeholder
      const bioTextarea = screen.getByPlaceholderText(/breve descripción profesional/i)

      fireEvent.change(firstNameInput, { target: { value: 'John' } })
      fireEvent.change(lastNameInput, { target: { value: 'Doe' } })
      fireEvent.change(bioTextarea, { target: { value: 'a'.repeat(5001) } })

      const submitButton = screen.getByRole('button', { name: /crear doctor/i })
      fireEvent.click(submitButton)

      await waitFor(() => {
        expect(screen.getByText('La biografía no puede exceder 5000 caracteres')).toBeInTheDocument()
      })

      expect(mockOnSubmit).not.toHaveBeenCalled()
    })
  })

  describe('form submission', () => {
    it('should call onSubmit with valid data for create', async () => {
      mockOnSubmit.mockResolvedValue(undefined)

      render(
        <DoctorFormModal
          isOpen={true}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      )

      const firstNameInput = screen.getByPlaceholderText('Juan')
      const lastNameInput = screen.getByPlaceholderText('Pérez')
      const emailInput = screen.getByPlaceholderText('doctor@clinica.com')

      fireEvent.change(firstNameInput, { target: { value: 'John' } })
      fireEvent.change(lastNameInput, { target: { value: 'Doe' } })
      fireEvent.change(emailInput, { target: { value: 'john@example.com' } })

      const submitButton = screen.getByRole('button', { name: /crear doctor/i })
      fireEvent.click(submitButton)

      await waitFor(() => {
        expect(mockOnSubmit).toHaveBeenCalledWith({
          firstName: 'John',
          lastName: 'Doe',
          email: 'john@example.com',
        })
      })
    })

    it('should call onSubmit with valid data for edit', async () => {
      mockOnSubmit.mockResolvedValue(undefined)

      render(
        <DoctorFormModal
          isOpen={true}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
          doctor={mockDoctor}
        />
      )

      const firstNameInput = screen.getByPlaceholderText('Juan')
      fireEvent.change(firstNameInput, { target: { value: 'Updated Name' } })

      const submitButton = screen.getByRole('button', { name: /guardar cambios/i })
      fireEvent.click(submitButton)

      await waitFor(() => {
        expect(mockOnSubmit).toHaveBeenCalledWith(
          expect.objectContaining({
            firstName: 'Updated Name',
            lastName: 'González',
          })
        )
      })
    })

    it('should handle optional fields correctly', async () => {
      mockOnSubmit.mockResolvedValue(undefined)

      render(
        <DoctorFormModal
          isOpen={true}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      )

      const firstNameInput = screen.getByPlaceholderText('Juan')
      const lastNameInput = screen.getByPlaceholderText('Pérez')

      fireEvent.change(firstNameInput, { target: { value: 'John' } })
      fireEvent.change(lastNameInput, { target: { value: 'Doe' } })

      const submitButton = screen.getByRole('button', { name: /crear doctor/i })
      fireEvent.click(submitButton)

      await waitFor(() => {
        expect(mockOnSubmit).toHaveBeenCalledWith({
          firstName: 'John',
          lastName: 'Doe',
        })
      })
    })

    it('should include a valid commissionPercentage in the onSubmit payload', async () => {
      mockOnSubmit.mockResolvedValue(undefined)

      render(
        <DoctorFormModal
          isOpen={true}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      )

      const firstNameInput = screen.getByPlaceholderText('Juan')
      const lastNameInput = screen.getByPlaceholderText('Pérez')
      const commissionInput = screen.getByPlaceholderText('20.00')

      fireEvent.change(firstNameInput, { target: { value: 'John' } })
      fireEvent.change(lastNameInput, { target: { value: 'Doe' } })
      fireEvent.change(commissionInput, { target: { value: '45' } })

      const submitButton = screen.getByRole('button', { name: /crear doctor/i })
      fireEvent.click(submitButton)

      await waitFor(() => {
        expect(mockOnSubmit).toHaveBeenCalledWith({
          firstName: 'John',
          lastName: 'Doe',
          commissionPercentage: 45,
        })
      })
    })

    it('should toggle working days', async () => {
      render(
        <DoctorFormModal
          isOpen={true}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      )

      // Find the button with "Lunes" text
      const lunesButton = screen.getByRole('button', { name: /lunes/i })
      fireEvent.click(lunesButton)

      // The button should now be active (have bg-blue class or similar)
      expect(lunesButton.className).toContain('bg-blue')
    })

    it('should show loading spinner while submitting', async () => {
      mockOnSubmit.mockImplementation(() => new Promise(resolve => setTimeout(resolve, 100)))

      render(
        <DoctorFormModal
          isOpen={true}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      )

      const firstNameInput = screen.getByPlaceholderText('Juan')
      const lastNameInput = screen.getByPlaceholderText('Pérez')

      fireEvent.change(firstNameInput, { target: { value: 'John' } })
      fireEvent.change(lastNameInput, { target: { value: 'Doe' } })

      const submitButton = screen.getByRole('button', { name: /crear doctor/i })
      fireEvent.click(submitButton)

      await waitFor(() => {
        const spinner = document.querySelector('.animate-spin')
        expect(spinner).toBeInTheDocument()
      })
    })
  })

  describe('modal behavior', () => {
    it('should call onClose when clicking backdrop', () => {
      render(
        <DoctorFormModal
          isOpen={true}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      )

      const backdrop = document.querySelector('.fixed.inset-0.bg-black\\/50')
      expect(backdrop).toBeInTheDocument()

      fireEvent.click(backdrop!)
      expect(mockOnClose).toHaveBeenCalled()
    })

    it('should call onClose when clicking X button', () => {
      render(
        <DoctorFormModal
          isOpen={true}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      )

      const closeButton = screen.getByRole('button', { name: /cerrar formulario/i })
      fireEvent.click(closeButton)

      expect(mockOnClose).toHaveBeenCalled()
    })

    it('should call onClose when clicking cancel button', () => {
      render(
        <DoctorFormModal
          isOpen={true}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      )

      const cancelButton = screen.getByRole('button', { name: /cancelar/i })
      fireEvent.click(cancelButton)

      expect(mockOnClose).toHaveBeenCalled()
    })

    it('should call onClose when pressing Escape key', async () => {
      render(
        <DoctorFormModal
          isOpen={true}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      )

      fireEvent.keyDown(document, { key: 'Escape' })

      await waitFor(() => {
        expect(mockOnClose).toHaveBeenCalled()
      })
    })

    it('should not close modal when clicking inside', () => {
      render(
        <DoctorFormModal
          isOpen={true}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      )

      const dialog = screen.getByRole('dialog')
      fireEvent.click(dialog)

      expect(mockOnClose).not.toHaveBeenCalled()
    })
  })
})
