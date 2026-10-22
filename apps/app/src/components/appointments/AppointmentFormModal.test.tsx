import type { ComponentProps } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest'
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

// Task #239: the modal reads `settings` / `fetchSettings` off the settings
// store via selectors (`useSettingsStore((s) => s.settings)`), unlike the
// destructured `useSettingsStore()` call used elsewhere in the app — so the
// mock below must actually apply the selector against a controllable state
// object rather than just returning a fixed value regardless of the
// selector passed in (mirrors the useAuthStore mock above).
const settingsStoreState: {
  settings: {
    appointmentTypeDurations: { type: string; duration: number }[]
    defaultAppointmentDuration: number
  } | null
  fetchSettings: () => Promise<void>
} = {
  settings: null,
  fetchSettings: vi.fn(),
}

vi.mock('../../stores/settings.store', () => ({
  useSettingsStore: (selector: (s: typeof settingsStoreState) => unknown) =>
    selector(settingsStoreState),
}))

// Reset the settings-store mock before every test in this file so a value
// set by one describe block's tests can never leak into another's.
beforeEach(() => {
  settingsStoreState.settings = null
  settingsStoreState.fetchSettings = vi.fn()
})

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

// Every edit-mode render of an appointment without `budgetItems` fetches the
// full record (task #544). Suites that do not care default to "fetched fine,
// nothing executed"; the #544 suite below overrides this per case.
beforeEach(() => {
  getAppointmentByIdMock.mockReset()
  getAppointmentByIdMock.mockImplementation(() => Promise.resolve(makeAppointment()))
})

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
    // All four read paths always populate these (attachRecordedPayments runs
    // unconditionally — see appointment.service.ts), so the realistic default
    // is "no linked payment", not "field absent". A test that needs a
    // recorded payment must opt in explicitly via overrides.
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

// Task #246: the doctor field moved from a native <select> to the
// DoctorPicker combobox (a text <input role="combobox">, associated to its
// <label> via htmlFor/id — see AppointmentFormModal.tsx).
//
// A loose `getByLabelText(/doctor/i)` looked like the obvious replacement
// for the old positional `getAllByRole('combobox')[0]` query, but it is
// ambiguous in practice: once a doctor is selected, DoctorPicker's own clear
// button carries `aria-label={t('doctorPicker.clear')}` = "Quitar doctor" —
// which also matches /doctor/i and throws "Found multiple elements" (RTL
// treats any element with a matching aria-label as a label-text candidate,
// not just <label> elements — confirmed by reproducing this exact failure
// while writing this suite). The exact label text ("Doctor *", from
// `{t('appointments.form.doctor')} *`, fixed since the whole suite pins
// i18n to 'es' in beforeAll) is unambiguous: no other element's accessible
// name equals it verbatim.
function getDoctorPickerInput() {
  return screen.getByLabelText('Doctor *') as HTMLInputElement
}

async function waitForOptionsLoaded() {
  // The modal's form-reset effect re-runs whenever `loadingOptions` flips
  // (pre-existing behavior, unrelated to budget items), which re-applies the
  // default values and would clobber a patient selected while doctors are
  // still loading. Waiting for the doctor picker to become enabled
  // (DoctorPicker's `loading` prop is wired straight to `loadingOptions`)
  // ensures that settling has already happened before a test interacts with
  // the form.
  await waitFor(() => {
    expect(getDoctorPickerInput()).not.toBeDisabled()
  })
}

// Opens the DoctorPicker's list (focus shows the full list with nothing
// typed) and clicks the option matching `name` by its rendered label
// ("First Last" or "First Last (Specialty)" — see formatDoctorLabel in
// DoctorPicker.tsx). Defaults to the fixture's only doctor in most tests.
async function selectDoctor(name = 'Carlos Ruiz') {
  await waitForOptionsLoaded()
  const input = getDoctorPickerInput()
  fireEvent.focus(input)
  fireEvent.click(screen.getByRole('option', { name }))
}

// The form lists one checkbox per budget item row, so budget item checkboxes
// must be scoped to their row (found via the item's description text) rather
// than queried globally — a global query would be ambiguous whenever more
// than one item is rendered.
function getItemCheckbox(description: string) {
  const row = screen.getByText(description).closest('label')
  if (!row) throw new Error(`No row found for "${description}"`)
  return within(row).getByRole('checkbox')
}

