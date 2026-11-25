import type { ComponentProps } from 'react'
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import i18n from 'i18next'
import '@/i18n'
import { AppointmentFormModal } from './AppointmentFormModal'
import type { Appointment } from '../../lib/appointment-api'

/**
 * Task #713: a stored cost of 1500 went to empty with no trace. The clearing
 * has one exit (`handleFormSubmit`'s `cost: data.cost ? ... : null`), and it
 * must discriminate three cases that all arrive at the cost input as an empty
 * `value`:
 *   G1 the field was never touched -> the stored figure is submitted;
 *   G2 the operator emptied it     -> `cost: null`, the deliberate clear (#685);
 *   G3 the browser sanitized a value it could not parse (`validity.badInput`,
 *      e.g. the es-UY "1.500,00") -> the submit is refused.
 *
 * jsdom implements neither the number input's value-sanitization algorithm nor
 * `badInput`, so G3 stubs `validity` on the input. That is why G6
 * (apps/app/e2e/appointment-cost-clear.spec.ts) exists: only real Chromium can
 * establish that the browser step happens at all. G3 only establishes that the
 * component reacts correctly when it does.
 *
 * Assertions are on the submitted `cost`, never on `updatedAt`:
 * `recalculatePaidStatus` moves `updatedAt` on rows no human touched.
 *
 * The mocks mirror AppointmentFormModal.cost-prefill-deliberate-clear.test.tsx
 * (#698); this file is separate because AppointmentFormModal.test.tsx is
 * already ~3000 lines.
 */

beforeAll(async () => {
  await i18n.changeLanguage('es')
})

const getDoctorsMock = vi.fn()
const getPatientsMock = vi.fn()
const listBudgetsByPatientMock = vi.fn()
const getAppointmentBudgetItemsMock = vi.fn()
const getAppointmentByIdMock = vi.fn()

vi.mock('../../lib/doctor-api', () => ({
  getDoctors: (...args: unknown[]) => getDoctorsMock(...args),
}))
vi.mock('../../lib/patient-api', () => ({
  getPatients: (...args: unknown[]) => getPatientsMock(...args),
}))
vi.mock('../../lib/budget-api', async () => {
  const actual = await vi.importActual<typeof import('../../lib/budget-api')>('../../lib/budget-api')
  return {
    ...actual,
    listBudgetsByPatient: (...args: unknown[]) => listBudgetsByPatientMock(...args),
  }
})
vi.mock('../../lib/appointment-api', async () => {
  const actual = await vi.importActual<typeof import('../../lib/appointment-api')>('../../lib/appointment-api')
  return {
    ...actual,
    getAppointmentBudgetItems: (...args: unknown[]) => getAppointmentBudgetItemsMock(...args),
    getAppointmentById: (...args: unknown[]) => getAppointmentByIdMock(...args),
  }
})
vi.mock('../../stores/auth.store', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) => selector({ user: { tenant: { currency: 'USD' } } }),
}))
vi.mock('../../stores/settings.store', () => ({
  useSettingsStore: (selector: (s: unknown) => unknown) =>
    selector({ settings: null, fetchSettings: vi.fn() }),
}))
vi.mock('../ui/PatientSearchCombobox', () => ({
  PatientSearchCombobox: () => <div />,
}))

