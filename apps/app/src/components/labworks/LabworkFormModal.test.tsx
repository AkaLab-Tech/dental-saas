import type { ComponentProps } from 'react'
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import i18n from 'i18next'
import '@/i18n'
import { LabworkFormModal } from './LabworkFormModal'
import type { Labwork } from '@/lib/labwork-api'

beforeAll(async () => {
  await i18n.changeLanguage('es')
})

// ============================================================================
// Mocks
// ============================================================================

const getLabNamesMock = vi.fn()
const getAppointmentsByPatientMock = vi.fn()

vi.mock('@/lib/labwork-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/labwork-api')>('@/lib/labwork-api')
  return {
    ...actual,
    getLabNames: (...args: unknown[]) => getLabNamesMock(...args),
  }
})

vi.mock('@/lib/appointment-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/appointment-api')>('@/lib/appointment-api')
  return {
    ...actual,
    getAppointmentsByPatient: (...args: unknown[]) => getAppointmentsByPatientMock(...args),
  }
})

vi.mock('@/stores/auth.store', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) => selector({ user: { tenant: { currency: 'USD' } } }),
}))

// Test double for the patient combobox: mirrors the real component's public
// contract (selectedPatient / onSelect / onClear) without the debounced
// search internals, which are exercised by PatientSearchCombobox's own tests.
vi.mock('@/components/ui/PatientSearchCombobox', () => ({
  PatientSearchCombobox: ({
    selectedPatient,
    onSelect,
    onClear,
  }: {
    selectedPatient: { id: string; firstName: string; lastName: string } | null
    onSelect: (p: { id: string; firstName: string; lastName: string }) => void
    onClear: () => void
  }) =>
    selectedPatient ? (
      <div>
        <span data-testid="selected-patient">
          {selectedPatient.firstName} {selectedPatient.lastName}
        </span>
        <button type="button" onClick={onClear}>
          Clear patient
        </button>
      </div>
    ) : (
      <div>
        <button
          type="button"
          onClick={() => onSelect({ id: 'patient-1', firstName: 'Ana', lastName: 'Gomez' })}
        >
          Select Ana
        </button>
      </div>
    ),
}))

// ============================================================================
// Helpers
// ============================================================================

function renderModal(props: Partial<ComponentProps<typeof LabworkFormModal>> = {}) {
  const onClose = vi.fn()
  const onSubmit = vi.fn().mockResolvedValue(undefined)
  const utils = render(
    <LabworkFormModal isOpen onClose={onClose} onSubmit={onSubmit} {...props} />
  )
  return { onClose, onSubmit, ...utils }
}

function getLabInput() {
  return document.getElementById('lab') as HTMLInputElement
}

function getPhoneInput() {
  return document.getElementById('phoneNumber') as HTMLInputElement
}

function makeLabwork(overrides: Partial<Labwork> = {}): Labwork {
  return {
    id: 'labwork-1',
    tenantId: 'tenant-1',
    patientId: 'patient-1',
    appointmentId: null,
    priceIncludedInAppointment: false,
    lab: 'Lab Dental Central',
    phoneNumber: null,
    date: '2026-01-15T00:00:00Z',
    note: null,
    price: 100,
    isPaid: false,
    isDelivered: false,
    doctorIds: [],
    isActive: true,
    deletedAt: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    patient: {
      id: 'patient-1',
      firstName: 'Ana',
      lastName: 'Gomez',
      email: null,
      phone: null,
    },
    ...overrides,
  }
}

async function fillRequiredFieldsAndSubmit(labValue: string, { onSubmit }: { onSubmit: ReturnType<typeof vi.fn> }) {
  fireEvent.click(screen.getByRole('button', { name: 'Select Ana' }))

  fireEvent.change(getLabInput(), { target: { value: labValue } })
  fireEvent.change(screen.getByLabelText(/Fecha/), { target: { value: '2026-01-15' } })
  fireEvent.change(screen.getByLabelText(/Precio/), { target: { value: '100' } })

  fireEvent.click(screen.getByRole('button', { name: 'Crear Trabajo' }))

  await waitFor(() => expect(onSubmit).toHaveBeenCalled())
}