// Opens a TimePicker's popover and clicks the option matching the given
// 'HH:mm' value. Only one TimePicker popover is ever open at a time (each
// selection closes its own popover), so this is safe to call sequentially
// for the start and end fields.
//
// A role query here (`getAllByRole('option')`, scoped or not) is the real
// cost, independent of tree size: dom-testing-library's byRole matcher runs
// an `isInaccessible` visibility check per candidate that walks the DOM
// ancestor chain with `getComputedStyle` at every level, all the way up to
// the true document root — `within(popover)` only narrows which nodes are
// considered candidates, it can't shorten that walk. Measured on this
// component (task #398): ~66ms/call for a full-document role query, ~55ms/
// call scoped to the popover (~96 <li role="option"> slots) — barely
// different, because each of those ~96 candidates pays the same ancestor
// walk either way. A scoped text match instead (`within(popover).getByText`)
// skips the accessibility-tree computation entirely: ~0.6ms/call, ~100x
// faster than either role query. Each option <li> has no other rendered
// descendants, so its exact text is unambiguous within the popover.
function selectTime(trigger: HTMLElement, hhmm: string) {
  fireEvent.click(trigger)
  const popover = trigger.parentElement as HTMLElement
  fireEvent.click(within(popover).getByText(hhmm))
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
    it('lists PENDING items plus this appointment\'s own linked items, from non-CANCELLED budgets', async () => {
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

      // Create mode (no `appointment` prop): there is no "own appointment" to
      // be linked to, so only the globally PENDING item is eligible — a
      // SCHEDULED item is scheduled into some *other* appointment and must
      // not be offered here (this is the defect the task fixes).
      renderModal()
      await waitForOptionsLoaded()
      fireEvent.click(screen.getByRole('button', { name: 'Select Ana' }))

      await waitFor(() => expect(screen.getByText('Item Pending')).toBeInTheDocument())

      expect(screen.queryByText('Item Scheduled')).not.toBeInTheDocument()
      expect(screen.queryByText('Item Executed')).not.toBeInTheDocument()
      expect(screen.queryByText('Item CancelledStatus')).not.toBeInTheDocument()
      expect(screen.queryByText('Item In Cancelled Budget')).not.toBeInTheDocument()
    })
  })

  describe('budget status filtering (#602)', () => {
    const draftHint = () => i18n.t('appointments.budgetItems.draftHint')

    async function openWithApprovedAndDraft() {
      const approved = makeBudget({
        id: 'budget-approved',
        status: 'APPROVED',
        items: [makeBudgetItem({ id: 'item-approved', description: 'Item Approved Budget', status: 'PENDING' })],
      })
      const draft = makeBudget({
        id: 'budget-draft',
        status: 'DRAFT',
        items: [makeBudgetItem({ id: 'item-draft', description: 'Item Draft Budget', status: 'PENDING' })],
      })
      listBudgetsByPatientMock.mockResolvedValue({ data: [approved, draft], total: 2 })

      renderModal()
      await waitForOptionsLoaded()
      fireEvent.click(screen.getByRole('button', { name: 'Select Ana' }))
      // The approved budget of the same patient is listed: the assertions
      // below cannot be satisfied by an empty list.
      await waitFor(() => expect(screen.getByText('Item Approved Budget')).toBeInTheDocument())
    }

    it('omits PENDING items of a DRAFT budget while the APPROVED budget of the same patient still lists', async () => {
      await openWithApprovedAndDraft()

      expect(screen.queryByText('Item Draft Budget')).not.toBeInTheDocument()
    })

    it('says why the DRAFT budget items are missing (draftHint)', async () => {
      await openWithApprovedAndDraft()

      expect(draftHint()).not.toBe('appointments.budgetItems.draftHint')
      expect(screen.getByText(draftHint())).toBeInTheDocument()
    })

    it('lists PENDING items of a PARTIAL budget', async () => {
      const partial = makeBudget({
        id: 'budget-partial',
        status: 'PARTIAL',
        items: [makeBudgetItem({ id: 'item-partial', description: 'Item Partial Budget', status: 'PENDING' })],
      })
      listBudgetsByPatientMock.mockResolvedValue({ data: [partial], total: 1 })

      renderModal()
      await waitForOptionsLoaded()
      fireEvent.click(screen.getByRole('button', { name: 'Select Ana' }))

      await waitFor(() => expect(screen.getByText('Item Partial Budget')).toBeInTheDocument())
      expect(screen.queryByText(draftHint())).not.toBeInTheDocument()
    })

    it('shows no draft hint when there are no DRAFT budgets', async () => {
      const approved = makeBudget({
        status: 'APPROVED',
        items: [makeBudgetItem({ id: 'item-a', description: 'Item A', status: 'PENDING' })],
      })
      listBudgetsByPatientMock.mockResolvedValue({ data: [approved], total: 1 })

      renderModal()
      await waitForOptionsLoaded()
      fireEvent.click(screen.getByRole('button', { name: 'Select Ana' }))

      await waitFor(() => expect(screen.getByText('Item A')).toBeInTheDocument())
      expect(screen.queryByText(draftHint())).not.toBeInTheDocument()
    })

    it('keeps an item already linked to this appointment visible on a DRAFT budget, so it can be unchecked', async () => {
      const draft = makeBudget({
        id: 'budget-draft',
        status: 'DRAFT',
        items: [makeBudgetItem({ id: 'item-linked', description: 'Item Linked Draft', status: 'SCHEDULED' })],
      })
      listBudgetsByPatientMock.mockResolvedValue({ data: [draft], total: 1 })
      getAppointmentBudgetItemsMock.mockResolvedValue([
        makeAssociatedItem({ id: 'item-linked', budgetId: 'budget-draft', description: 'Item Linked Draft', status: 'SCHEDULED' }),
      ])

      renderModal({ appointment: makeAppointment() })

      await waitFor(() => expect(screen.getByText('Item Linked Draft')).toBeInTheDocument())
      expect(getItemCheckbox('Item Linked Draft')).toBeChecked()
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

  // Task #361: the eligibility filter and the EXECUTED lock, exercised
  // together in edit mode against a mix of PENDING / elsewhere-SCHEDULED /
  // this-appointment-SCHEDULED / this-appointment-EXECUTED items.
  describe('eligible item filtering — editing mode & EXECUTED lock (task #361)', () => {
    it('offers PENDING and this appointment\'s own linked items, hides an item SCHEDULED elsewhere, and locks the EXECUTED one checked+disabled', async () => {
      const budget = makeBudget({
        items: [
          makeBudgetItem({ id: 'item-pending', description: 'Item Pending', status: 'PENDING' }),
          makeBudgetItem({ id: 'item-elsewhere', description: 'Item Scheduled Elsewhere', status: 'SCHEDULED' }),
          makeBudgetItem({ id: 'item-scheduled-here', description: 'Item Scheduled Here', status: 'SCHEDULED' }),
          makeBudgetItem({ id: 'item-executed-here', description: 'Item Executed Here', status: 'EXECUTED' }),
        ],
      })
      listBudgetsByPatientMock.mockResolvedValue({ data: [budget], total: 1 })
      getAppointmentBudgetItemsMock.mockResolvedValue([
        makeAssociatedItem({ id: 'item-scheduled-here', status: 'SCHEDULED', roles: ['SCHEDULED'] }),
        makeAssociatedItem({ id: 'item-executed-here', status: 'EXECUTED', roles: ['EXECUTED'] }),
      ])

      const appointment = makeAppointment()
      renderModal({ appointment })
      await waitForOptionsLoaded()

      await waitFor(() => expect(screen.getByText('Item Pending')).toBeInTheDocument())

      // A PENDING item is offered, unchecked.
      expect(getItemCheckbox('Item Pending')).not.toBeChecked()

      // An item SCHEDULED into some *other* appointment is not offered at all.
      expect(screen.queryByText('Item Scheduled Elsewhere')).not.toBeInTheDocument()

      // This appointment's own SCHEDULED item is offered, pre-checked, and
      // still a live toggle (not disabled).
      await waitFor(() => expect(getItemCheckbox('Item Scheduled Here')).toBeChecked())
      expect(getItemCheckbox('Item Scheduled Here')).not.toBeDisabled()

      // This appointment's own EXECUTED item is offered, checked, disabled,
      // and badged "Ya ejecutado" instead of the normal status label.
      const executedCheckbox = getItemCheckbox('Item Executed Here')
      expect(executedCheckbox).toBeChecked()
      expect(executedCheckbox).toBeDisabled()
      const executedRow = screen.getByText('Item Executed Here').closest('label')
      expect(executedRow).not.toBeNull()
      expect(within(executedRow!).getByText('Ya ejecutado')).toBeInTheDocument()

      // Clicking the disabled EXECUTED checkbox must not toggle it off.
      fireEvent.click(executedCheckbox)
      expect(executedCheckbox).toBeChecked()
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

      // getDoctors() has not resolved yet: the doctor picker is disabled.
      expect(getDoctorPickerInput()).toBeDisabled()

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
      await waitFor(() => expect(getDoctorPickerInput()).not.toBeDisabled())

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
      // doc-2 (Diana Perez) is in the resolved doctors list, so this reflects
      // the doctors-list branch, not fallback — the fallback branch is
      // covered separately below.
      expect(getDoctorPickerInput().value).toBe('Diana Perez')
    })
  })

  // Regression coverage for a cold edit-mount race (task #246 rewrite).
  //
  // History: with the old native <select>, react-hook-form's identity-gated
  // reset effect ran `reset({ doctorId: appointment.doctorId, ... })` on the
  // first render — before getDoctors() resolved and before
  // <option value="doc-1"> existed in the DOM — so the browser dropped the
  // selection to ''. That was fixed (PR history) with a dedicated
  // re-apply-once-doctors-load effect.
  //
  // Task #246 removes that effect entirely: DoctorPicker is presentational
  // and derives its displayed label from `value` + `doctors`/`fallback` on
  // every render (an "adjust state during render" pattern, not a
  // post-commit effect — see DoctorPicker.tsx), and AppointmentFormModal
  // passes `fallback={appointment?.doctor}`. The implementer's claim is that
  // this makes the cold mount work *before* getDoctors() even resolves,
  // because `fallback` covers the gap. The two tests below check that claim
  // directly instead of trusting it: the first asserts the label is already
  // correct while getDoctors() is still pending (fallback-sourced), the
  // second asserts it survives the switch to the doctors-sourced label once
  // the request resolves.
  describe('regression: doctor pre-selection on a cold edit-mode mount (task #246)', () => {
    it("shows the appointment's assigned doctor via `fallback` before getDoctors() resolves", async () => {
      listBudgetsByPatientMock.mockResolvedValue({ data: [], total: 0 })
      getAppointmentBudgetItemsMock.mockResolvedValue([])

      const deferredDoctors = createDeferred<typeof mockDoctor[]>()
      getDoctorsMock.mockReturnValue(deferredDoctors.promise)

      const appointment = makeAppointment({
        id: 'apt-1',
        patientId: 'patient-1',
        doctorId: 'doc-1',
        doctor: { id: 'doc-1', firstName: 'Carlos', lastName: 'Ruiz', specialty: null, email: null },
      })
      renderModal({ appointment })

      // getDoctors() has deliberately NOT been resolved yet: `doctors` is
      // still `[]` in the modal's state, so the only possible source for
      // this label is the `fallback` prop. A picker that ignores `fallback`
      // (recreating the native-<select> drop behavior) would leave this
      // blank instead.
      await waitFor(() => expect(getDoctorPickerInput().value).toBe('Carlos Ruiz'))
      // The field is still locked (loadingOptions still true) at this point —
      // the label being visible doesn't imply the request has settled yet.
      expect(getDoctorPickerInput()).toBeDisabled()
    })

    it("keeps showing the appointment's assigned doctor once getDoctors() resolves (now sourced from the doctors list instead of fallback)", async () => {
      listBudgetsByPatientMock.mockResolvedValue({ data: [], total: 0 })
      getAppointmentBudgetItemsMock.mockResolvedValue([])

      const deferredDoctors = createDeferred<typeof mockDoctor[]>()
      getDoctorsMock.mockReturnValue(deferredDoctors.promise)

      const appointment = makeAppointment({
        id: 'apt-1',
        patientId: 'patient-1',
        doctorId: 'doc-1',
        doctor: { id: 'doc-1', firstName: 'Carlos', lastName: 'Ruiz', specialty: null, email: null },
      })
      renderModal({ appointment })

      deferredDoctors.resolve([mockDoctor, mockDoctor2])
      await waitForOptionsLoaded()

      await waitFor(() => expect(getDoctorPickerInput().value).toBe('Carlos Ruiz'))
    })
  })

  // Companion regression: the doctor assigned to an appointment can be
  // *inactive* (excluded from getDoctors(), which only lists active
  // doctors) — this is the scenario `fallback` exists for specifically, as
  // opposed to the merely-still-loading race covered above.
  describe('regression: inactive doctor shown via fallback on edit (task #246)', () => {
    it("keeps showing the appointment's doctor even though it never appears in getDoctors()'s (active-only) result", async () => {
      listBudgetsByPatientMock.mockResolvedValue({ data: [], total: 0 })
      getAppointmentBudgetItemsMock.mockResolvedValue([])
      // The active doctors list never includes doc-1 at all — not even
      // eventually — unlike the cold-mount race above.
      getDoctorsMock.mockResolvedValue([mockDoctor2])

      const appointment = makeAppointment({
        id: 'apt-1',
        patientId: 'patient-1',
        doctorId: 'doc-1',
        doctor: { id: 'doc-1', firstName: 'Carlos', lastName: 'Ruiz', specialty: null, email: null },
      })
      renderModal({ appointment })
      await waitForOptionsLoaded()

      expect(getDoctorPickerInput().value).toBe('Carlos Ruiz')
    })
  })
})

// Task #246: doctorId is a required field (appointmentFormSchemaInput), now
// selected through DoctorPicker instead of a native <select>.
describe('AppointmentFormModal — doctor selection requirement (task #246)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getDoctorsMock.mockResolvedValue([mockDoctor])
    getPatientsMock.mockResolvedValue([mockPatientRecord])
    listBudgetsByPatientMock.mockResolvedValue({ data: [], total: 0 })
    getAppointmentBudgetItemsMock.mockResolvedValue([])
  })

  it('blocks create submit with a validation error when no doctor is chosen', async () => {
    const { onSubmit } = renderModal()
    await waitForOptionsLoaded()
    fireEvent.click(screen.getByRole('button', { name: 'Select Ana' }))

    fireEvent.click(screen.getByRole('button', { name: /crear cita/i }))

    await waitFor(() => expect(screen.getByText('El doctor es requerido')).toBeInTheDocument())
    expect(onSubmit).not.toHaveBeenCalled()
  })

  // toStrictEqual (not toHaveBeenCalledWith/toEqual/toMatchObject) on the
  // isolated field: those matchers can't tell a genuinely-present key from
  // one that merely reads as `undefined`, which matters directly here since
  // several other fields on this same payload (paidAmount, budgetItemIds)
  // are legitimately sent as `undefined` in other flows — doctorId must
  // actually be the string, not just "not strictly absent".
  it('submits the exact chosen doctorId when creating an appointment', async () => {
    const { onSubmit } = renderModal()
    await waitForOptionsLoaded()
    fireEvent.click(screen.getByRole('button', { name: 'Select Ana' }))
    await selectDoctor('Carlos Ruiz')

    fireEvent.click(screen.getByRole('button', { name: /crear cita/i }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    const payload = onSubmit.mock.calls[0][0] as { doctorId?: string }
    expect({ doctorId: payload.doctorId }).toStrictEqual({ doctorId: 'doc-1' })
  })

  it('submits the exact chosen doctorId when editing and changing the doctor', async () => {
    getDoctorsMock.mockResolvedValue([mockDoctor, mockDoctor2])
    const appointment = makeAppointment({ id: 'apt-1', patientId: 'patient-1', doctorId: 'doc-1' })
    const { onSubmit } = renderModal({ appointment })
    await waitForOptionsLoaded()

    await selectDoctor('Diana Perez')
    fireEvent.click(screen.getByRole('button', { name: /guardar cambios/i }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    const payload = onSubmit.mock.calls[0][0] as { doctorId?: string }
    expect({ doctorId: payload.doctorId }).toStrictEqual({ doctorId: 'doc-2' })
  })
})

// Coverage for task #373: the old "Pagado" checkbox was replaced with a
// numeric "Monto abonado" ($) input, empty by default when creating/editing
// an unpaid appointment, and disabled (prefilled with the recorded amount)
// once a payment has actually been recorded (isPaid / recordedPaidAmount
// derived from FIFO — see appointment.service.ts).
const PAID_AMOUNT_LABEL = 'Monto abonado ($)'

function getPaidAmountInput() {
  const label = screen.getByText(PAID_AMOUNT_LABEL)
  const container = label.parentElement
  if (!container) throw new Error('No paidAmount container found')
  return within(container).getByRole('spinbutton')
}

describe('AppointmentFormModal — paidAmount input (task #373)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getDoctorsMock.mockResolvedValue([mockDoctor])
    getPatientsMock.mockResolvedValue([mockPatientRecord])
    listBudgetsByPatientMock.mockResolvedValue({ data: [], total: 0 })
    getAppointmentBudgetItemsMock.mockResolvedValue([])
  })

  it('is empty and enabled when creating a new appointment', async () => {
    renderModal()
    await waitForOptionsLoaded()

    const input = getPaidAmountInput() as HTMLInputElement
    expect(input.value).toBe('')
    expect(input).not.toBeDisabled()
  })

  // Design-change coverage (fix cycle 3, #373): prefilling from `cost`
  // conflated "what this visit costs" with "what was paid today" — a
  // routine reschedule of an unpaid appointment would silently submit a
  // full-cost payment because RHF passes an untouched registered default
  // straight through on submit. The field now starts empty in every case
  // except a locked (already-recorded) read-only display.
  it('starts empty and stays enabled when editing an unpaid appointment (no recorded payment)', async () => {
    const appointment = makeAppointment({ cost: 150, isPaid: false })
    renderModal({ appointment })
    await waitForOptionsLoaded()

    const input = getPaidAmountInput() as HTMLInputElement
    // Give any (incorrect) async prefill effect a chance to land before
    // asserting the negative — waitFor alone would pass instantly on an
    // already-empty value without ever having watched for a stray write.
    await waitFor(() => expect(getDoctorPickerInput()).not.toBeDisabled())
    expect(input.value).toBe('')
    expect(input.value).not.toBe('150')
    expect(input).not.toBeDisabled()
    expect(screen.getByText('Se cobra en esta cita y cubre primero su costo; solo lo que exceda ese costo pasa al saldo restante del paciente.')).toBeInTheDocument()
  })

  // Core regression test for the design change: with the old `cost` prefill,
  // rescheduling an unpaid appointment without ever touching the paid-amount
  // field would still submit `paidAmount: cost` (RHF passes through the
  // untouched registered default), silently charging the patient — the #373
  // round-3 critical. Pins that no default means nothing gets sent.
  it('omits paidAmount from the submit payload when editing/rescheduling an unpaid appointment without touching the field', async () => {
    const appointment = makeAppointment({
      cost: 150,
      isPaid: false,
      hasRecordedPayment: false,
      recordedPaidAmount: 0,
      notes: 'Original notes',
    })
    const { onSubmit } = renderModal({ appointment })
    await waitForOptionsLoaded()

    // Confirm the field really is untouched/empty before submitting, so a
    // failure here can't be misread as "field had a value but it got
    // stripped" — the payload assertion below is about the field never being
    // populated in the first place.
    const input = getPaidAmountInput() as HTMLInputElement
    expect(input.value).toBe('')

    // Change something unrelated (simulating a reschedule/notes edit) and
    // submit without ever interacting with the paid-amount field.
    fireEvent.change(screen.getByPlaceholderText('Notas adicionales sobre la cita...'), {
      target: { value: 'Rescheduled to next week' },
    })
    fireEvent.click(screen.getByRole('button', { name: /guardar cambios/i }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    const payload = onSubmit.mock.calls[0][0] as { paidAmount?: number; notes?: string }
    expect(payload.paidAmount).toBeUndefined()
    expect(payload.notes).toBe('Rescheduled to next week')
  })

  it('shows the recorded paidAmount (not cost) and is disabled when editing an already-paid appointment', async () => {
    const appointment = makeAppointment({
      cost: 150,
      isPaid: true,
      hasRecordedPayment: true,
      recordedPaidAmount: 150,
    })
    renderModal({ appointment })
    await waitForOptionsLoaded()

    const input = getPaidAmountInput() as HTMLInputElement
    await waitFor(() => expect(input.value).toBe('150'))
    expect(input).toBeDisabled()
    expect(screen.getByText('Para revertir el pago, elimine la entrega correspondiente desde la sección de pagos.')).toBeInTheDocument()
  })

  it('stays editable and blank when isPaid is true but no consultation payment is recorded (#523)', async () => {
    // isPaid is FIFO-owned: after a reversal the patient's advances can cover
    // the item. Nothing was charged here, so there is nothing to lock.
    const appointment = makeAppointment({
      cost: 150,
      isPaid: true,
      hasRecordedPayment: false,
      recordedPaidAmount: 0,
    })
    renderModal({ appointment })
    await waitForOptionsLoaded()

    const input = getPaidAmountInput() as HTMLInputElement
    await waitFor(() => expect(getDoctorPickerInput()).not.toBeDisabled())
    expect(input.value).toBe('')
    expect(input).not.toBeDisabled()
    expect(screen.getByText(/cubierta por el saldo del paciente/)).toBeInTheDocument()
    expect(screen.queryByText(/Para revertir el pago/)).not.toBeInTheDocument()
  })

  it('stays empty and editable when editing an isPaid appointment with recordedPaidAmount entirely absent from the response', async () => {
    // Distinct from the "0" case above: an appointment payload that omits
    // recordedPaidAmount altogether (undefined, not 0) renders the field
    // truly blank, not "0" — and it must not fall back to `cost`.
    const appointment = makeAppointment({
      cost: 150,
      isPaid: true,
      hasRecordedPayment: false,
      recordedPaidAmount: undefined,
    })
    renderModal({ appointment })
    await waitForOptionsLoaded()

    const input = getPaidAmountInput() as HTMLInputElement
    await waitFor(() => expect(getDoctorPickerInput()).not.toBeDisabled())
    expect(input.value).toBe('')
    expect(input.value).not.toBe('150')
    expect(input).not.toBeDisabled()
  })

  // Task #523, the headline guard. isPaid is FIFO-owned. The state that
  // discriminates is isPaid === true WITH no recorded consultation payment —
  // reached only by: charge it, reverse it, then a later unrelated advance
  // makes FIFO mark the item paid. A "reverse, then edit" test alone passes
  // against the broken lock too (isPaid is false in that window), so step 3
  // is the one that must stay.
  it('walks charge -> reverse -> FIFO re-covers: locked, then editable, then STILL editable with the covered hint (#523)', async () => {
    const charged = makeAppointment({
      cost: 3000,
      isPaid: true,
      hasRecordedPayment: true,
      recordedPaidAmount: 3000,
    })
    const { rerender, onClose, onSubmit } = renderModal({ appointment: charged })
    await waitForOptionsLoaded()

    // Step 1: the consultation payment is live — locked, today's hint.
    expect(getPaidAmountInput()).toBeDisabled()
    expect(screen.getByText(/Para revertir el pago/)).toBeInTheDocument()

    // Step 2: reversed. Nothing recorded, FIFO has nothing to cover it with.
    const reversed = { ...charged, isPaid: false, hasRecordedPayment: false, recordedPaidAmount: 0 }
    rerender(<AppointmentFormModal isOpen onClose={onClose} onSubmit={onSubmit} appointment={reversed} />)
    await waitFor(() => expect(getPaidAmountInput()).not.toBeDisabled())

    // Step 3: an unrelated advance arrives; FIFO flips isPaid back to true
    // while the consultation payment stays reversed (hasRecordedPayment false).
    const recovered = { ...reversed, isPaid: true }
    expect(recovered.isPaid).toBe(true)
    expect(recovered.hasRecordedPayment).toBe(false)
    rerender(<AppointmentFormModal isOpen onClose={onClose} onSubmit={onSubmit} appointment={recovered} />)

    await waitFor(() => expect(screen.getByText(/cubierta por el saldo del paciente/)).toBeInTheDocument())
    expect(getPaidAmountInput()).not.toBeDisabled()
    expect(screen.queryByText(/Para revertir el pago/)).not.toBeInTheDocument()
  })

  it('submits a typed paidAmount for an isPaid appointment with no recorded consultation payment (#523)', async () => {
    const appointment = makeAppointment({
      cost: 3000,
      isPaid: true,
      hasRecordedPayment: false,
      recordedPaidAmount: 0,
    })
    const { onSubmit } = renderModal({ appointment })
    await waitForOptionsLoaded()

    fireEvent.change(getPaidAmountInput(), { target: { value: '1200' } })
    fireEvent.click(screen.getByRole('button', { name: /guardar cambios/i }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect((onSubmit.mock.calls[0][0] as { paidAmount?: number }).paidAmount).toBe(1200)
  })

  // Task #523: the hint is split by what is true, not by isPaid alone.
  // Covered-but-nothing-recorded must not tell her to reverse a payment that
  // does not exist; a live payment must not claim the balance covers it.
  it('shows the covered-by-balance hint, not the reverse-the-payment instruction, when isPaid with nothing recorded (#523)', async () => {
    renderModal({
      appointment: makeAppointment({ cost: 150, isPaid: true, hasRecordedPayment: false, recordedPaidAmount: 0 }),
    })
    await waitForOptionsLoaded()

    expect(
      screen.getByText(
        'Esta cita está cubierta por el saldo del paciente. No hay un pago de consulta registrado, así que el monto aún se puede editar.'
      )
    ).toBeInTheDocument()
    expect(screen.queryByText(/Para revertir el pago/)).not.toBeInTheDocument()
  })

  it('keeps the locked state and the reverse-the-payment hint, without the covered hint, when a consultation payment is live (#523 acceptance 4)', async () => {
    renderModal({
      appointment: makeAppointment({ cost: 150, isPaid: true, hasRecordedPayment: true, recordedPaidAmount: 150 }),
    })
    await waitForOptionsLoaded()

    expect(getPaidAmountInput()).toBeDisabled()
    expect(
      screen.getByText('Para revertir el pago, elimine la entrega correspondiente desde la sección de pagos.')
    ).toBeInTheDocument()
    expect(screen.queryByText(/cubierta por el saldo del paciente/)).not.toBeInTheDocument()
  })

  // Reviewer finding on PR #379: FIFO can record a payment against this
  // appointment (paidAmount > 0) without fully covering it — e.g. the pool
  // got applied to an older visit first — leaving isPaid false. The old
  // prefill (`cost` only) and the old hint (`alreadyPaidHint`, gated on
  // isPaid) both missed this case entirely.
  it('is prefilled from the recorded paidAmount (not cost) and disabled when paidAmount>0 but isPaid is false (#373 reviewer fix)', async () => {
    const appointment = makeAppointment({
      cost: 150,
      hasRecordedPayment: true,
      recordedPaidAmount: 40,
      isPaid: false,
    })
    renderModal({ appointment })
    await waitForOptionsLoaded()

    const input = getPaidAmountInput() as HTMLInputElement
    await waitFor(() => expect(input.value).toBe('40'))
    expect(input.value).not.toBe('150')
    expect(input).toBeDisabled()
    expect(
      screen.getByText('Ya hay un pago registrado para esta cita. Para modificarlo, edítelo desde la sección de pagos.')
    ).toBeInTheDocument()
  })

  // Reviewer finding on PR #379: the JSX `disabled` attribute previously used
  // on this input does NOT stop react-hook-form from submitting its value —
  // only `register(name, { disabled })` does. This test does not assert on
  // the input's `disabled` DOM attribute (that would just be re-testing RHF's
  // own bookkeeping, already covered above); it instead forces a DOM value
  // that diverges from the locked/prefilled one and inspects the actual
  // payload handed to `onSubmit`, which is what
  // `register('paidAmount', { disabled: paidAmountLocked })` is there to
  // protect — RHF omits a disabled field from submitted values entirely,
  // regardless of what the DOM element's live value says.
  it('never includes paidAmount in the submitted payload when locked, even if the DOM value is forced to differ (#373 reviewer fix)', async () => {
    const appointment = makeAppointment({
      id: 'apt-1',
      cost: 150,
      hasRecordedPayment: true,
      recordedPaidAmount: 40,
      isPaid: false,
    })
    const { onSubmit } = renderModal({ appointment })
    await waitForOptionsLoaded()

    const input = getPaidAmountInput() as HTMLInputElement
    await waitFor(() => expect(input.value).toBe('40'))

    fireEvent.change(input, { target: { value: '999' } })

    fireEvent.click(screen.getByRole('button', { name: /guardar cambios/i }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    const payload = onSubmit.mock.calls[0][0] as { paidAmount?: number }
    expect(payload.paidAmount).toBeUndefined()
  })

  // Task #380: pins `data.paidAmount ? parseFloat(data.paidAmount) : undefined`
  // (AppointmentFormModal.tsx) — the store's paid-refetch branch is gated on
  // `Number(data.paidAmount) > 0`, so a string leaking through here instead of
  // a number would still coerce truthily but is not what the branch/API
  // contract expects. Locks the exact numeric payload shape.
  it('submits paidAmount as a number when creating a new appointment', async () => {
    const { onSubmit } = renderModal()
    await waitForOptionsLoaded()
    fireEvent.click(screen.getByRole('button', { name: 'Select Ana' }))
    await selectDoctor()

    const input = getPaidAmountInput() as HTMLInputElement
    fireEvent.change(input, { target: { value: '120' } })

    fireEvent.click(screen.getByRole('button', { name: /crear cita/i }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    const payload = onSubmit.mock.calls[0][0] as { paidAmount?: number }
    expect(payload.paidAmount).toBe(120)
    expect(typeof payload.paidAmount).toBe('number')
  })

  it('submits paidAmount as a number when editing an unpaid appointment', async () => {
    const appointment = makeAppointment({
      cost: 150,
      isPaid: false,
      hasRecordedPayment: false,
      recordedPaidAmount: 0,
    })
    const { onSubmit } = renderModal({ appointment })
    await waitForOptionsLoaded()

    const input = getPaidAmountInput() as HTMLInputElement
    fireEvent.change(input, { target: { value: '80' } })

    fireEvent.click(screen.getByRole('button', { name: /guardar cambios/i }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    const payload = onSubmit.mock.calls[0][0] as { paidAmount?: number }
    expect(payload.paidAmount).toBe(80)
    expect(typeof payload.paidAmount).toBe('number')
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
    // Pin the system clock so the DatePicker popover deterministically opens
    // on July 2026 (matching the hardcoded 'viernes, 10 de julio de 2026' day
    // label and ISO assertions below), regardless of the real wall-clock
    // date. `shouldAdvanceTime: true` keeps setTimeout-based polling (e.g.
    // Testing Library's `waitFor`, used throughout this suite) working
    // against real elapsed time even while `Date`/`Date.now()` stay faked.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date('2026-07-01T12:00:00'))
    getDoctorsMock.mockResolvedValue([mockDoctor])
    getPatientsMock.mockResolvedValue([mockPatientRecord])
    listBudgetsByPatientMock.mockResolvedValue({ data: [], total: 0 })
    getAppointmentBudgetItemsMock.mockResolvedValue([])
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // The DatePicker's trigger button carries a fixed aria-label
  // (t('appointments.form.date') = "Fecha"), independent of the currently
  // displayed date text, so it's reliably queryable by that attribute
  // directly — no other element in the modal shares it.
  //
  // This used to be `screen.getByRole('button', { name: 'Fecha' })`. Same
  // mechanism as `getDoctorPickerInput()`'s label-based query above, one step
  // worse: with the calendar grid open (as most tests using this helper have
  // it), a document-wide role+name match pays the per-candidate
  // `isInaccessible` walk over every button on screen (nav, close, submit,
  // ~30-40 day cells) PLUS an accessible-name computation per candidate.
  // Measured on this component: ~22.3ms/call for the role+name query vs
  // ~0.06ms/call for `document.querySelector('button[aria-label="Fecha"]')`,
  // ~380x faster.
  function getDateTrigger() {
    return document.querySelector('button[aria-label="Fecha"]') as HTMLButtonElement
  }

  // The TimePicker trigger <button> exposes role="combobox" (task #347: the
  // APG select-only-combobox pattern, sanctioned for a <button> in ARIA-in-HTML
  // — see TimePicker.test.tsx). DoctorPicker's <input> also computes to role
  // "combobox" (task #246), but its accessible name is "Doctor *"
  // (t('appointments.form.doctor'), via its associated <label>), so these
  // name-scoped queries for "Hora de inicio" / "Hora de fin" stay unambiguous.
  function getTimeTriggers() {
    return [
      screen.getByRole('combobox', { name: 'Hora de inicio' }),
      screen.getByRole('combobox', { name: 'Hora de fin' }),
    ]
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
    return { date, day, isoDate: formatDateForInputHelper(date), label }
  }

  // Clicks the calendar-day button for `day` (a day-of-month number) inside
  // the currently open DatePicker grid.
  //
  // Same mechanism as `selectTime()` above (task #398), one step worse: a
  // document-wide `getByRole('button', { name: label })` against an open
  // calendar grid pays the same per-candidate ancestor `isInaccessible` walk,
  // but over MORE candidates (~30-40 day buttons plus every other button in
  // the mounted modal — nav, close, submit — vs. ~96 <li role="option">
  // slots for the TimePicker), AND an accessible-NAME computation per
  // candidate on top of that, which is strictly pricier than a bare role
  // match. Measured on this component: this exact query is what pushed
  // "submits the exact date selected via the DatePicker popover" past the
  // 5000ms test timeout.
  //
  // Each day button's only visible content is its bare day-of-month number
  // (react-day-picker's `formatDay()`, e.g. "1"); the full accessible-name
  // string ("viernes, 10 de julio de 2026") only exists as its aria-label
  // attribute, never as rendered text. Outside-month days are hidden
  // entirely (not just greyed out — react-day-picker renders nothing for
  // them when `showOutsideDays` is unset, see DayPicker.js), so that bare
  // number is unambiguous within the grid currently on screen. Scoping to
  // the grid and matching on that number instead skips both the extra
  // candidate volume and the accessible-name computation, the same win
  // `selectTime()` gets from `within(popover).getByText(hhmm)`.
  function selectCalendarDay(day: number) {
    const grid = screen.getByRole('grid')
    fireEvent.click(within(grid).getByText(String(day)))
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

    const { isoDate, day } = pickCalendarDay()
    fireEvent.click(getDateTrigger())
    selectCalendarDay(day)

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

    const { day } = pickCalendarDay()
    selectCalendarDay(day)
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

// Coverage for task #239: a per-tenant map of appointment type -> duration
// (minutes), used to suggest `endTime` from the entered `type` + `startTime`.
// These tests assert on the durations in the submitted payload (endTime -
// startTime, in minutes) rather than on the TimePicker's displayed text,
// since the trigger only exposes a locale-formatted label — the ISO
// timestamps actually handed to `onSubmit` are the real, unambiguous
// contract (same technique the date/time picker suite above uses).
describe('AppointmentFormModal — appointment type duration auto-fill (task #239)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getDoctorsMock.mockResolvedValue([mockDoctor])
    getPatientsMock.mockResolvedValue([mockPatientRecord])
    listBudgetsByPatientMock.mockResolvedValue({ data: [], total: 0 })
    getAppointmentBudgetItemsMock.mockResolvedValue([])
    settingsStoreState.settings = null
    settingsStoreState.fetchSettings = vi.fn().mockResolvedValue(undefined)
  })

  function getTypeInput() {
    return screen.getByPlaceholderText('Ej: Limpieza, Revisión, Ortodoncia...')
  }

  function durationMinutes(payload: { startTime?: string; endTime?: string }): number {
    const start = new Date(payload.startTime as string)
    const end = new Date(payload.endTime as string)
    return (end.getTime() - start.getTime()) / 60000
  }

  it("auto-sets endTime to startTime plus the configured type's duration", async () => {
    settingsStoreState.settings = {
      appointmentTypeDurations: [{ type: 'Limpieza', duration: 45 }],
      defaultAppointmentDuration: 30,
    }
    const { onSubmit } = renderModal()
    await waitForOptionsLoaded()

    fireEvent.change(getTypeInput(), { target: { value: 'Limpieza' } })
    fireEvent.click(screen.getByRole('button', { name: 'Select Ana' }))
    await selectDoctor()
    fireEvent.click(screen.getByRole('button', { name: /crear cita/i }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(durationMinutes(onSubmit.mock.calls[0][0])).toBe(45)
  })

  it('matches the configured type case-insensitively and ignoring surrounding whitespace', async () => {
    settingsStoreState.settings = {
      appointmentTypeDurations: [{ type: 'Limpieza', duration: 45 }],
      defaultAppointmentDuration: 30,
    }
    const { onSubmit } = renderModal()
    await waitForOptionsLoaded()

    fireEvent.change(getTypeInput(), { target: { value: '  limpieza  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Select Ana' }))
    await selectDoctor()
    fireEvent.click(screen.getByRole('button', { name: /crear cita/i }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(durationMinutes(onSubmit.mock.calls[0][0])).toBe(45)
  })

  it('falls back to the tenant defaultAppointmentDuration for an unconfigured type', async () => {
    settingsStoreState.settings = {
      appointmentTypeDurations: [{ type: 'Limpieza', duration: 45 }],
      defaultAppointmentDuration: 50,
    }
    const { onSubmit } = renderModal()
    await waitForOptionsLoaded()

    fireEvent.change(getTypeInput(), { target: { value: 'Consulta' } })
    fireEvent.click(screen.getByRole('button', { name: 'Select Ana' }))
    await selectDoctor()
    fireEvent.click(screen.getByRole('button', { name: /crear cita/i }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(durationMinutes(onSubmit.mock.calls[0][0])).toBe(50)
  })

  it('falls back to the tenant defaultAppointmentDuration when the type is left empty', async () => {
    settingsStoreState.settings = {
      appointmentTypeDurations: [{ type: 'Limpieza', duration: 45 }],
      defaultAppointmentDuration: 50,
    }
    const { onSubmit } = renderModal()
    await waitForOptionsLoaded()

    fireEvent.click(screen.getByRole('button', { name: 'Select Ana' }))
    await selectDoctor()
    fireEvent.click(screen.getByRole('button', { name: /crear cita/i }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(durationMinutes(onSubmit.mock.calls[0][0])).toBe(50)
  })

  it('does not overwrite an existing appointment\'s saved endTime on hydration, even when its type has a configured duration', async () => {
    settingsStoreState.settings = {
      appointmentTypeDurations: [{ type: 'Limpieza', duration: 90 }],
      defaultAppointmentDuration: 30,
    }
    // Saved as a 30-minute visit; the configured duration for "Limpieza" is
    // now 90 minutes, but opening the modal to edit must not silently
    // stretch it — the effect only kicks in once dirtyFields.type is true.
    const appointment = makeAppointment({
      type: 'Limpieza',
      startTime: '2026-03-10T13:00:00.000Z',
      endTime: '2026-03-10T13:30:00.000Z',
    })
    const { onSubmit } = renderModal({ appointment })
    await waitForOptionsLoaded()

    fireEvent.click(screen.getByRole('button', { name: /guardar cambios/i }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(durationMinutes(onSubmit.mock.calls[0][0])).toBe(30)
  })

  it('lets the user manually change endTime after an auto-fill (auto-fill is a suggestion, not a lock)', async () => {
    settingsStoreState.settings = {
      appointmentTypeDurations: [{ type: 'Limpieza', duration: 45 }],
      defaultAppointmentDuration: 30,
    }
    const { onSubmit } = renderModal()
    await waitForOptionsLoaded()

    fireEvent.change(getTypeInput(), { target: { value: 'Limpieza' } })
    fireEvent.click(screen.getByRole('button', { name: 'Select Ana' }))
    await selectDoctor()

    // Manually override the auto-filled endTime via the TimePicker.
    const endTrigger = screen.getByRole('combobox', { name: 'Hora de fin' })
    selectTime(endTrigger, '11:15')

    fireEvent.click(screen.getByRole('button', { name: /crear cita/i }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    const payload = onSubmit.mock.calls[0][0] as { endTime: string }
    const expectedDate = formatDateForInputHelper(new Date())
    expect(payload.endTime).toBe(new Date(`${expectedDate}T11:15:00`).toISOString())
  })

  it('behaves as before (no crash, submit still works with the hardcoded 30-minute fallback) when settings fail to load, and never retries the failed fetch', async () => {
    // Mirrors the real store: fetchSettings always resolves (it catches
    // internally), it just never populates `settings` on failure.
    settingsStoreState.settings = null
    settingsStoreState.fetchSettings = vi.fn().mockResolvedValue(undefined)

    const { onSubmit } = renderModal()
    await waitForOptionsLoaded()

    // Interact with several fields — each causes a re-render — to exercise
    // the single-attempt guard (settingsFetchAttemptedRef in the component).
    // A prior implementation re-ran fetchSettings on every such re-render.
    fireEvent.change(getTypeInput(), { target: { value: 'Limpieza' } })
    fireEvent.click(screen.getByRole('button', { name: 'Select Ana' }))
    await selectDoctor()
    fireEvent.change(screen.getByPlaceholderText('Notas adicionales sobre la cita...'), {
      target: { value: 'Some notes' },
    })

    fireEvent.click(screen.getByRole('button', { name: /crear cita/i }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(durationMinutes(onSubmit.mock.calls[0][0])).toBe(30)
    expect(settingsStoreState.fetchSettings).toHaveBeenCalledTimes(1)
  })

  it('behaves as before (falls back to defaultAppointmentDuration) when settings load with an empty appointmentTypeDurations array', async () => {
    settingsStoreState.settings = {
      appointmentTypeDurations: [],
      defaultAppointmentDuration: 30,
    }
    const { onSubmit } = renderModal()
    await waitForOptionsLoaded()

    fireEvent.change(getTypeInput(), { target: { value: 'Limpieza' } })
    fireEvent.click(screen.getByRole('button', { name: 'Select Ana' }))
    await selectDoctor()
    fireEvent.click(screen.getByRole('button', { name: /crear cita/i }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(durationMinutes(onSubmit.mock.calls[0][0])).toBe(30)
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

// ============================================================================
// Task #544 (review finding 1): executed budget items on an edited appointment
// ============================================================================
//
// `appointment.budgetItems` is only populated by the two API read paths that
// call mergeAllocation (get-by-id and get-by-patient). The modal is also fed
// from the Appointments page (list/calendar) and the doctor record
// (get-by-doctor), whose appointments carry NO `budgetItems`. In that shape the
// modal used to render nothing — an editable `cost` with no figure and no
// duplicate-cost hint, and nobody learns it is missing. The contract pinned
// here: the operator is always told, either the figure plus the hint, or an
// explicit "unavailable" notice.
describe('AppointmentFormModal — executed budget items disclosure (#544)', () => {
  // Resolved through i18n (the suite pins 'es'), so a reworded string does not
  // break the test but a missing key does (t() would return the raw key and
  // the equality below would fail the "is translated" assertion).
  const hintText = () => i18n.t('appointments.budgetItems.executedChargeHint')
  const unavailableText = () => i18n.t('appointments.budgetItems.executedChargeUnavailable')

  beforeEach(() => {
    getDoctorsMock.mockResolvedValue([mockDoctor])
    getPatientsMock.mockResolvedValue([mockPatientRecord])
    listBudgetsByPatientMock.mockResolvedValue({ data: [], total: 0 })
    getAppointmentBudgetItemsMock.mockResolvedValue([])
    getAppointmentByIdMock.mockReset()
  })

  // Its own key since #547: `budgetItems.loading` also labels the selection
  // list below, so the same sentence stood for two different things.
  const loadingText = () => i18n.t('appointments.budgetItems.executedChargeLoading')
  // The strong treatment is carried by role="alert" on the FIGURE block, so the
  // assertion is about which element is the alert, not about class names.
  const hintAlert = () => screen.getByText(hintText()).closest('[role="alert"]')
  const figureLine = /Ítems de presupuesto ejecutados en esta cita/

  it('WITH the figure: shows count, total, covered/outstanding and the duplicate-cost hint', async () => {
    renderModal({
      appointment: makeAppointment({
        cost: 4200,
        budgetItems: { count: 3, cost: 5500, paidAmount: 3000, outstanding: 2500 },
      }),
    })
    await waitForOptionsLoaded()

    expect(screen.getByText(/Ítems de presupuesto ejecutados en esta cita: 3/)).toHaveTextContent('USD 5,500.00')
    expect(screen.getByText(/Cubierto: USD 3,000\.00 · Pendiente: USD 2,500\.00/)).toBeInTheDocument()
    expect(screen.getByText(hintText())).toBeInTheDocument()
    // The notice for the missing figure must NOT appear when the figure is there.
    expect(screen.queryByText(unavailableText())).not.toBeInTheDocument()
  })

  it('prop already carries budgetItems: shows the figure and never calls getAppointmentById', async () => {
    renderModal({
      appointment: makeAppointment({
        budgetItems: { count: 2, cost: 900, paidAmount: 0, outstanding: 900 },
      }),
    })
    await waitForOptionsLoaded()

    expect(screen.getByText(/Ítems de presupuesto ejecutados en esta cita: 2/)).toHaveTextContent('USD 900.00')
    expect(getAppointmentByIdMock).not.toHaveBeenCalled()
  })

  it('prop lacks budgetItems and the fetch REJECTS: says explicitly that the figure is unavailable', async () => {
    getAppointmentByIdMock.mockRejectedValue(new Error('network down'))
    const appt = makeAppointment({ cost: 4200 })
    expect(appt.budgetItems).toBeUndefined()
    renderModal({ appointment: appt })
    await waitForOptionsLoaded()

    expect(await screen.findByText(unavailableText())).toBeInTheDocument()
    expect(getAppointmentByIdMock).toHaveBeenCalledTimes(1)
    expect(getAppointmentByIdMock).toHaveBeenCalledWith('apt-1')
    // The key must resolve to a real translation, not echo the key back.
    expect(unavailableText()).not.toBe('appointments.budgetItems.executedChargeUnavailable')
    expect(screen.queryByText(figureLine)).not.toBeInTheDocument()
    expect(screen.queryByText(hintText())).not.toBeInTheDocument()
  })

  it('prop lacks budgetItems and the fetch RESOLVES without budgetItems: renders nothing (no false alarm)', async () => {
    getAppointmentByIdMock.mockResolvedValue(makeAppointment({ cost: 4200 }))
    renderModal({ appointment: makeAppointment({ cost: 4200 }) })
    await waitForOptionsLoaded()
    await waitFor(() => expect(getAppointmentByIdMock).toHaveBeenCalledTimes(1))
    // Let the resolved fetch settle into state before asserting absence.
    await waitFor(() => expect(screen.queryByText(loadingText())).not.toBeInTheDocument())

    expect(screen.queryByText(unavailableText())).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText(figureLine)).not.toBeInTheDocument()
    expect(screen.queryByText(hintText())).not.toBeInTheDocument()
  })

  it('prop lacks budgetItems and the fetch RESOLVES with budgetItems: shows the fetched figure and hint', async () => {
    getAppointmentByIdMock.mockResolvedValue(
      makeAppointment({ budgetItems: { count: 1, cost: 700, paidAmount: 200, outstanding: 500 } }),
    )
    renderModal({ appointment: makeAppointment({ cost: 4200 }) })
    await waitForOptionsLoaded()

    expect(await screen.findByText(/Ítems de presupuesto ejecutados en esta cita: 1/)).toHaveTextContent('USD 700.00')
    expect(screen.getByText(hintText())).toBeInTheDocument()
    expect(screen.queryByText(unavailableText())).not.toBeInTheDocument()
  })

  it('fetch PENDING: shows the loading state and never the unavailable notice', async () => {
    getAppointmentByIdMock.mockReturnValue(new Promise(() => {}))
    renderModal({ appointment: makeAppointment({ cost: 4200 }) })
    await waitForOptionsLoaded()
    await waitFor(() => expect(getAppointmentByIdMock).toHaveBeenCalledTimes(1))

    expect(screen.getByText(loadingText())).toBeInTheDocument()
    expect(screen.queryByText(unavailableText())).not.toBeInTheDocument()
    expect(screen.queryByText(figureLine)).not.toBeInTheDocument()
  })

  // GUARD 8 (task #590). Rewritten: this used to assert the OPPOSITE — that a
  // typed cost beside executed items raised the amber role="alert" duplication
  // warning (#547's "the confirmed double charge is the loud one"). #590
  // removed that warning, because the appointment's cost now supersedes the
  // items' own charge and a double charge is no longer possible, so the banner
  // would be a false statement on screen.
  //
  // A removed guard that nothing replaced and a removed guard whose job the
  // engine now does look identical in a diff, so this asserts BOTH halves: the
  // warning is gone, AND the quiet hint in its place states the rule that
  // replaced it ("si la cita tiene un costo, estos ítems no se cobran
  // aparte"). The old hint said the opposite — "borra el costo para no
  // cobrarlos dos veces" — so the absence check alone could not tell a
  // deliberate removal from a dropped warning over unchanged prose.
  it('GUARD 8 — the duplication warning is GONE for the exact case it used to fire on (figure + typed cost)', async () => {
    renderModal({
      appointment: makeAppointment({
        cost: 4200,
        budgetItems: { count: 1, cost: 700, paidAmount: 0, outstanding: 700 },
      }),
    })
    await waitForOptionsLoaded()

    // The figure is on screen: this really is the case that used to alert.
    expect(screen.getByText(/Ítems de presupuesto ejecutados en esta cita: 1/)).toBeInTheDocument()
    expect(hintAlert()).toBeNull()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('GUARD 8 — and the block carries no amber (warning) styling for that case', async () => {
    renderModal({
      appointment: makeAppointment({
        cost: 4200,
        budgetItems: { count: 1, cost: 700, paidAmount: 0, outstanding: 700 },
      }),
    })
    await waitForOptionsLoaded()

    const block = screen.getByText(hintText()).closest('div')
    expect(block).not.toBeNull()
    expect(block!.className).not.toMatch(/amber/)
  })

  it('GUARD 8 — its absence is deliberate: the hint in its place states that the items do not bill beside a cost', async () => {
    renderModal({
      appointment: makeAppointment({
        cost: 4200,
        budgetItems: { count: 1, cost: 700, paidAmount: 0, outstanding: 700 },
      }),
    })
    await waitForOptionsLoaded()

    // The replacement statement, rendered. Quoted from es.json rather than
    // re-derived through t(), so rewording the key back to the pre-#590
    // "borra el costo para no cobrarlos dos veces" fails here.
    expect(screen.getByText(hintText())).toHaveTextContent('no se cobran aparte')
    expect(hintText()).not.toMatch(/dos veces/)
  })

  it('figure WITHOUT a typed cost is not an alert either: no visit can be double charged since #590', async () => {
    renderModal({
      appointment: makeAppointment({
        cost: 0,
        budgetItems: { count: 1, cost: 700, paidAmount: 0, outstanding: 700 },
      }),
    })
    await waitForOptionsLoaded()

    expect(screen.getByText(hintText())).toBeInTheDocument()
    expect(hintAlert()).toBeNull()
  })

  it('the unavailable notice keeps role=alert for screen readers but is not the figure alert', async () => {
    getAppointmentByIdMock.mockRejectedValue(new Error('network down'))
    renderModal({ appointment: makeAppointment({ cost: 4200 }) })
    await waitForOptionsLoaded()

    const notice = await screen.findByText(unavailableText())
    expect(notice).toHaveAttribute('role', 'alert')
    // and the figure is absent, so the only alert on screen is this quiet one
    expect(screen.queryByText(figureLine)).not.toBeInTheDocument()
  })

  it('reopening after a failure clears the stale notice and goes back to loading', async () => {
    // The bug lives in the INTERMEDIATE state, not the settled one. A version of
    // this test that let the second fetch resolve passed even with the fix
    // removed, because the arriving success overwrote the stale failure either
    // way -- it asserted the end state for a defect that only exists on the way
    // there. So the second call is left PENDING on purpose.
    getAppointmentByIdMock.mockRejectedValueOnce(new Error('network down'))
    const appt = makeAppointment({ cost: 4200 })
    const { rerender } = render(
      <AppointmentFormModal isOpen onClose={vi.fn()} onSubmit={vi.fn()} appointment={appt} />,
    )
    await waitForOptionsLoaded()
    expect(await screen.findByText(unavailableText())).toBeInTheDocument()

    // `if (!isOpen) return null` is a render guard, not an unmount, so the
    // failed result survives in state: the reopened modal used to show the
    // notice instantly and never ask again.
    getAppointmentByIdMock.mockReturnValue(new Promise(() => {}))
    rerender(<AppointmentFormModal isOpen={false} onClose={vi.fn()} onSubmit={vi.fn()} appointment={appt} />)
    rerender(<AppointmentFormModal isOpen onClose={vi.fn()} onSubmit={vi.fn()} appointment={appt} />)

    expect(await screen.findByText(loadingText())).toBeInTheDocument()
    expect(screen.queryByText(unavailableText())).not.toBeInTheDocument()
    expect(getAppointmentByIdMock).toHaveBeenCalledTimes(2)
  })

  it('switching appointments does not show the previous appointment figure', async () => {
    getAppointmentByIdMock.mockImplementation((id: string) =>
      id === 'apt-1'
        ? Promise.resolve(makeAppointment({ id: 'apt-1', budgetItems: { count: 4, cost: 1000, paidAmount: 0, outstanding: 1000 } }))
        : new Promise(() => {}),
    )
    const { rerender } = renderModal({ appointment: makeAppointment({ id: 'apt-1' }) })
    await waitForOptionsLoaded()
    expect(await screen.findByText(/Ítems de presupuesto ejecutados en esta cita: 4/)).toBeInTheDocument()

    rerender(
      <AppointmentFormModal
        isOpen
        onClose={() => {}}
        onSubmit={vi.fn().mockResolvedValue(undefined)}
        appointment={makeAppointment({ id: 'apt-2' })}
      />,
    )

    await waitFor(() => expect(getAppointmentByIdMock).toHaveBeenCalledWith('apt-2'))
    expect(screen.queryByText(/Ítems de presupuesto ejecutados en esta cita: 4/)).not.toBeInTheDocument()
    expect(screen.getByText(loadingText())).toBeInTheDocument()
  })

  it('does not show any executed-items disclosure when creating (no appointment)', async () => {
    renderModal()
    await waitForOptionsLoaded()

    expect(screen.queryByText(unavailableText())).not.toBeInTheDocument()
    expect(screen.queryByText(hintText())).not.toBeInTheDocument()
  })
})

// Task #588 guard 6 (frontend half): the cost field's submit shape. An emptied
// field used to send `undefined`, which the API reads as "leave the stored cost
// alone", so a cleared cost silently came back. Editing now sends `null`.
describe('AppointmentFormModal — cost submit shape (task #588)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getDoctorsMock.mockResolvedValue([mockDoctor])
    getPatientsMock.mockResolvedValue([mockPatientRecord])
    listBudgetsByPatientMock.mockResolvedValue({ data: [], total: 0 })
    getAppointmentBudgetItemsMock.mockResolvedValue([])
  })

  const COST_LABEL = 'Costo ($)'

  function getCostInput() {
    const container = screen.getByText(COST_LABEL).parentElement
    if (!container) throw new Error('No cost container found')
    return within(container).getByRole('spinbutton') as HTMLInputElement
  }

  async function submitEdit(appointmentOverrides: Parameters<typeof makeAppointment>[0], typed?: string) {
    const appointment = makeAppointment({ id: 'apt-1', ...appointmentOverrides })
    const { onSubmit } = renderModal({ appointment })
    await waitForOptionsLoaded()
    const input = getCostInput()
    await waitFor(() => expect(input.value).toBe(appointment.cost?.toString() ?? ''))
    if (typed !== undefined) fireEvent.change(input, { target: { value: typed } })
    fireEvent.click(screen.getByRole('button', { name: /guardar cambios/i }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    return onSubmit.mock.calls[0][0] as Record<string, unknown>
  }

  it('editing, field emptied: cost is sent as null so the API clears it', async () => {
    const payload = await submitEdit({ cost: 500 }, '')
    expect('cost' in payload).toBe(true)
    expect(payload.cost).toBeNull()
  })

  it('editing, a typed 0: cost is the number 0, not null', async () => {
    const payload = await submitEdit({ cost: 500 }, '0')
    expect(payload.cost).toBe(0)
  })

  it('editing, a typed amount: cost is that number', async () => {
    const payload = await submitEdit({ cost: 500 }, '175.5')
    expect(payload.cost).toBe(175.5)
  })

  it('editing an appointment that never had a cost and leaving it empty: sends null (nothing to keep)', async () => {
    const payload = await submitEdit({ cost: null })
    expect(payload.cost).toBeNull()
  })

  it('creating with the field empty: cost stays undefined (create rejects null)', async () => {
    const { onSubmit } = renderModal()
    await waitForOptionsLoaded()
    fireEvent.click(screen.getByRole('button', { name: 'Select Ana' }))
    await selectDoctor()
    fireEvent.click(screen.getByRole('button', { name: /crear cita/i }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect((onSubmit.mock.calls[0][0] as { cost?: unknown }).cost).toBeUndefined()
  })

  it('creating with a typed 0: cost is the number 0', async () => {
    const { onSubmit } = renderModal()
    await waitForOptionsLoaded()
    fireEvent.click(screen.getByRole('button', { name: 'Select Ana' }))
    await selectDoctor()
    fireEvent.change(getCostInput(), { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: /crear cita/i }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect((onSubmit.mock.calls[0][0] as { cost?: unknown }).cost).toBe(0)
  })
})

// ============================================================================
// Task #590: the appointment's cost is the single authority for its visit
// ============================================================================
//
// Guards 4, 5 and 6 of the task plan — the frontend halves. The backend halves
// (the appointment ROW, and what the three charge queries bill) live in
// apps/api/src/routes/appointments-cost-is-the-authority.test.ts; guards 1, 2,
// 3 and 7 are backend-only, guard 8 is in the #544 disclosure suite above.
//
// Associating budget items now PROPOSES their total in the cost field instead
// of billing them on their own. The three properties that makes safe:
//   - it is a prefill, not a write (nothing leaves the modal until save);
//   - it only fills an empty field or replaces its own last proposal, so a
//     figure the operator typed is never silently overwritten;
//   - a total falling to 0 leaves the field as the operator last saw it.
//
// The cost field has THREE states that reach the API differently — empty
// (sends null on edit), "0" (sends the number 0) and a number — so each is
// exercised below rather than only the empty one.
describe('AppointmentFormModal — cost prefilled from associated budget items (task #590)', () => {
  const COST_LABEL = 'Costo ($)'

  function getCostInput() {
    const container = screen.getByText(COST_LABEL).parentElement
    if (!container) throw new Error('No cost container found')
    return within(container).getByRole('spinbutton') as HTMLInputElement
  }

  const ITEM_2500 = 'Corona 2500'
  const ITEM_1300 = 'Perno 1300'

  beforeEach(() => {
    vi.clearAllMocks()
    getDoctorsMock.mockResolvedValue([mockDoctor])
    getPatientsMock.mockResolvedValue([mockPatientRecord])
    getAppointmentBudgetItemsMock.mockResolvedValue([])
    getAppointmentByIdMock.mockImplementation(() => Promise.resolve(makeAppointment()))
    // One PENDING item of 2500 and one of 1300, so a prefill that sums the
    // wrong set (both = 3800) is distinguishable from the right one (2500).
    listBudgetsByPatientMock.mockResolvedValue({
      data: [
        makeBudget({
          items: [
            makeBudgetItem({ id: 'item-2500', description: ITEM_2500, unitPrice: '2500', totalPrice: '2500' }),
            makeBudgetItem({ id: 'item-1300', description: ITEM_1300, unitPrice: '1300', totalPrice: '1300' }),
          ],
        }),
      ],
      total: 1,
    })
  })

  /** Create mode with a patient and a doctor chosen and the item list loaded. */
  async function openCreateWithItems() {
    const rendered = renderModal()
    await waitForOptionsLoaded()
    fireEvent.click(screen.getByRole('button', { name: 'Select Ana' }))
    await selectDoctor()
    await waitFor(() => expect(screen.getByText(ITEM_2500)).toBeInTheDocument())
    return rendered
  }

  async function submit(label = /crear cita/i) {
    fireEvent.click(screen.getByRole('button', { name: label }))
  }

  // --------------------------------------------------------------------------
  // GUARD 4 — the typed figure wins over the items' total
  // --------------------------------------------------------------------------
  //
  // Three assertions, each in its own `it()`: a lone `toBe(2000)` cannot tell
  // "the typed value won" from "the prefill never happened", and an assertion
  // sitting after a failing one in the same `it()` is never reached.
  async function prefillThenType(typed: string) {
    const { onSubmit } = await openCreateWithItems()
    fireEvent.click(getItemCheckbox(ITEM_2500))
    // The prefill really happened: without this the test below would pass on a
    // component that never prefills at all.
    await waitFor(() => expect(getCostInput().value).toBe('2500'))
    fireEvent.change(getCostInput(), { target: { value: typed } })
    await submit()
    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    return (onSubmit.mock.calls[0][0] as { cost?: unknown }).cost
  }

  it('GUARD 4 — prefill 2500, type 2000: the submitted cost is 2000', async () => {
    expect(await prefillThenType('2000')).toBe(2000)
  })

  it('GUARD 4 — prefill 2500, type 2000: the submitted cost is NOT 2500 (the prefill did not win)', async () => {
    expect(await prefillThenType('2000')).not.toBe(2500)
  })

  it('GUARD 4 — prefill 2500, type 2000: the submitted cost is NOT 4500 (the two were not added)', async () => {
    expect(await prefillThenType('2000')).not.toBe(4500)
  })

  it('GUARD 4 — a figure typed BEFORE any item is selected is never overwritten by the prefill', async () => {
    const { onSubmit } = await openCreateWithItems()
    fireEvent.change(getCostInput(), { target: { value: '2000' } })
    fireEvent.click(getItemCheckbox(ITEM_2500))

    // Settle: the item is checked, so the effect has had its chance to run.
    await waitFor(() => expect(getItemCheckbox(ITEM_2500)).toBeChecked())
    expect(getCostInput().value).toBe('2000')

    await submit()
    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect((onSubmit.mock.calls[0][0] as { cost?: unknown }).cost).toBe(2000)
  })

  // --------------------------------------------------------------------------
  // GUARD 5 — the prefill is a prefill, not a write
  // --------------------------------------------------------------------------
  it('GUARD 5 — selecting an item fills the field with its total', async () => {
    await openCreateWithItems()
    fireEvent.click(getItemCheckbox(ITEM_2500))
    await waitFor(() => expect(getCostInput().value).toBe('2500'))
  })

  it('GUARD 5 — selecting two items fills the field with the SUM, in cents (2500 + 1300 = 3800)', async () => {
    await openCreateWithItems()
    fireEvent.click(getItemCheckbox(ITEM_2500))
    await waitFor(() => expect(getCostInput().value).toBe('2500'))
    fireEvent.click(getItemCheckbox(ITEM_1300))
    await waitFor(() => expect(getCostInput().value).toBe('3800'))
  })

  it('GUARD 5 — nothing is submitted while the operator only selects items (no write before save)', async () => {
    const { onSubmit } = await openCreateWithItems()
    fireEvent.click(getItemCheckbox(ITEM_2500))
    await waitFor(() => expect(getCostInput().value).toBe('2500'))

    // onSubmit is the modal's ONLY writer: the component imports no update
    // function, so "no write fired" is exactly "onSubmit was not called".
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('GUARD 5 — editing: the prefill does not fire an appointment write; the only appointment-api calls are reads', async () => {
    getAppointmentBudgetItemsMock.mockResolvedValue([])
    const { onSubmit } = renderModal({ appointment: makeAppointment({ id: 'apt-1', cost: null }) })
    await waitForOptionsLoaded()
    await waitFor(() => expect(screen.getByText(ITEM_2500)).toBeInTheDocument())
    fireEvent.click(getItemCheckbox(ITEM_2500))
    await waitFor(() => expect(getCostInput().value).toBe('2500'))

    expect(onSubmit).not.toHaveBeenCalled()
    // Reads only: the by-id fetch (the #544 disclosure) and the associated-items
    // fetch. Neither writes. The appointment ROW staying at its old cost is
    // asserted server-side in appointments-cost-is-the-authority.test.ts.
    expect(getAppointmentByIdMock).toHaveBeenCalledWith('apt-1')
    expect(getAppointmentBudgetItemsMock).toHaveBeenCalledWith('apt-1')
  })

  // --------------------------------------------------------------------------
  // GUARD 6 — unlinking the last item leaves the cost as the operator last saw it
  // --------------------------------------------------------------------------
  it('GUARD 6 — unselecting the only item leaves the prefilled 2500 in the field', async () => {
    await openCreateWithItems()
    fireEvent.click(getItemCheckbox(ITEM_2500))
    await waitFor(() => expect(getCostInput().value).toBe('2500'))

    fireEvent.click(getItemCheckbox(ITEM_2500))
    await waitFor(() => expect(getItemCheckbox(ITEM_2500)).not.toBeChecked())
    expect(getCostInput().value).toBe('2500')
  })

  it('GUARD 6 — and that surviving 2500 is what gets submitted', async () => {
    const { onSubmit } = await openCreateWithItems()
    fireEvent.click(getItemCheckbox(ITEM_2500))
    await waitFor(() => expect(getCostInput().value).toBe('2500'))
    fireEvent.click(getItemCheckbox(ITEM_2500))
    await waitFor(() => expect(getItemCheckbox(ITEM_2500)).not.toBeChecked())

    await submit()
    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    const payload = onSubmit.mock.calls[0][0] as { cost?: unknown; budgetItemIds?: unknown }
    expect(payload.cost).toBe(2500)
    // Submitted once, as one figure: no item ids ride along to bill again.
    expect(payload.budgetItemIds).toBeUndefined()
  })

  it('GUARD 6 — a TYPED figure survives selecting and then unselecting an item', async () => {
    await openCreateWithItems()
    fireEvent.change(getCostInput(), { target: { value: '2000' } })
    fireEvent.click(getItemCheckbox(ITEM_2500))
    await waitFor(() => expect(getItemCheckbox(ITEM_2500)).toBeChecked())
    fireEvent.click(getItemCheckbox(ITEM_2500))
    await waitFor(() => expect(getItemCheckbox(ITEM_2500)).not.toBeChecked())

    expect(getCostInput().value).toBe('2000')
  })

  it('GUARD 6 — field state "0": a typed zero is not treated as empty and is not overwritten', async () => {
    const { onSubmit } = await openCreateWithItems()
    fireEvent.change(getCostInput(), { target: { value: '0' } })
    fireEvent.click(getItemCheckbox(ITEM_2500))
    await waitFor(() => expect(getItemCheckbox(ITEM_2500)).toBeChecked())

    expect(getCostInput().value).toBe('0')
    await submit()
    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect((onSubmit.mock.calls[0][0] as { cost?: unknown }).cost).toBe(0)
  })

  it('GUARD 6 — field state "empty": only an empty field is filled by the prefill', async () => {
    await openCreateWithItems()
    expect(getCostInput().value).toBe('')
    fireEvent.click(getItemCheckbox(ITEM_2500))
    await waitFor(() => expect(getCostInput().value).toBe('2500'))
  })

  it('GUARD 6 — editing: emptying the field after a prefill still submits null, so the cost can be cleared', async () => {
    const { onSubmit } = renderModal({ appointment: makeAppointment({ id: 'apt-1', cost: null }) })
    await waitForOptionsLoaded()
    await waitFor(() => expect(screen.getByText(ITEM_2500)).toBeInTheDocument())
    fireEvent.click(getItemCheckbox(ITEM_2500))
    await waitFor(() => expect(getCostInput().value).toBe('2500'))

    fireEvent.change(getCostInput(), { target: { value: '' } })
    await submit(/guardar cambios/i)
    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    const payload = onSubmit.mock.calls[0][0] as Record<string, unknown>
    expect('cost' in payload).toBe(true)
    expect(payload.cost).toBeNull()
  })

  // --------------------------------------------------------------------------
  // The hint under the field, which is what tells the operator the figure is a
  // proposal rather than a locked total. The field itself stays EDITABLE —
  // a read-only field was considered for this task and rejected.
  // --------------------------------------------------------------------------
  it('the cost field stays enabled after a prefill (the figure is a proposal, not a lock)', async () => {
    await openCreateWithItems()
    fireEvent.click(getItemCheckbox(ITEM_2500))
    await waitFor(() => expect(getCostInput().value).toBe('2500'))

    expect(getCostInput()).toBeEnabled()
    expect(getCostInput()).not.toHaveAttribute('readonly')
  })

  // --------------------------------------------------------------------------
  // GUARD 7 (#590, review cycle 2) — the prefill needs an OPERATOR GESTURE
  // --------------------------------------------------------------------------
  //
  // The prefill effect is keyed on `itemsChargeTotal`, and a total above zero
  // on its own cannot tell "the operator just associated items" from "this
  // appointment already had items when it opened": in edit mode the items load
  // asynchronously AFTER the identity reset has written '' into the cost
  // field, so the effect would fire on a plain reopen. Task #590's trigger is
  // associating items or confirming them executed; a reopen is neither, and
  // letting it fill the field turns an incidental save of a historically
  // costless visit into a new charge (and, for merely SCHEDULED items, a
  // charge for work nobody has confirmed executed, which
  // BUDGET_ITEM_BILLABLE_AUTHORITY reserves for the EXECUTED role).
  //
  // Both fixtures are ordinary production states: a visit planned from a
  // budget carries SCHEDULED links and no cost, and an EXECUTED link with no
  // typed cost is exactly the state the #544 disclosure is about.
  //
  // Each block opens with a VACUITY CHECK on the items total. "The field is
  // empty" is satisfied by a total of zero as well as by the gate, so without
  // it these would pass on a fixture that never reaches the effect at all. The
  // check is the hint under the field, which renders only while
  // itemsChargeTotal > 0 and names the figure.
  describe('GUARD 7 — items already associated when the modal opens', () => {
    const PREASSOCIATED_HINT = () =>
      screen.queryByText(i18n.t('appointments.form.costFromItemsHint', { total: 'USD 2,500.00' }))

    /**
     * Edit mode on an appointment with a stored `cost: null`, whose only item
     * is already linked to it in `role` — the item is in the patient's budget
     * with `itemStatus`, so it survives the PENDING filter via `associatedIds`
     * exactly as it does in production.
     */
    async function openEditWithPreassociatedItem(
      role: 'SCHEDULED' | 'EXECUTED',
      itemStatus: BudgetItem['status']
    ) {
      listBudgetsByPatientMock.mockResolvedValue({
        data: [
          makeBudget({
            items: [
              makeBudgetItem({
                id: 'item-2500',
                description: ITEM_2500,
                unitPrice: '2500',
                totalPrice: '2500',
                status: itemStatus,
              }),
            ],
          }),
        ],
        total: 1,
      })
      getAppointmentBudgetItemsMock.mockResolvedValue([
        makeAssociatedItem({
          id: 'item-2500',
          description: ITEM_2500,
          unitPrice: '2500',
          totalPrice: '2500',
          status: itemStatus,
          roles: [role],
        }),
      ])
      const rendered = renderModal({ appointment: makeAppointment({ id: 'apt-1', cost: null }) })
      await waitForOptionsLoaded()
      await waitFor(() => expect(screen.getByText(ITEM_2500)).toBeInTheDocument())
      // The association has landed: the item is checked (SCHEDULED is
      // preselected; EXECUTED is checked+disabled), so the prefill effect has
      // run with a total above zero.
      await waitFor(() => expect(getItemCheckbox(ITEM_2500)).toBeChecked())
      return rendered
    }

    // ---- SCHEDULED links -------------------------------------------------
    it('VACUITY — a SCHEDULED pre-association puts 2500 on the table (so an empty field below is the gate, not a zero total)', async () => {
      await openEditWithPreassociatedItem('SCHEDULED', 'SCHEDULED')
      await waitFor(() => expect(PREASSOCIATED_HINT()).toBeInTheDocument())
    })

    it('a SCHEDULED pre-association leaves the cost field EMPTY — opening is not an operator gesture', async () => {
      await openEditWithPreassociatedItem('SCHEDULED', 'SCHEDULED')
      await waitFor(() => expect(PREASSOCIATED_HINT()).toBeInTheDocument())
      expect(getCostInput().value).toBe('')
    })

    it('a SCHEDULED pre-association then saved unchanged submits cost: null', async () => {
      const { onSubmit } = await openEditWithPreassociatedItem('SCHEDULED', 'SCHEDULED')
      await waitFor(() => expect(PREASSOCIATED_HINT()).toBeInTheDocument())
      await submit(/guardar cambios/i)
      await waitFor(() => expect(onSubmit).toHaveBeenCalled())
      const payload = onSubmit.mock.calls[0][0] as Record<string, unknown>
      expect(payload.cost).toBeNull()
    })

    it('a SCHEDULED pre-association then saved unchanged does NOT submit the items total (2500)', async () => {
      const { onSubmit } = await openEditWithPreassociatedItem('SCHEDULED', 'SCHEDULED')
      await waitFor(() => expect(PREASSOCIATED_HINT()).toBeInTheDocument())
      await submit(/guardar cambios/i)
      await waitFor(() => expect(onSubmit).toHaveBeenCalled())
      expect((onSubmit.mock.calls[0][0] as { cost?: unknown }).cost).not.toBe(2500)
    })

    // ---- EXECUTED links --------------------------------------------------
    it('VACUITY — an EXECUTED pre-association puts 2500 on the table (so an empty field below is the gate, not a zero total)', async () => {
      await openEditWithPreassociatedItem('EXECUTED', 'EXECUTED')
      await waitFor(() => expect(PREASSOCIATED_HINT()).toBeInTheDocument())
    })

    it('an EXECUTED pre-association leaves the cost field EMPTY — opening is not an operator gesture', async () => {
      await openEditWithPreassociatedItem('EXECUTED', 'EXECUTED')
      await waitFor(() => expect(PREASSOCIATED_HINT()).toBeInTheDocument())
      expect(getCostInput().value).toBe('')
    })

    it('an EXECUTED pre-association then saved unchanged submits cost: null', async () => {
      const { onSubmit } = await openEditWithPreassociatedItem('EXECUTED', 'EXECUTED')
      await waitFor(() => expect(PREASSOCIATED_HINT()).toBeInTheDocument())
      await submit(/guardar cambios/i)
      await waitFor(() => expect(onSubmit).toHaveBeenCalled())
      const payload = onSubmit.mock.calls[0][0] as Record<string, unknown>
      expect(payload.cost).toBeNull()
    })

    it('an EXECUTED pre-association then saved unchanged does NOT submit the items total (2500)', async () => {
      const { onSubmit } = await openEditWithPreassociatedItem('EXECUTED', 'EXECUTED')
      await waitFor(() => expect(PREASSOCIATED_HINT()).toBeInTheDocument())
      await submit(/guardar cambios/i)
      await waitFor(() => expect(onSubmit).toHaveBeenCalled())
      expect((onSubmit.mock.calls[0][0] as { cost?: unknown }).cost).not.toBe(2500)
    })

    // The gate must not swallow the gesture it exists to detect: with the same
    // pre-association open, ticking the OTHER item does prefill, so the field
    // being empty above is "no gesture yet", not "prefill disabled in edit
    // mode".
    it('and the gate is not a blanket disable: ticking a further item in the same session still prefills', async () => {
      listBudgetsByPatientMock.mockResolvedValue({
        data: [
          makeBudget({
            items: [
              makeBudgetItem({
                id: 'item-2500',
                description: ITEM_2500,
                unitPrice: '2500',
                totalPrice: '2500',
                status: 'SCHEDULED',
              }),
              makeBudgetItem({
                id: 'item-1300',
                description: ITEM_1300,
                unitPrice: '1300',
                totalPrice: '1300',
              }),
            ],
          }),
        ],
        total: 1,
      })
      getAppointmentBudgetItemsMock.mockResolvedValue([
        makeAssociatedItem({
          id: 'item-2500',
          description: ITEM_2500,
          unitPrice: '2500',
          totalPrice: '2500',
          status: 'SCHEDULED',
          roles: ['SCHEDULED'],
        }),
      ])
      renderModal({ appointment: makeAppointment({ id: 'apt-1', cost: null }) })
      await waitForOptionsLoaded()
      await waitFor(() => expect(screen.getByText(ITEM_1300)).toBeInTheDocument())
      await waitFor(() => expect(getItemCheckbox(ITEM_2500)).toBeChecked())
      expect(getCostInput().value).toBe('')

      fireEvent.click(getItemCheckbox(ITEM_1300))
      // 2500 (already associated) + 1300 (just ticked).
      await waitFor(() => expect(getCostInput().value).toBe('3800'))
    })
  })

  it('the hint names the items total and appears only while there is one', async () => {
    await openCreateWithItems()
    const hint = () => screen.queryByText(i18n.t('appointments.form.costFromItemsHint', { total: 'USD 2,500.00' }))
    expect(hint()).not.toBeInTheDocument()

    fireEvent.click(getItemCheckbox(ITEM_2500))
    await waitFor(() => expect(hint()).toBeInTheDocument())
    // The key resolves to a real translation rather than echoing itself.
    expect(i18n.t('appointments.form.costFromItemsHint', { total: 'USD 2,500.00' })).not.toBe(
      'appointments.form.costFromItemsHint'
    )

    fireEvent.click(getItemCheckbox(ITEM_2500))
    await waitFor(() => expect(hint()).not.toBeInTheDocument())
  })
})