function makeAppointment(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: 'apt-1',
    tenantId: 'tenant-1',
    patientId: 'patient-1',
    doctorId: 'doc-1',
    startTime: '2026-03-10T13:00:00.000Z',
    endTime: '2026-03-10T13:30:00.000Z',
    duration: 30,
    status: 'SCHEDULED',
    type: null,
    notes: null,
    privateNotes: null,
    cost: null,
    isPaid: false,
    hasRecordedPayment: false,
    recordedPaidAmount: 0,
    isActive: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

const mockDoctor = {
  id: 'doc-1',
  tenantId: 'tenant-1',
  firstName: 'Carlos',
  lastName: 'Ruiz',
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
  isActive: true,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
}

const mockPatientRecord = {
  id: 'patient-1',
  tenantId: 'tenant-1',
  firstName: 'Ana',
  lastName: 'Gomez',
  email: null,
  phone: null,
  dob: null,
  gender: null,
  address: null,
  notes: null,
  teeth: null,
  showPrimaryTeeth: false,
  isActive: true,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
}

type ModalProps = ComponentProps<typeof AppointmentFormModal>

function renderModal(props: Partial<ModalProps> = {}) {
  const onClose = vi.fn()
  const onSubmit = vi.fn().mockResolvedValue(undefined)
  const rendered = render(<AppointmentFormModal isOpen onClose={onClose} onSubmit={onSubmit} {...props} />)
  return { ...rendered, onSubmit }
}

async function openEdit(appointment: Appointment) {
  const modal = renderModal({ appointment })
  await waitFor(() => {
    expect(screen.getByLabelText('Doctor *')).not.toBeDisabled()
  })
  return modal
}

function getCostInput() {
  const container = screen.getByText('Costo ($)').parentElement
  if (!container) throw new Error('No cost container found')
  return within(container).getByRole('spinbutton') as HTMLInputElement
}

function save() {
  fireEvent.click(screen.getByRole('button', { name: 'Guardar Cambios' }))
}

/** Makes the input report what a real browser reports for "1.500,00". */
function stubBadInput(input: HTMLInputElement) {
  Object.defineProperty(input, 'validity', {
    configurable: true,
    value: { badInput: true, valid: false },
  })
}

describe('AppointmentFormModal — an empty cost field means three different things (#713)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getDoctorsMock.mockResolvedValue([mockDoctor])
    getPatientsMock.mockResolvedValue([mockPatientRecord])
    getAppointmentByIdMock.mockImplementation(() => Promise.resolve(makeAppointment()))
    getAppointmentBudgetItemsMock.mockResolvedValue([])
    listBudgetsByPatientMock.mockResolvedValue({ data: [], total: 0 })
  })

  it('G1. an edit that never touches the cost field submits the stored 1500', async () => {
    const { onSubmit } = await openEdit(makeAppointment({ cost: 1500 }))
    expect(getCostInput().value).toBe('1500')

    save()

    // Vacuity check: the submit really happened.
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ cost: 1500 })
  })

  it('G2. a deliberate clear still clears: an empty change event submits cost null', async () => {
    const { onSubmit } = await openEdit(makeAppointment({ cost: 1500 }))

    fireEvent.change(getCostInput(), { target: { value: '' } })
    save()

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ cost: null })
  })

  it('G3. a value the browser could not parse is refused, not submitted as a clear', async () => {
    const { onSubmit } = await openEdit(makeAppointment({ cost: 1500 }))

    const input = getCostInput()
    stubBadInput(input)
    // What a real number input does with "1.500,00": the DOM value is '' while
    // the operator still sees her own figure on screen.
    fireEvent.change(input, { target: { value: '' } })

    save()

    // The payload assertion comes first on purpose: it is the defect itself,
    // and an assertion placed after a failing one is never reached. The wait
    // gives the async resolver + handleSubmit room to call onSubmit if it is
    // going to.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByText(i18n.t('appointments.form.costInvalid'))).toBeInTheDocument()
  })

  it('G3b. the refusal lifts once the figure parses: the corrected value submits', async () => {
    const { onSubmit } = await openEdit(makeAppointment({ cost: 1500 }))

    const input = getCostInput()
    stubBadInput(input)
    fireEvent.change(input, { target: { value: '' } })
    save()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(onSubmit).not.toHaveBeenCalled()

    Object.defineProperty(input, 'validity', {
      configurable: true,
      value: { badInput: false, valid: true },
    })
    fireEvent.change(input, { target: { value: '1500' } })
    save()

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ cost: 1500 })
  })
})
