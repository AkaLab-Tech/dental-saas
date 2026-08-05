import type { ComponentProps } from 'react'
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import i18n from 'i18next'
import '@/i18n'
import { AppointmentFormModal } from './AppointmentFormModal'
import type { Appointment, AppointmentBudgetItemSummary } from '../../lib/appointment-api'
import type { Budget, BudgetItem } from '../../lib/budget-api'

beforeAll(async () => {
  await i18n.changeLanguage('es')
})

// ============================================================================
// Mocks
// ============================================================================

const getDoctorsMock = vi.fn()
const getPatientsMock = vi.fn()
const listBudgetsByPatientMock = vi.fn()
const getAppointmentBudgetItemsMock = vi.fn()

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
  }
})

vi.mock('../../stores/auth.store', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) => selector({ user: { tenant: { currency: 'USD' } } }),
}))

// Test double for the patient combobox: mirrors the real component's public
// contract (selectedPatient / onSelect / onClear) without the debounced
// search internals, which are exercised by PatientSearchCombobox's own tests.
vi.mock('../ui/PatientSearchCombobox', () => ({
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
        <button
          type="button"
          onClick={() => onSelect({ id: 'patient-2', firstName: 'Beto', lastName: 'Lopez' })}
        >
          Select Beto
        </button>
      </div>
    ),
}))

// ============================================================================
// Fixtures
// ============================================================================

function makeBudgetItem(overrides: Partial<BudgetItem> = {}): BudgetItem {
  return {
    id: 'item-1',
    budgetId: 'budget-1',
    description: 'Item',
    toothNumber: null,
    quantity: 1,
    unitPrice: '100',
    totalPrice: '100',
    plannedAppointmentType: null,
    status: 'PENDING',
    notes: null,
    order: 0,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function makeBudget(overrides: Partial<Budget> = {}): Budget {
  return {
    id: 'budget-1',
    tenantId: 'tenant-1',
    patientId: 'patient-1',
    createdById: 'user-1',
    status: 'APPROVED',
    notes: null,
    validUntil: null,
    totalAmount: '100',
    publicToken: null,
    publicTokenExpiresAt: null,
    isActive: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    items: [],
    ...overrides,
  }
}

function makeAssociatedItem(overrides: Partial<AppointmentBudgetItemSummary> = {}): AppointmentBudgetItemSummary {
  return {
    id: 'item-1',
    budgetId: 'budget-1',
    description: 'Item',
    toothNumber: null,
    quantity: 1,
    unitPrice: '100',
    totalPrice: '100',
    plannedAppointmentType: null,
    status: 'SCHEDULED',
    notes: null,
    order: 0,
    roles: ['SCHEDULED'],
    ...overrides,
  }
}

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

const mockDoctor2 = {
  ...mockDoctor,
  id: 'doc-2',
  firstName: 'Diana',
  lastName: 'Perez',
}

// A promise-with-external-resolve, used to model a `getDoctors()` request
// that is still in flight while the user interacts with the rest of the form.
function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

const TITLE = 'Ítems de presupuesto'
const EMPTY_MSG = 'Este paciente no tiene ítems de presupuesto disponibles para asociar.'

function renderModal(props: Partial<ComponentProps<typeof AppointmentFormModal>> = {}) {
  const onClose = vi.fn()
  const onSubmit = vi.fn().mockResolvedValue(undefined)
  const utils = render(
    <AppointmentFormModal isOpen onClose={onClose} onSubmit={onSubmit} {...props} />
  )
  return { onClose, onSubmit, ...utils }
}

// The doctor <select> is the modal's only combobox in create mode (the
// patient combobox is stubbed above and the status select only exists when
// editing), so it can be targeted without an accessible name.
async function waitForOptionsLoaded() {
  // The modal's form-reset effect re-runs whenever `loadingOptions` flips
  // (pre-existing behavior, unrelated to budget items), which re-applies the
  // default values and would clobber a patient selected while doctors are
  // still loading. Waiting for the doctor <select> to become enabled ensures
  // that settling has already happened before a test interacts with the form.
  await waitFor(() => {
    expect(screen.getAllByRole('combobox')[0]).not.toBeDisabled()
  })
}

async function selectDoctor() {
  await waitForOptionsLoaded()
  fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'doc-1' } })
}

