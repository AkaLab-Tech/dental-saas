import type { ComponentProps } from 'react'
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import i18n from 'i18next'
import '@/i18n'
import { AppointmentFormModal } from './AppointmentFormModal'
import type { Appointment } from '../../lib/appointment-api'

/**
 * Task #717: typing a paidAmount on a visit with no charge of its own shows a
 * warning that the money stays as credit and does not pay this visit.
 *
 * The charge has two authorities, both read here: a typed `cost > 0`, or an
 * EXECUTED link whose item price is > 0 (arrives as `budgetItems.cost > 0`).
 * The warning must never fire on an unknown (#544 self-fetch in flight or
 * failed). The mocks mirror AppointmentFormModal.test.tsx; this file is
 * separate because that one is already ~3000 lines.
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

function renderModal(props: Partial<ComponentProps<typeof AppointmentFormModal>> = {}) {
  return render(
    <AppointmentFormModal
      isOpen
      onClose={vi.fn()}
      onSubmit={vi.fn().mockResolvedValue(undefined)}
      {...props}
    />
  )
}

async function waitForOptionsLoaded() {
  await waitFor(() => {
    expect(screen.getByLabelText('Doctor *')).not.toBeDisabled()
  })
}

function getPaidAmountInput() {
  const container = screen.getByText('Monto abonado ($)').parentElement
  if (!container) throw new Error('No paidAmount container found')
  return within(container).getByRole('spinbutton') as HTMLInputElement
}

function getCostInput() {
  const container = screen.getByText('Costo ($)').parentElement
  if (!container) throw new Error('No cost container found')
  return within(container).getByRole('spinbutton') as HTMLInputElement
}

const warningText = () => i18n.t('appointments.form.paidWithoutChargeWarning')
const defaultHint = () => i18n.t('appointments.form.paidAmountHint')
const queryWarning = () => screen.queryByText(warningText())

/** Renders an edited appointment, waits until its charge is known, and types a paidAmount. */
async function renderAndType(appointment: Appointment, typed: string | null = '400') {
  renderModal({ appointment })
  await waitForOptionsLoaded()
  // The by-id fetch (#544) must have settled for the charge to be "known".
  if (!appointment.budgetItems) {
    await waitFor(() => expect(getAppointmentByIdMock).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(screen.queryByText(i18n.t('appointments.budgetItems.executedChargeLoading'))).not.toBeInTheDocument()
    )
  }
  if (typed !== null) fireEvent.change(getPaidAmountInput(), { target: { value: typed } })
}