describe('LabworkFormModal — lab name autocomplete', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getAppointmentsByPatientMock.mockResolvedValue([])
  })

  describe('datalist wiring', () => {
    it('fetches lab names on open and renders them as datalist options wired to the input', async () => {
      getLabNamesMock.mockResolvedValue({ success: true, data: ['Beta Lab', 'Alpha Lab'] })

      renderModal()

      expect(getLabNamesMock).toHaveBeenCalledTimes(1)

      const input = getLabInput()
      expect(input).toHaveAttribute('list', 'lab-name-suggestions')

      await waitFor(() => {
        expect(document.getElementById('lab-name-suggestions')).not.toBeNull()
      })
      const datalist = document.getElementById('lab-name-suggestions') as HTMLDataListElement
      await waitFor(() => expect(datalist.querySelectorAll('option')).toHaveLength(2))

      const optionValues = Array.from(datalist.querySelectorAll('option')).map((o) => (o as HTMLOptionElement).value)
      expect(optionValues).toEqual(['Beta Lab', 'Alpha Lab'])
    })

    it('does not fetch lab names while the modal is closed', () => {
      getLabNamesMock.mockResolvedValue({ success: true, data: ['Alpha Lab'] })

      renderModal({ isOpen: false })

      expect(getLabNamesMock).not.toHaveBeenCalled()
    })

    it('renders an empty datalist (not an error) when getLabNames() rejects', async () => {
      getLabNamesMock.mockRejectedValue(new Error('network error'))

      renderModal()

      await waitFor(() => expect(getLabNamesMock).toHaveBeenCalledTimes(1))

      const datalist = document.getElementById('lab-name-suggestions') as HTMLDataListElement
      expect(datalist.querySelectorAll('option')).toHaveLength(0)
    })
  })

  describe('free-text entry', () => {
    it('submits a brand-new lab name that is not among the fetched suggestions', async () => {
      getLabNamesMock.mockResolvedValue({ success: true, data: ['Existing Lab'] })

      const { onSubmit } = renderModal()

      await waitFor(() => {
        const datalist = document.getElementById('lab-name-suggestions') as HTMLDataListElement
        expect(datalist.querySelectorAll('option')).toHaveLength(1)
      })

      await fillRequiredFieldsAndSubmit('Brand New Lab', { onSubmit })

      expect(onSubmit.mock.calls[0][0]).toMatchObject({ lab: 'Brand New Lab' })
    })
  })
})

describe('LabworkFormModal — lab contact phone', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getLabNamesMock.mockResolvedValue({ success: true, data: [] })
    getAppointmentsByPatientMock.mockResolvedValue([])
  })

  it('renders a labeled tel input for the lab phone in the create form', async () => {
    renderModal()
    await waitFor(() => expect(getLabNamesMock).toHaveBeenCalledTimes(1))

    const input = getPhoneInput()
    expect(input).not.toBeNull()
    expect(input).toHaveAttribute('type', 'tel')
    expect(screen.getByLabelText('Teléfono del laboratorio')).toBe(input)
    expect(input.value).toBe('')
  })

  it('prefills the phone input from the existing record when editing a labwork with a phoneNumber', async () => {
    renderModal({ labwork: makeLabwork({ phoneNumber: '+598 99 123 456' }) })

    await waitFor(() => expect(getPhoneInput().value).toBe('+598 99 123 456'))
  })

  it('prefills the phone input as empty when editing a labwork without a phoneNumber', async () => {
    renderModal({ labwork: makeLabwork({ phoneNumber: null }) })

    await waitFor(() => expect(screen.getByText('Ana Gomez')).toBeInTheDocument())
    expect(getPhoneInput().value).toBe('')
  })

  it('includes phoneNumber in the submit payload when filled', async () => {
    const { onSubmit } = renderModal()

    fireEvent.change(getPhoneInput(), { target: { value: '+598 99 123 456' } })
    await fillRequiredFieldsAndSubmit('Lab Dental Central', { onSubmit })

    expect(onSubmit.mock.calls[0][0]).toMatchObject({ phoneNumber: '+598 99 123 456' })
  })

  it('omits phoneNumber from the submit payload when left blank', async () => {
    const { onSubmit } = renderModal()

    await fillRequiredFieldsAndSubmit('Lab Dental Central', { onSubmit })

    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty('phoneNumber')
  })

  it('omits phoneNumber from the submit payload when editing clears a previously set phone', async () => {
    const { onSubmit } = renderModal({ labwork: makeLabwork({ phoneNumber: '+598 99 123 456' }) })

    await waitFor(() => expect(getPhoneInput().value).toBe('+598 99 123 456'))
    fireEvent.change(getPhoneInput(), { target: { value: '' } })

    fireEvent.change(screen.getByLabelText(/Precio/), { target: { value: '100' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar Cambios' }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty('phoneNumber')
  })
})