// The form also has a "Pagado" checkbox, so budget item checkboxes must be
// scoped to their row (found via the item's description text) rather than
// queried globally.
function getItemCheckbox(description: string) {
  const row = screen.getByText(description).closest('label')
  if (!row) throw new Error(`No row found for "${description}"`)
  return within(row).getByRole('checkbox')
}

// Regression coverage for task #323 (i18n migration): the header close
// button's aria-label used to be a hardcoded Spanish literal ("Cerrar
// formulario"); it is now wired through t('appointments.form.closeForm').
// This pins down that the real es locale resource still resolves to that
// exact string, and that the button remains queryable/functional by that name.
describe('AppointmentFormModal — close button label (i18n)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getDoctorsMock.mockResolvedValue([mockDoctor])
    getPatientsMock.mockResolvedValue([mockPatientRecord])
    listBudgetsByPatientMock.mockResolvedValue({ data: [], total: 0 })
    getAppointmentBudgetItemsMock.mockResolvedValue([])
  })

  it('renders the header close button with the translated "Cerrar formulario" aria-label and calls onClose when clicked', async () => {
    const { onClose } = renderModal()
    await waitForOptionsLoaded()

    const closeButton = screen.getByRole('button', { name: 'Cerrar formulario' })
    fireEvent.click(closeButton)

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('AppointmentFormModal — budget items association', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getDoctorsMock.mockResolvedValue([mockDoctor])
    getPatientsMock.mockResolvedValue([mockPatientRecord])
    listBudgetsByPatientMock.mockResolvedValue({ data: [], total: 0 })
    getAppointmentBudgetItemsMock.mockResolvedValue([])
  })

  describe('section visibility', () => {
    it('is hidden before a patient is selected', () => {
      renderModal()
      expect(screen.queryByText(TITLE)).not.toBeInTheDocument()
    })

    it('appears once a patient is selected', async () => {
      renderModal()
      await waitForOptionsLoaded()
      fireEvent.click(screen.getByRole('button', { name: 'Select Ana' }))
      await waitFor(() => expect(screen.getByText(TITLE)).toBeInTheDocument())
    })

    it('shows the empty-state message when the patient has no eligible items', async () => {
      listBudgetsByPatientMock.mockResolvedValue({ data: [], total: 0 })
      renderModal()
      await waitForOptionsLoaded()
      fireEvent.click(screen.getByRole('button', { name: 'Select Ana' }))
      await waitFor(() => expect(screen.getByText(EMPTY_MSG)).toBeInTheDocument())
    })
  })

  describe('eligible item filtering', () => {
    it('lists only PENDING/SCHEDULED items from non-CANCELLED budgets', async () => {
      const activeBudget = makeBudget({
        id: 'budget-1',
        status: 'APPROVED',
        items: [
          makeBudgetItem({ id: 'item-pending', description: 'Item Pending', status: 'PENDING' }),
          makeBudgetItem({ id: 'item-scheduled', description: 'Item Scheduled', status: 'SCHEDULED' }),
          makeBudgetItem({ id: 'item-executed', description: 'Item Executed', status: 'EXECUTED' }),
          makeBudgetItem({ id: 'item-cancelled', description: 'Item CancelledStatus', status: 'CANCELLED' }),
        ],
      })
      const cancelledBudget = makeBudget({
        id: 'budget-2',
        status: 'CANCELLED',
        items: [
          makeBudgetItem({ id: 'item-in-cancelled-budget', description: 'Item In Cancelled Budget', status: 'PENDING' }),
        ],
      })
      listBudgetsByPatientMock.mockResolvedValue({ data: [activeBudget, cancelledBudget], total: 2 })

      renderModal()
      await waitForOptionsLoaded()
      fireEvent.click(screen.getByRole('button', { name: 'Select Ana' }))

      await waitFor(() => expect(screen.getByText('Item Pending')).toBeInTheDocument())
      expect(screen.getByText('Item Scheduled')).toBeInTheDocument()

      expect(screen.queryByText('Item Executed')).not.toBeInTheDocument()
      expect(screen.queryByText('Item CancelledStatus')).not.toBeInTheDocument()
      expect(screen.queryByText('Item In Cancelled Budget')).not.toBeInTheDocument()
    })
  })

  describe('create submit', () => {
    it('includes selected item ids as budgetItemIds in the create payload', async () => {
      const budget = makeBudget({
        items: [makeBudgetItem({ id: 'item-a', description: 'Item A', status: 'PENDING' })],
      })
      listBudgetsByPatientMock.mockResolvedValue({ data: [budget], total: 1 })

      const { onSubmit } = renderModal()
      await waitForOptionsLoaded()
      fireEvent.click(screen.getByRole('button', { name: 'Select Ana' }))

      await waitFor(() => expect(screen.getByText('Item A')).toBeInTheDocument())
      fireEvent.click(getItemCheckbox('Item A'))

      await selectDoctor()
      fireEvent.click(screen.getByRole('button', { name: /crear cita/i }))

      await waitFor(() => expect(onSubmit).toHaveBeenCalled())
      expect(onSubmit.mock.calls[0][0]).toMatchObject({ budgetItemIds: ['item-a'] })
    })

    it('omits budgetItemIds when no items are selected', async () => {
      const budget = makeBudget({
        items: [makeBudgetItem({ id: 'item-a', description: 'Item A', status: 'PENDING' })],
      })
      listBudgetsByPatientMock.mockResolvedValue({ data: [budget], total: 1 })

      const { onSubmit } = renderModal()
      await waitForOptionsLoaded()
      fireEvent.click(screen.getByRole('button', { name: 'Select Ana' }))
      await waitFor(() => expect(screen.getByText('Item A')).toBeInTheDocument())

      await selectDoctor()
      fireEvent.click(screen.getByRole('button', { name: /crear cita/i }))

      await waitFor(() => expect(onSubmit).toHaveBeenCalled())
      expect(onSubmit.mock.calls[0][0].budgetItemIds).toBeUndefined()
    })
  })

  describe('edit pre-check', () => {
    it('checks items currently associated with role SCHEDULED, not merely-eligible or EXECUTED-only ones', async () => {
      const budget = makeBudget({
        items: [
          makeBudgetItem({ id: 'item-scheduled', description: 'Scheduled Item', status: 'SCHEDULED' }),
          makeBudgetItem({ id: 'item-pending', description: 'Pending Item', status: 'PENDING' }),
        ],
      })
      listBudgetsByPatientMock.mockResolvedValue({ data: [budget], total: 1 })
      getAppointmentBudgetItemsMock.mockResolvedValue([
        makeAssociatedItem({ id: 'item-scheduled', roles: ['SCHEDULED'] }),
        makeAssociatedItem({ id: 'item-pending', roles: ['EXECUTED'] }),
      ])

      const appointment = makeAppointment()
      renderModal({ appointment })
      await waitForOptionsLoaded()

      await waitFor(() => expect(screen.getByText('Scheduled Item')).toBeInTheDocument())

      await waitFor(() => {
        expect(getItemCheckbox('Scheduled Item')).toBeChecked()
      })
      expect(getItemCheckbox('Pending Item')).not.toBeChecked()
    })
  })

  describe('edit replace-set', () => {
    it('sends budgetItemIds without an unchecked item, always including the key', async () => {
      const budget = makeBudget({
        items: [makeBudgetItem({ id: 'item-scheduled', description: 'Scheduled Item', status: 'SCHEDULED' })],
      })
      listBudgetsByPatientMock.mockResolvedValue({ data: [budget], total: 1 })
      getAppointmentBudgetItemsMock.mockResolvedValue([
        makeAssociatedItem({ id: 'item-scheduled', roles: ['SCHEDULED'] }),
      ])

      const appointment = makeAppointment()
      const { onSubmit } = renderModal({ appointment })
      await waitForOptionsLoaded()

      await waitFor(() => expect(screen.getByText('Scheduled Item')).toBeInTheDocument())
      await waitFor(() => expect(getItemCheckbox('Scheduled Item')).toBeChecked())

      fireEvent.click(getItemCheckbox('Scheduled Item'))
      expect(getItemCheckbox('Scheduled Item')).not.toBeChecked()

      fireEvent.click(screen.getByRole('button', { name: /guardar cambios/i }))

      await waitFor(() => expect(onSubmit).toHaveBeenCalled())
      expect(onSubmit.mock.calls[0][0]).toMatchObject({ budgetItemIds: [] })
      expect('budgetItemIds' in onSubmit.mock.calls[0][0]).toBe(true)
    })
  })

  describe('patient change reset', () => {
    it('refetches the item list and clears the previous selection when the patient changes', async () => {
      const budgetForAna = makeBudget({
        patientId: 'patient-1',
        items: [makeBudgetItem({ id: 'item-ana', description: 'Ana Item', status: 'PENDING' })],
      })
      const budgetForBeto = makeBudget({
        patientId: 'patient-2',
        items: [makeBudgetItem({ id: 'item-beto', description: 'Beto Item', status: 'PENDING' })],
      })
      listBudgetsByPatientMock.mockImplementation((patientId: string) => {
        if (patientId === 'patient-1') return Promise.resolve({ data: [budgetForAna], total: 1 })
        if (patientId === 'patient-2') return Promise.resolve({ data: [budgetForBeto], total: 1 })
        return Promise.resolve({ data: [], total: 0 })
      })

      renderModal()
      await waitForOptionsLoaded()

      fireEvent.click(screen.getByRole('button', { name: 'Select Ana' }))
      await waitFor(() => expect(screen.getByText('Ana Item')).toBeInTheDocument())
      fireEvent.click(getItemCheckbox('Ana Item'))
      expect(getItemCheckbox('Ana Item')).toBeChecked()

      fireEvent.click(screen.getByRole('button', { name: 'Clear patient' }))
      fireEvent.click(screen.getByRole('button', { name: 'Select Beto' }))

      await waitFor(() => expect(screen.getByText('Beto Item')).toBeInTheDocument())
      expect(screen.queryByText('Ana Item')).not.toBeInTheDocument()
      expect(getItemCheckbox('Beto Item')).not.toBeChecked()

      expect(listBudgetsByPatientMock).toHaveBeenCalledWith('patient-2', { limit: 100 })
    })
  })

  // Regression coverage for the reset-race: the reset effect used to depend
  // on `loadingOptions`, so it re-ran (and wiped the form) the moment
  // getDoctors() resolved, discarding anything selected while it was still
  // in flight. The fix gates the reset on a ref keyed by appointment identity
  // instead, so it runs exactly once per modal-open.
  describe('regression: interactions made while getDoctors() is still pending', () => {
    it('survive the doctors request resolving (patient selection + checked budget item are not wiped)', async () => {
      const budget = makeBudget({
        items: [makeBudgetItem({ id: 'item-a', description: 'Item A', status: 'PENDING' })],
      })
      listBudgetsByPatientMock.mockResolvedValue({ data: [budget], total: 1 })

      const deferredDoctors = createDeferred<typeof mockDoctor[]>()
      getDoctorsMock.mockReturnValue(deferredDoctors.promise)

      renderModal()

      // getDoctors() has not resolved yet: the doctor <select> is disabled.
      expect(screen.getAllByRole('combobox')[0]).toBeDisabled()

      // Interact with the form while that request is still pending: select a
      // patient (budget items load off a separate, fast-resolving mock) and
      // check one of the resulting budget items.
      fireEvent.click(screen.getByRole('button', { name: 'Select Ana' }))
      await waitFor(() => expect(screen.getByText('Item A')).toBeInTheDocument())
      fireEvent.click(getItemCheckbox('Item A'))
      expect(getItemCheckbox('Item A')).toBeChecked()
      expect(screen.getByTestId('selected-patient')).toHaveTextContent('Ana Gomez')

      // Now let the deferred getDoctors() call resolve.
      deferredDoctors.resolve([mockDoctor])
      await waitFor(() => expect(screen.getAllByRole('combobox')[0]).not.toBeDisabled())

      // The pre-settle interactions must have survived — this is exactly
      // what the ref-gated reset (keyed on appointment?.id ?? 'new') fixes.
      expect(screen.getByTestId('selected-patient')).toHaveTextContent('Ana Gomez')
      expect(getItemCheckbox('Item A')).toBeChecked()
    })
  })

  // Guards against over-suppressing the reset: it must still fire when the
  // modal is re-opened for a genuinely different appointment.
  describe('regression: re-opening for a different appointment', () => {
    it('still resets the form to the new appointment values', async () => {
      listBudgetsByPatientMock.mockResolvedValue({ data: [], total: 0 })
      getAppointmentBudgetItemsMock.mockResolvedValue([])
      getDoctorsMock.mockResolvedValue([mockDoctor, mockDoctor2])

      const firstAppointment = makeAppointment({
        id: 'apt-1',
        patientId: 'patient-1',
        doctorId: 'doc-1',
        notes: 'First note',
      })
      const secondAppointment = makeAppointment({
        id: 'apt-2',
        patientId: 'patient-2',
        doctorId: 'doc-2',
        notes: 'Second note',
      })

      const onClose = vi.fn()
      const onSubmit = vi.fn().mockResolvedValue(undefined)
      const { rerender } = render(
        <AppointmentFormModal isOpen onClose={onClose} onSubmit={onSubmit} appointment={firstAppointment} />
      )
      await waitForOptionsLoaded()
      await waitFor(() => expect(screen.getByDisplayValue('First note')).toBeInTheDocument())

      // Close the modal, then re-open it for a different appointment.
      rerender(
        <AppointmentFormModal isOpen={false} onClose={onClose} onSubmit={onSubmit} appointment={firstAppointment} />
      )
      rerender(
        <AppointmentFormModal isOpen onClose={onClose} onSubmit={onSubmit} appointment={secondAppointment} />
      )
      await waitForOptionsLoaded()

      await waitFor(() => expect(screen.getByDisplayValue('Second note')).toBeInTheDocument())
      expect(screen.queryByDisplayValue('First note')).not.toBeInTheDocument()
      expect((screen.getAllByRole('combobox')[0] as HTMLSelectElement).value).toBe('doc-2')
    })
  })

  // Regression coverage for a cold edit-mount race (now FIXED).
  //
  // The identity-gated reset effect no longer waits for `!loadingOptions`, so
  // on a cold mount in edit mode `reset({ doctorId: appointment.doctorId, ... })`
  // runs on the first render — before getDoctors() has resolved and before the
  // <option value="doc-1"> exists in the DOM. react-hook-form imperatively sets
  // the <select>.value at that moment; with no matching <option> yet the browser
  // drops the selection to ''. Without a fix nothing would re-apply it once the
  // doctors list arrives, silently losing the required `doctorId`.
  //
  // FIX (AppointmentFormModal.tsx): a dedicated effect re-applies ONLY
  // `doctorId` from `appointment.doctorId` once doctors finish loading, but only
  // when the user hasn't manually changed it (`!dirtyFields.doctorId`). The test
  // below asserts that fixed behavior — do NOT remove that effect.
  describe('regression: doctor pre-selection on a cold edit-mode mount', () => {
    it('should show the appointment\'s assigned doctor once getDoctors() resolves, even though reset() ran before it did', async () => {
      listBudgetsByPatientMock.mockResolvedValue({ data: [], total: 0 })
      getAppointmentBudgetItemsMock.mockResolvedValue([])

      const deferredDoctors = createDeferred<typeof mockDoctor[]>()
      getDoctorsMock.mockReturnValue(deferredDoctors.promise)

      const appointment = makeAppointment({ id: 'apt-1', patientId: 'patient-1', doctorId: 'doc-1' })
      renderModal({ appointment })

      deferredDoctors.resolve([mockDoctor, mockDoctor2])
      await waitForOptionsLoaded()

      // Expected: the previously-assigned doctor is shown pre-selected.
      // Actual (current code): the select is left on '' ("Seleccionar
      // doctor..."), forcing the user to manually re-pick the doctor before
      // they can save the edit (doctorId is a required field).
      //
      // Waited for directly (not asserted synchronously right after
      // waitForOptionsLoaded): the doctor <select>'s `disabled` attribute
      // clears as soon as `loadingOptions` flips to false, but the dedicated
      // effect that re-applies `doctorId` (AppointmentFormModal.tsx, keyed on
      // that same `loadingOptions` flip) is a separate passive effect that
      // commits in its own flush. Reading the value synchronously right after
      // the select becomes enabled is a race against that effect landing;
      // waiting for the value itself waits for the behavior this test
      // actually guards, not a proxy for it.
      await waitFor(() => {
        expect((screen.getAllByRole('combobox')[0] as HTMLSelectElement).value).toBe('doc-1')
      })
    })
  })
})

