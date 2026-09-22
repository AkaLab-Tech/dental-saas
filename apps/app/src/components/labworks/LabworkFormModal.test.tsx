import type { ComponentProps } from 'react'
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import i18n from 'i18next'
import '@/i18n'
import { LabworkFormModal } from './LabworkFormModal'
import type { Labwork } from '@/lib/labwork-api'
import type { Doctor } from '@/lib/doctor-api'

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

const getDoctorsMock = vi.fn()

vi.mock('@/lib/doctor-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/doctor-api')>('@/lib/doctor-api')
  return {
    ...actual,
    getDoctors: (...args: unknown[]) => getDoctorsMock(...args),
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
    doctors: [],
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
    getDoctorsMock.mockResolvedValue([])
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
    getDoctorsMock.mockResolvedValue([])
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

  it('sends phoneNumber: null when editing clears a previously set phone', async () => {
    const { onSubmit } = renderModal({ labwork: makeLabwork({ phoneNumber: '+598 99 123 456' }) })

    await waitFor(() => expect(getPhoneInput().value).toBe('+598 99 123 456'))
    fireEvent.change(getPhoneInput(), { target: { value: '' } })

    fireEvent.change(screen.getByLabelText(/Precio/), { target: { value: '100' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar Cambios' }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ phoneNumber: null })
  })
})

describe('LabworkFormModal — doctor assignment (#242)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getLabNamesMock.mockResolvedValue({ success: true, data: [] })
    getAppointmentsByPatientMock.mockResolvedValue([])
  })

  function makeDoctor(overrides: Partial<Doctor> = {}): Doctor {
    return {
      id: 'doc-1',
      tenantId: 'tenant-1',
      firstName: 'Jane',
      lastName: 'Smith',
      email: null,
      phone: null,
      specialty: null,
      licenseNumber: null,
      workingDays: [],
      workingHours: null,
      consultingRoom: null,
      avatar: null,
      bio: null,
      hourlyRate: null,
      commissionPercentage: null,
      isActive: true,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      ...overrides,
    }
  }

  it('fetches active doctors with a limit of 100 when the modal opens', async () => {
    getDoctorsMock.mockResolvedValue([])

    renderModal()

    await waitFor(() => expect(getDoctorsMock).toHaveBeenCalledWith({ limit: 100 }))
  })

  it('does not fetch doctors while the modal is closed', () => {
    getDoctorsMock.mockResolvedValue([])

    renderModal({ isOpen: false })

    expect(getDoctorsMock).not.toHaveBeenCalled()
  })

  it('renders a checkbox per fetched doctor, unchecked by default on create', async () => {
    getDoctorsMock.mockResolvedValue([makeDoctor({ id: 'doc-1', firstName: 'Jane', lastName: 'Smith' })])

    renderModal()

    await waitFor(() => expect(screen.getByLabelText('Jane Smith')).toBeInTheDocument())
    expect(screen.getByLabelText('Jane Smith')).not.toBeChecked()
  })

  it('includes the checked doctor id(s) in the submit payload', async () => {
    getDoctorsMock.mockResolvedValue([makeDoctor({ id: 'doc-1', firstName: 'Jane', lastName: 'Smith' })])
    const { onSubmit } = renderModal()

    await waitFor(() => expect(screen.getByLabelText('Jane Smith')).toBeInTheDocument())
    fireEvent.click(screen.getByLabelText('Jane Smith'))

    await fillRequiredFieldsAndSubmit('Lab Dental Central', { onSubmit })

    expect(onSubmit.mock.calls[0][0]).toMatchObject({ doctorIds: ['doc-1'] })
  })

  it('submits doctorIds: [] (not omitted, not undefined) when no doctor is selected', async () => {
    getDoctorsMock.mockResolvedValue([makeDoctor({ id: 'doc-1', firstName: 'Jane', lastName: 'Smith' })])
    const { onSubmit } = renderModal()

    await waitFor(() => expect(screen.getByLabelText('Jane Smith')).toBeInTheDocument())

    await fillRequiredFieldsAndSubmit('Lab Dental Central', { onSubmit })

    expect(onSubmit.mock.calls[0][0]).toHaveProperty('doctorIds')
    expect(onSubmit.mock.calls[0][0].doctorIds).toEqual([])
  })

  it('pre-fills the checkboxes for the doctors already assigned to the labwork being edited', async () => {
    getDoctorsMock.mockResolvedValue([
      makeDoctor({ id: 'doc-1', firstName: 'Jane', lastName: 'Smith' }),
      makeDoctor({ id: 'doc-2', firstName: 'Bob', lastName: 'Lee' }),
    ])

    renderModal({
      labwork: makeLabwork({
        doctorIds: ['doc-1'],
        doctors: [{ id: 'doc-1', firstName: 'Jane', lastName: 'Smith', isActive: true }],
      }),
    })

    await waitFor(() => expect(screen.getByLabelText('Jane Smith')).toBeInTheDocument())
    expect(screen.getByLabelText('Jane Smith')).toBeChecked()
    expect(screen.getByLabelText('Bob Lee')).not.toBeChecked()
  })

  it('clearing every previously-assigned doctor and saving submits doctorIds: []', async () => {
    getDoctorsMock.mockResolvedValue([makeDoctor({ id: 'doc-1', firstName: 'Jane', lastName: 'Smith' })])
    const { onSubmit } = renderModal({
      labwork: makeLabwork({
        doctorIds: ['doc-1'],
        doctors: [{ id: 'doc-1', firstName: 'Jane', lastName: 'Smith', isActive: true }],
      }),
    })

    await waitFor(() => expect(screen.getByLabelText('Jane Smith')).toBeChecked())
    fireEvent.click(screen.getByLabelText('Jane Smith'))
    expect(screen.getByLabelText('Jane Smith')).not.toBeChecked()

    fireEvent.change(screen.getByLabelText(/Precio/), { target: { value: '100' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar Cambios' }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(onSubmit.mock.calls[0][0].doctorIds).toEqual([])
  })

  it('appends an assigned-but-inactive doctor to the checkbox list, labelled "(Inactivo)" and pre-checked', async () => {
    // doc-2 is no longer in the active list returned by getDoctors, but is
    // still assigned to this labwork (deactivated after assignment).
    getDoctorsMock.mockResolvedValue([makeDoctor({ id: 'doc-1', firstName: 'Jane', lastName: 'Smith' })])

    renderModal({
      labwork: makeLabwork({
        doctorIds: ['doc-1', 'doc-2'],
        doctors: [
          { id: 'doc-1', firstName: 'Jane', lastName: 'Smith', isActive: true },
          { id: 'doc-2', firstName: 'Bob', lastName: 'Lee', isActive: false },
        ],
      }),
    })

    await waitFor(() => expect(screen.getByLabelText('Bob Lee (Inactivo)')).toBeInTheDocument())
    expect(screen.getByLabelText('Bob Lee (Inactivo)')).toBeChecked()
  })

  it('an inactive assigned doctor survives a save that never touches the doctor field', async () => {
    getDoctorsMock.mockResolvedValue([makeDoctor({ id: 'doc-1', firstName: 'Jane', lastName: 'Smith' })])
    const { onSubmit } = renderModal({
      labwork: makeLabwork({
        doctorIds: ['doc-1', 'doc-2'],
        doctors: [
          { id: 'doc-1', firstName: 'Jane', lastName: 'Smith', isActive: true },
          { id: 'doc-2', firstName: 'Bob', lastName: 'Lee', isActive: false },
        ],
      }),
    })

    await waitFor(() => expect(screen.getByLabelText('Bob Lee (Inactivo)')).toBeChecked())

    // Touch an unrelated field only — never interact with a doctor checkbox.
    fireEvent.change(screen.getByLabelText(/Precio/), { target: { value: '250' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar Cambios' }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(onSubmit.mock.calls[0][0].doctorIds).toEqual(expect.arrayContaining(['doc-1', 'doc-2']))
    expect(onSubmit.mock.calls[0][0].doctorIds).toHaveLength(2)
  })
})
