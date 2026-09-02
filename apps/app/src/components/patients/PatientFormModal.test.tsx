import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { PatientFormModal } from './PatientFormModal'
import type { Patient } from '@/lib/patient-api'

describe('PatientFormModal', () => {
  const mockOnClose = vi.fn()
  const mockOnSubmit = vi.fn()

  const mockPatient: Patient = {
    id: '1',
    tenantId: 'tenant1',
    firstName: 'Juan',
    lastName: 'Pérez',
    email: 'juan@example.com',
    phone: '+1234567890',
    dob: '1990-01-15T00:00:00Z',
    gender: 'male',
    address: '123 Main St, City',
    toothNotes: {},
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
        <PatientFormModal
          isOpen={false}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      )

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('should render create modal title', () => {
      render(
        <PatientFormModal
          isOpen={true}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      )

      expect(screen.getByRole('dialog')).toBeInTheDocument()
      expect(screen.getByText('Nuevo Paciente')).toBeInTheDocument()
    })

    it('should render edit modal title', () => {
      render(
        <PatientFormModal
          isOpen={true}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
          patient={mockPatient}
        />
      )

      expect(screen.getByText('Editar Paciente')).toBeInTheDocument()
    })

    it('should render all form fields', () => {
      render(
        <PatientFormModal
          isOpen={true}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      )

      expect(screen.getByPlaceholderText('Juan')).toBeInTheDocument()
      expect(screen.getByPlaceholderText('Pérez')).toBeInTheDocument()
      expect(screen.getByPlaceholderText('paciente@email.com')).toBeInTheDocument()
      expect(screen.getByPlaceholderText('+1 234 567 890')).toBeInTheDocument()
      expect(document.querySelector('select[name="gender"]')).toBeInTheDocument()
      expect(screen.getByPlaceholderText(/calle, número/i)).toBeInTheDocument()
    })

    it('should render gender options', () => {
      render(
        <PatientFormModal
          isOpen={true}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      )

      const genderSelect = document.querySelector('select[name="gender"]') as HTMLSelectElement
      expect(genderSelect).toBeInTheDocument()

      const options = Array.from(genderSelect.querySelectorAll('option'))
      expect(options).toHaveLength(5)
      expect(options[0]).toHaveTextContent('Seleccionar...')
      expect(options[1]).toHaveTextContent('Masculino')
      expect(options[2]).toHaveTextContent('Femenino')
      expect(options[3]).toHaveTextContent('Otro')
      expect(options[4]).toHaveTextContent('Prefiere no decir')
    })

    it('should render action buttons', () => {
      render(
        <PatientFormModal
          isOpen={true}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      )

      expect(screen.getByRole('button', { name: /cancelar/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /crear paciente/i })).toBeInTheDocument()
    })

    it('should render close button', () => {
      render(
        <PatientFormModal
          isOpen={true}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      )

      expect(screen.getByRole('button', { name: /cerrar formulario/i })).toBeInTheDocument()
    })
  })

  describe('form reset', () => {
    it('should reset form when opening create modal', () => {
      render(
        <PatientFormModal
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
        <PatientFormModal
          isOpen={true}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
          patient={mockPatient}
        />
      )

      const firstNameInput = screen.getByPlaceholderText('Juan') as HTMLInputElement
      const lastNameInput = screen.getByPlaceholderText('Pérez') as HTMLInputElement
      const emailInput = screen.getByPlaceholderText('paciente@email.com') as HTMLInputElement
      const phoneInput = screen.getByPlaceholderText('+1 234 567 890') as HTMLInputElement
      const genderSelect = document.querySelector('select[name="gender"]') as HTMLSelectElement
      const addressTextarea = screen.getByPlaceholderText(/calle, número/i) as HTMLTextAreaElement

      expect(firstNameInput.value).toBe('Juan')
      expect(lastNameInput.value).toBe('Pérez')
      expect(emailInput.value).toBe('juan@example.com')
      expect(phoneInput.value).toBe('+1234567890')
      expect(genderSelect.value).toBe('male')
      expect(addressTextarea.value).toBe('123 Main St, City')
    })
  })

  describe('coverage type', () => {
    it('hides the convenio name input when coverageType is PARTICULAR (the default)', () => {
      render(
        <PatientFormModal
          isOpen={true}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      )

      const coverageSelect = document.querySelector('select[name="coverageType"]') as HTMLSelectElement
      expect(coverageSelect.value).toBe('PARTICULAR')
      expect(document.querySelector('input[name="convenioName"]')).not.toBeInTheDocument()
    })

    it('reveals the convenio name input after selecting CONVENIO', () => {
      render(
        <PatientFormModal
          isOpen={true}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      )

      const coverageSelect = document.querySelector('select[name="coverageType"]') as HTMLSelectElement
      fireEvent.change(coverageSelect, { target: { value: 'CONVENIO' } })

      expect(document.querySelector('input[name="convenioName"]')).toBeInTheDocument()
    })

    it('hides the convenio name input again after switching back to PARTICULAR', () => {
      render(
        <PatientFormModal
          isOpen={true}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      )

      const coverageSelect = document.querySelector('select[name="coverageType"]') as HTMLSelectElement
      fireEvent.change(coverageSelect, { target: { value: 'CONVENIO' } })
      expect(document.querySelector('input[name="convenioName"]')).toBeInTheDocument()

      fireEvent.change(coverageSelect, { target: { value: 'PARTICULAR' } })
      expect(document.querySelector('input[name="convenioName"]')).not.toBeInTheDocument()
    })
  })

  describe('form validation', () => {
    it('should show error for required firstName', async () => {
      render(
        <PatientFormModal
          isOpen={true}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      )

      const lastNameInput = screen.getByPlaceholderText('Pérez')
      fireEvent.change(lastNameInput, { target: { value: 'Doe' } })

      const submitButton = screen.getByRole('button', { name: /crear paciente/i })
      fireEvent.click(submitButton)

      await waitFor(() => {
        expect(screen.getByText('El nombre es requerido')).toBeInTheDocument()
      })

      expect(mockOnSubmit).not.toHaveBeenCalled()
    })

    it('should show error for required lastName', async () => {
      render(
        <PatientFormModal
          isOpen={true}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      )

      const firstNameInput = screen.getByPlaceholderText('Juan')
      fireEvent.change(firstNameInput, { target: { value: 'John' } })

      const submitButton = screen.getByRole('button', { name: /crear paciente/i })
      fireEvent.click(submitButton)

      await waitFor(() => {
        expect(screen.getByText('El apellido es requerido')).toBeInTheDocument()
      })

      expect(mockOnSubmit).not.toHaveBeenCalled()
    })

    it('should accept empty email', async () => {
      mockOnSubmit.mockResolvedValue(undefined)

      render(
        <PatientFormModal
          isOpen={true}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      )

      const firstNameInput = screen.getByPlaceholderText('Juan')
      const lastNameInput = screen.getByPlaceholderText('Pérez')

      fireEvent.change(firstNameInput, { target: { value: 'John' } })
      fireEvent.change(lastNameInput, { target: { value: 'Doe' } })

      const submitButton = screen.getByRole('button', { name: /crear paciente/i })
      fireEvent.click(submitButton)

      await waitFor(() => {
        expect(mockOnSubmit).toHaveBeenCalledWith({
          firstName: 'John',
          lastName: 'Doe',
          coverageType: 'PARTICULAR',
          convenioName: null,
        })
      })
    })

    it('should show error for address too long', async () => {
      render(
        <PatientFormModal
          isOpen={true}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      )

      const firstNameInput = screen.getByPlaceholderText('Juan')
      const lastNameInput = screen.getByPlaceholderText('Pérez')
      const addressTextarea = screen.getByPlaceholderText(/calle, número/i)

      fireEvent.change(firstNameInput, { target: { value: 'John' } })
      fireEvent.change(lastNameInput, { target: { value: 'Doe' } })
      fireEvent.change(addressTextarea, { target: { value: 'a'.repeat(501) } })

      const submitButton = screen.getByRole('button', { name: /crear paciente/i })
      fireEvent.click(submitButton)

      await waitFor(() => {
        expect(screen.getByText('La dirección no puede exceder 500 caracteres')).toBeInTheDocument()
      })

      expect(mockOnSubmit).not.toHaveBeenCalled()
    })
  })

  describe('form submission', () => {
    it('should call onSubmit with valid data for create', async () => {
      mockOnSubmit.mockResolvedValue(undefined)

      render(
        <PatientFormModal
          isOpen={true}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      )

      const firstNameInput = screen.getByPlaceholderText('Juan')
      const lastNameInput = screen.getByPlaceholderText('Pérez')
      const emailInput = screen.getByPlaceholderText('paciente@email.com')
      const phoneInput = screen.getByPlaceholderText('+1 234 567 890')

      fireEvent.change(firstNameInput, { target: { value: 'John' } })
      fireEvent.change(lastNameInput, { target: { value: 'Doe' } })
      fireEvent.change(emailInput, { target: { value: 'john@example.com' } })
      fireEvent.change(phoneInput, { target: { value: '+1234567890' } })

      const submitButton = screen.getByRole('button', { name: /crear paciente/i })
      fireEvent.click(submitButton)

      await waitFor(() => {
        expect(mockOnSubmit).toHaveBeenCalledWith({
          firstName: 'John',
          lastName: 'Doe',
          email: 'john@example.com',
          phone: '+1234567890',
          coverageType: 'PARTICULAR',
          convenioName: null,
        })
      })
    })

    it('should call onSubmit with valid data for edit', async () => {
      mockOnSubmit.mockResolvedValue(undefined)

      render(
        <PatientFormModal
          isOpen={true}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
          patient={mockPatient}
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
            lastName: 'Pérez',
          })
        )
      })
    })

    it('should handle optional fields correctly', async () => {
      mockOnSubmit.mockResolvedValue(undefined)

      render(
        <PatientFormModal
          isOpen={true}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      )

      const firstNameInput = screen.getByPlaceholderText('Juan')
      const lastNameInput = screen.getByPlaceholderText('Pérez')

      fireEvent.change(firstNameInput, { target: { value: 'John' } })
      fireEvent.change(lastNameInput, { target: { value: 'Doe' } })

      const submitButton = screen.getByRole('button', { name: /crear paciente/i })
      fireEvent.click(submitButton)

      await waitFor(() => {
        expect(mockOnSubmit).toHaveBeenCalledWith({
          firstName: 'John',
          lastName: 'Doe',
          coverageType: 'PARTICULAR',
          convenioName: null,
        })
      })
    })

    it('should include all filled fields in submission', async () => {
      mockOnSubmit.mockResolvedValue(undefined)

      render(
        <PatientFormModal
          isOpen={true}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      )

      const firstNameInput = screen.getByPlaceholderText('Juan')
      const lastNameInput = screen.getByPlaceholderText('Pérez')
      const emailInput = screen.getByPlaceholderText('paciente@email.com')
      const phoneInput = screen.getByPlaceholderText('+1 234 567 890')
      const genderSelect = document.querySelector('select[name="gender"]') as HTMLSelectElement
      const addressTextarea = screen.getByPlaceholderText(/calle, número/i)

      // Find date input by type
      const dateInputs = document.querySelectorAll('input[type="date"]')
      const dobInput = dateInputs[0] as HTMLInputElement

      fireEvent.change(firstNameInput, { target: { value: 'John' } })
      fireEvent.change(lastNameInput, { target: { value: 'Doe' } })
      fireEvent.change(emailInput, { target: { value: 'john@example.com' } })
      fireEvent.change(phoneInput, { target: { value: '+1234567890' } })
      fireEvent.change(dobInput, { target: { value: '1990-01-15' } })
      fireEvent.change(genderSelect, { target: { value: 'male' } })
      fireEvent.change(addressTextarea, { target: { value: '123 Main St' } })

      const submitButton = screen.getByRole('button', { name: /crear paciente/i })
      fireEvent.click(submitButton)

      await waitFor(() => {
        expect(mockOnSubmit).toHaveBeenCalledWith({
          firstName: 'John',
          lastName: 'Doe',
          email: 'john@example.com',
          phone: '+1234567890',
          dob: '1990-01-15',
          gender: 'male',
          coverageType: 'PARTICULAR',
          convenioName: null,
          address: '123 Main St',
        })
      })
    })

    it('should disable buttons while submitting', async () => {
      mockOnSubmit.mockImplementation(() => new Promise(resolve => setTimeout(resolve, 100)))

      render(
        <PatientFormModal
          isOpen={true}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      )

      const firstNameInput = screen.getByPlaceholderText('Juan')
      const lastNameInput = screen.getByPlaceholderText('Pérez')

      fireEvent.change(firstNameInput, { target: { value: 'John' } })
      fireEvent.change(lastNameInput, { target: { value: 'Doe' } })

      const submitButton = screen.getByRole('button', { name: /crear paciente/i })
      const cancelButton = screen.getByRole('button', { name: /cancelar/i })

      fireEvent.click(submitButton)

      await waitFor(() => {
        expect(submitButton).toBeDisabled()
        expect(cancelButton).toBeDisabled()
      })
    })

    it('should show loading spinner while submitting', async () => {
      mockOnSubmit.mockImplementation(() => new Promise(resolve => setTimeout(resolve, 100)))

      render(
        <PatientFormModal
          isOpen={true}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      )

      const firstNameInput = screen.getByPlaceholderText('Juan')
      const lastNameInput = screen.getByPlaceholderText('Pérez')

      fireEvent.change(firstNameInput, { target: { value: 'John' } })
      fireEvent.change(lastNameInput, { target: { value: 'Doe' } })

      const submitButton = screen.getByRole('button', { name: /crear paciente/i })
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
        <PatientFormModal
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
        <PatientFormModal
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
        <PatientFormModal
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
        <PatientFormModal
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
        <PatientFormModal
          isOpen={true}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      )

      const dialog = screen.getByRole('dialog')
      fireEvent.click(dialog)

      expect(mockOnClose).not.toHaveBeenCalled()
    })

    it('should disable close when loading', () => {
      render(
        <PatientFormModal
          isOpen={true}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
          isLoading={true}
        />
      )

      const cancelButton = screen.getByRole('button', { name: /cancelar/i })
      expect(cancelButton).toBeDisabled()

      fireEvent.keyDown(document, { key: 'Escape' })
      expect(mockOnClose).not.toHaveBeenCalled()
    })
  })
})