// Coverage for task #233 (date/time picker UI migration) and task #347
// (custom TimePicker UI): the date field moved from a native
// <input type="date"> to a button-triggered <DatePicker> popover, and the
// time fields moved from native <input type="time">s to a fully custom,
// button-triggered <TimePicker> listbox popover (no native input at all —
// see TimePicker.test.tsx for the component's own suite). These tests drive
// the *new* widgets directly and assert the exact same submit payload shape
// the old native inputs produced (date=YYYY-MM-DD combined with
// startTime/endTime=HH:mm into ISO instants).
describe('AppointmentFormModal — date/time picker migration (task #233)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getDoctorsMock.mockResolvedValue([mockDoctor])
    getPatientsMock.mockResolvedValue([mockPatientRecord])
    listBudgetsByPatientMock.mockResolvedValue({ data: [], total: 0 })
    getAppointmentBudgetItemsMock.mockResolvedValue([])
  })

  // The DatePicker's trigger button carries a fixed aria-label
  // (t('appointments.form.date') = "Fecha"), independent of the currently
  // displayed date text, so it's reliably queryable by name.
  function getDateTrigger() {
    return screen.getByRole('button', { name: 'Fecha' })
  }

  // The TimePicker trigger <button> exposes role="combobox" (task #347: the
  // APG select-only-combobox pattern, sanctioned for a <button> in ARIA-in-HTML
  // — see TimePicker.test.tsx). The doctor <select> also computes to role
  // "combobox", but its accessible name is "Doctor"
  // (t('appointments.form.doctor')), so these name-scoped queries for "Hora de
  // inicio" / "Hora de fin" stay unambiguous.
  function getTimeTriggers() {
    return [
      screen.getByRole('combobox', { name: 'Hora de inicio' }),
      screen.getByRole('combobox', { name: 'Hora de fin' }),
    ]
  }

  // Opens a TimePicker's popover and clicks the option matching the given
  // 'HH:mm' value. Only one TimePicker popover is ever open at a time (each
  // selection closes its own popover), so this is safe to call sequentially
  // for the start and end fields.
  function selectTime(trigger: HTMLElement, hhmm: string) {
    fireEvent.click(trigger)
    const option = screen.getAllByRole('option').find((el) => el.textContent === hhmm)
    if (!option) throw new Error(`No TimePicker option found for "${hhmm}"`)
    fireEvent.click(option)
  }

  // Picks a day within the month the DatePicker opens on by default. With no
  // date selected yet, DatePicker.tsx passes `defaultMonth={undefined}` to
  // react-day-picker, which then falls back to the *current* system month —
  // so a hardcoded 'julio de 2026' day button is a time bomb that only
  // exists in the DOM while the real clock is in/near July 2026. Computing
  // the target day relative to `new Date()` keeps this test valid at any
  // run date. Day "1" (or "2" if today itself is the 1st) is always part of
  // the currently displayed month and, by construction, is never "today" —
  // avoiding the "Hoy, " prefix the es locale's `labelDayButton` adds to
  // today's own aria-label (see react-day-picker's `locale/es.js`).
  function pickCalendarDay() {
    const today = new Date()
    const day = today.getDate() === 1 ? 2 : 1
    const date = new Date(today.getFullYear(), today.getMonth(), day)
    // Mirrors react-day-picker's es locale day-button aria-label, which
    // formats with date-fns' "PPPP" token — e.g. "viernes, 10 de julio de
    // 2026". Verified to match date-fns' es output exactly.
    const label = new Intl.DateTimeFormat('es', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(date)
    return { date, isoDate: formatDateForInputHelper(date), label }
  }

  it('renders the date field as a button-triggered popover, not a native date input', async () => {
    renderModal()
    await waitForOptionsLoaded()

    expect(document.querySelector('input[type="date"]')).not.toBeInTheDocument()
    expect(getDateTrigger()).toHaveAttribute('aria-haspopup', 'dialog')
  })

  it('submits the exact date selected via the DatePicker popover', async () => {
    const { onSubmit } = renderModal()
    await waitForOptionsLoaded()
    fireEvent.click(screen.getByRole('button', { name: 'Select Ana' }))
    await selectDoctor()

    const { isoDate, label } = pickCalendarDay()
    fireEvent.click(getDateTrigger())
    fireEvent.click(screen.getByRole('button', { name: label }))

    fireEvent.click(screen.getByRole('button', { name: /crear cita/i }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    const payload = onSubmit.mock.calls[0][0]
    expect(payload.startTime).toBe(new Date(`${isoDate}T09:00:00`).toISOString())
    expect(payload.endTime).toBe(new Date(`${isoDate}T09:30:00`).toISOString())
  })

  it('closes the DatePicker popover after selecting a day (no leftover open grid)', async () => {
    renderModal()
    await waitForOptionsLoaded()

    fireEvent.click(getDateTrigger())
    expect(screen.getByRole('grid')).toBeInTheDocument()

    const { label } = pickCalendarDay()
    fireEvent.click(screen.getByRole('button', { name: label }))
    expect(screen.queryByRole('grid')).not.toBeInTheDocument()
  })

  it('submits times selected via the TimePicker popovers', async () => {
    const { onSubmit } = renderModal()
    await waitForOptionsLoaded()
    fireEvent.click(screen.getByRole('button', { name: 'Select Ana' }))
    await selectDoctor()

    const [startTrigger, endTrigger] = getTimeTriggers()
    selectTime(startTrigger, '14:15')
    selectTime(endTrigger, '15:00')

    fireEvent.click(screen.getByRole('button', { name: /crear cita/i }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    const payload = onSubmit.mock.calls[0][0]
    const submittedDate = new Date(payload.startTime as string)
    const expectedDate = formatDateForInputHelper(new Date())
    expect(formatDateForInputHelper(submittedDate)).toBe(expectedDate)
    expect(payload.startTime).toBe(new Date(`${expectedDate}T14:15:00`).toISOString())
    expect(payload.endTime).toBe(new Date(`${expectedDate}T15:00:00`).toISOString())
  })

  it('shows the "end time after start time" validation error when the TimePicker end value precedes start', async () => {
    renderModal()
    await waitForOptionsLoaded()
    fireEvent.click(screen.getByRole('button', { name: 'Select Ana' }))
    await selectDoctor()

    const [startTrigger, endTrigger] = getTimeTriggers()
    selectTime(startTrigger, '10:00')
    selectTime(endTrigger, '09:00')

    fireEvent.click(screen.getByRole('button', { name: /crear cita/i }))

    await waitFor(() =>
      expect(screen.getByText('La hora de fin debe ser posterior a la hora de inicio')).toBeInTheDocument()
    )
  })

  it('renders the time fields as button-triggered listbox popovers, not native time inputs', async () => {
    renderModal()
    await waitForOptionsLoaded()

    expect(document.querySelector('input[type="time"]')).not.toBeInTheDocument()
    const [startTrigger, endTrigger] = getTimeTriggers()
    expect(startTrigger).toHaveAttribute('aria-haspopup', 'listbox')
    expect(endTrigger).toHaveAttribute('aria-haspopup', 'listbox')
  })
})

// Local helper mirroring lib/format.ts's formatDateForInput (kept separate so
// the test doesn't depend on module-internal formatting behavior changing
// silently — it only needs the plain YYYY-MM-DD shape "today" produces).
function formatDateForInputHelper(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
