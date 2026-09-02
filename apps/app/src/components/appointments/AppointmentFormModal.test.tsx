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

// The doctor <select> is the modal's only <select> in create mode (the
// patient combobox is stubbed above and the status <select> only exists when
// editing, always rendered after this one — see AppointmentFormModal.tsx),
// so `document.querySelector('select')` reaches the same element
// `getAllByRole('combobox')[0]` used to, without the accessible-role scan.
//
// This query used to be `screen.getAllByRole('combobox')[0]`, sitting inside
// this helper's `waitFor` retry loop, which polls every ~50ms — a query cost
// approaching or exceeding that interval turns the loop CPU-bound instead of
// interval-bound, and this helper runs at the top of nearly every test in
// this file (task #398). Measured on this component: ~7.4ms/call for the
// role query (role computation scans the whole mounted tree to find
// candidates, not just the matches — same mechanism as `selectTime()` and
// `selectCalendarDay()` below) vs ~0.05ms/call for the plain DOM query,
// ~150x faster. `getDoctorSelect()` still waits for **enabled**, not just
// present — the <select> is always mounted (only its `disabled` attribute
// toggles), so presence alone would race the modal's form-reset effect
// documented below.
function getDoctorSelect() {
  return document.querySelector('select') as HTMLSelectElement
}

async function waitForOptionsLoaded() {
  // The modal's form-reset effect re-runs whenever `loadingOptions` flips
  // (pre-existing behavior, unrelated to budget items), which re-applies the
  // default values and would clobber a patient selected while doctors are
  // still loading. Waiting for the doctor <select> to become enabled ensures
  // that settling has already happened before a test interacts with the form.
  await waitFor(() => {
    expect(getDoctorSelect()).not.toBeDisabled()
  })
}

async function selectDoctor() {
  await waitForOptionsLoaded()
  fireEvent.change(getDoctorSelect(), { target: { value: 'doc-1' } })
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
    await waitFor(() => expect(screen.getAllByRole('combobox')[0]).not.toBeDisabled())
    expect(input.value).toBe('')
    expect(input.value).not.toBe('150')
    expect(input).not.toBeDisabled()
    expect(screen.getByText('Se registra como pago de esta cita, separado de las entregas, y se aplica a la deuda más antigua del paciente.')).toBeInTheDocument()
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

  it('shows the recorded 0 (not cost) when editing an already-paid appointment with no linked payment', async () => {
    // isPaid can be true (legacy data, or a FIFO edge case) while the server
    // still reports no linked payment — the field must not fall back to
    // `cost` in that case either; it is locked and mirrors recordedPaidAmount
    // verbatim (0 renders as "0", not blank — `0?.toString() || ''`
    // evaluates the truthy non-empty string "0", not the empty-string
    // branch). Never contributes to the payload either way (locked).
    const appointment = makeAppointment({
      cost: 150,
      isPaid: true,
      hasRecordedPayment: false,
      recordedPaidAmount: 0,
    })
    renderModal({ appointment })
    await waitForOptionsLoaded()

    const input = getPaidAmountInput() as HTMLInputElement
    await waitFor(() => expect(input.value).toBe('0'))
    expect(input.value).not.toBe('150')
    expect(input).toBeDisabled()
  })

  it('stays empty when editing an already-paid appointment with recordedPaidAmount entirely absent from the response', async () => {
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
    await waitFor(() => expect(screen.getAllByRole('combobox')[0]).not.toBeDisabled())
    expect(input.value).toBe('')
    expect(input.value).not.toBe('150')
    expect(input).toBeDisabled()
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
  // mechanism as `selectDoctor()`'s doctor <select> query above, one step
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