describe('AppointmentFormModal — payment typed on a charge-less visit (#717)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getDoctorsMock.mockResolvedValue([mockDoctor])
    getPatientsMock.mockResolvedValue([mockPatientRecord])
    listBudgetsByPatientMock.mockResolvedValue({ data: [], total: 0 })
    getAppointmentBudgetItemsMock.mockResolvedValue([])
    // Fetched fine, nothing executed (the realistic answer for a charge-less visit).
    getAppointmentByIdMock.mockImplementation(() => Promise.resolve(makeAppointment()))
  })

  it('the warning text resolves to a real translation naming credit, not the key', () => {
    expect(warningText()).not.toBe('appointments.form.paidWithoutChargeWarning')
    expect(warningText()).toMatch(/saldo a favor/)
    expect(warningText()).toMatch(/no paga esta visita/)
  })

  // G1: fires on charge-less, absent on a costed one through the same props shape.
  describe('G1 — present on cost null, absent on cost 2500', () => {
    it('cost: null + paidAmount typed -> the warning is shown and replaces the default hint', async () => {
      await renderAndType(makeAppointment({ cost: null }))
      expect(getCostInput().value).toBe('')
      expect(getPaidAmountInput().value).toBe('400')

      const warning = await screen.findByText(warningText())
      expect(warning).toHaveAttribute('role', 'alert')
      expect(screen.queryByText(defaultHint())).not.toBeInTheDocument()
    })

    it('cost: 2500 + paidAmount typed -> no warning, the default hint stays', async () => {
      await renderAndType(makeAppointment({ cost: 2500 }))
      expect(getCostInput().value).toBe('2500')
      expect(getPaidAmountInput().value).toBe('400')

      expect(queryWarning()).not.toBeInTheDocument()
      expect(screen.getByText(defaultHint())).toBeInTheDocument()
    })

    it('typing a cost into the charge-less form makes the warning go away (typed cost is an authority)', async () => {
      await renderAndType(makeAppointment({ cost: null }))
      expect(await screen.findByText(warningText())).toBeInTheDocument()

      fireEvent.change(getCostInput(), { target: { value: '900' } })
      await waitFor(() => expect(queryWarning()).not.toBeInTheDocument())
    })

    it('a typed cost of 0 is not a charge: the warning stays', async () => {
      await renderAndType(makeAppointment({ cost: null }))
      fireEvent.change(getCostInput(), { target: { value: '0' } })
      expect(await screen.findByText(warningText())).toBeInTheDocument()
    })

    it('create mode (no appointment yet, nothing unknown) warns on a typed paidAmount with no cost', async () => {
      renderModal()
      await waitForOptionsLoaded()
      fireEvent.change(getPaidAmountInput(), { target: { value: '250' } })
      expect(await screen.findByText(warningText())).toBeInTheDocument()

      fireEvent.change(getCostInput(), { target: { value: '800' } })
      await waitFor(() => expect(queryWarning()).not.toBeInTheDocument())
    })
  })

  // G2: an EXECUTED item is a charge by the second authority.
  describe('G2 — an EXECUTED budget item with a price is a charge', () => {
    it('cost: null + budgetItems.cost 3000 + paidAmount typed -> absent', async () => {
      await renderAndType(
        makeAppointment({
          cost: null,
          budgetItems: { count: 1, cost: 3000, paidAmount: 0, outstanding: 3000 },
        })
      )
      expect(getPaidAmountInput().value).toBe('400')
      // The item figure is on screen, so this is not an unrendered form.
      expect(screen.getByText(/Ítems de presupuesto ejecutados en esta cita: 1/)).toBeInTheDocument()
      expect(queryWarning()).not.toBeInTheDocument()
    })
  })

  // G3: the link alone is not a charge; the price is.
  describe('G3 — the link alone is not a charge', () => {
    it('(a) cost: 0 + budgetItems {count 1, cost 1800} + paidAmount typed -> absent (a typed 0 does not supersede the item)', async () => {
      await renderAndType(
        makeAppointment({
          cost: 0,
          budgetItems: { count: 1, cost: 1800, paidAmount: 0, outstanding: 1800 },
        })
      )
      expect(getPaidAmountInput().value).toBe('400')
      expect(queryWarning()).not.toBeInTheDocument()
    })

    it('(b) an EXECUTED link on a zero-price item reaches the client as NO budgetItems -> present', async () => {
      // Pinned at its origin in apps/api/src/services/payment-charge-less-payment.test.ts.
      const appointment = makeAppointment({ cost: null })
      expect(appointment.budgetItems).toBeUndefined()
      await renderAndType(appointment)
      expect(await screen.findByText(warningText())).toBeInTheDocument()
    })

    it('(b, fetched) the by-id read also answers without budgetItems -> present', async () => {
      getAppointmentByIdMock.mockResolvedValue(makeAppointment({ cost: null }))
      await renderAndType(makeAppointment({ cost: null }))
      expect(await screen.findByText(warningText())).toBeInTheDocument()
    })

    it('a zero-cost budgetItems summary (count 1, cost 0) is not a charge -> present', async () => {
      await renderAndType(
        makeAppointment({
          cost: null,
          budgetItems: { count: 1, cost: 0, paidAmount: 0, outstanding: 0 },
        })
      )
      expect(await screen.findByText(warningText())).toBeInTheDocument()
    })

    it('the item charge arriving through the by-id fetch (prop lacks budgetItems) also silences it', async () => {
      getAppointmentByIdMock.mockResolvedValue(
        makeAppointment({
          cost: null,
          budgetItems: { count: 1, cost: 2200, paidAmount: 0, outstanding: 2200 },
        })
      )
      renderModal({ appointment: makeAppointment({ cost: null }) })
      await waitForOptionsLoaded()
      await screen.findByText(/Ítems de presupuesto ejecutados en esta cita: 1/)
      fireEvent.change(getPaidAmountInput(), { target: { value: '400' } })
      expect(queryWarning()).not.toBeInTheDocument()
    })
  })

  // G5: vacuity.
  describe('G5 — vacuity: nothing typed, nothing shown', () => {
    it('cost: null with paidAmount empty -> no warning, default hint', async () => {
      await renderAndType(makeAppointment({ cost: null }), null)
      expect(getPaidAmountInput().value).toBe('')
      expect(queryWarning()).not.toBeInTheDocument()
      expect(screen.getByText(defaultHint())).toBeInTheDocument()
    })

    it('typing then clearing the amount removes the warning; 0 is not a payment either', async () => {
      await renderAndType(makeAppointment({ cost: null }))
      expect(await screen.findByText(warningText())).toBeInTheDocument()

      fireEvent.change(getPaidAmountInput(), { target: { value: '' } })
      await waitFor(() => expect(queryWarning()).not.toBeInTheDocument())

      fireEvent.change(getPaidAmountInput(), { target: { value: '0' } })
      expect(queryWarning()).not.toBeInTheDocument()
    })
  })

  // G6: unknown is not zero.
  describe('G6 — an unknown charge is never claimed to be none', () => {
    it('with the #544 self-fetch in flight (executedLoading) -> absent, until it resolves', async () => {
      let resolveFetch!: (a: Appointment) => void
      getAppointmentByIdMock.mockImplementation(
        () => new Promise<Appointment>((res) => (resolveFetch = res))
      )
      renderModal({ appointment: makeAppointment({ cost: null }) })
      await waitForOptionsLoaded()
      await waitFor(() => expect(getAppointmentByIdMock).toHaveBeenCalledTimes(1))
      expect(screen.getByText(i18n.t('appointments.budgetItems.executedChargeLoading'))).toBeInTheDocument()

      fireEvent.change(getPaidAmountInput(), { target: { value: '400' } })
      expect(getPaidAmountInput().value).toBe('400')
      expect(queryWarning()).not.toBeInTheDocument()

      // Control: once the fetch settles with no item charge, the same form warns.
      resolveFetch(makeAppointment({ cost: null }))
      expect(await screen.findByText(warningText())).toBeInTheDocument()
    })

    it('with the self-fetch failed (executedUnavailable) -> absent, and the unavailable notice is what shows', async () => {
      getAppointmentByIdMock.mockRejectedValue(new Error('network down'))
      renderModal({ appointment: makeAppointment({ cost: null }) })
      await waitForOptionsLoaded()
      expect(
        await screen.findByText(i18n.t('appointments.budgetItems.executedChargeUnavailable'))
      ).toBeInTheDocument()

      fireEvent.change(getPaidAmountInput(), { target: { value: '400' } })
      expect(getPaidAmountInput().value).toBe('400')
      expect(queryWarning()).not.toBeInTheDocument()
    })
  })

  describe('existing hints keep their precedence', () => {
    it('an appointment with a recorded payment shows its own hint, not the warning', async () => {
      renderModal({
        appointment: makeAppointment({
          cost: null,
          hasRecordedPayment: true,
          recordedPaidAmount: 300,
          budgetItems: { count: 0, cost: 0, paidAmount: 0, outstanding: 0 },
        }),
      })
      await waitForOptionsLoaded()
      expect(queryWarning()).not.toBeInTheDocument()
      expect(screen.getByText(i18n.t('appointments.form.partialPaymentRecordedHint'))).toBeInTheDocument()
    })
  })
})
