import type { ComponentProps } from 'react'
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import i18n from 'i18next'
import '@/i18n'
import { AppointmentFormModal } from './AppointmentFormModal'
import type { Appointment, AppointmentBudgetItemSummary } from '../../lib/appointment-api'
import type { Budget, BudgetItemWithHolders as BudgetItem } from '../../lib/budget-api'

/**
 * Task #698: once the operator deliberately empties the cost field, ticking a
 * budget item must not refill it. The block is read from the input's own change
 * event, never from emptiness (the identity reset writes '' too), and is per
 * modal session. The mocks mirror AppointmentFormModal.test.tsx; this file is
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
    appointments: [],
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
    money: { total: 100, billed: 50, covered: 30, remaining: 20, notBilled: 50 },
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

type ModalProps = ComponentProps<typeof AppointmentFormModal>

function renderModal(props: Partial<ModalProps> = {}) {
  const onClose = vi.fn()
  const onSubmit = vi.fn().mockResolvedValue(undefined)
  const rendered = render(<AppointmentFormModal isOpen onClose={onClose} onSubmit={onSubmit} {...props} />)
  /** Re-renders the same tree with different props (close / reopen / switch record). */
  const update = (next: Partial<ModalProps>) =>
    rendered.rerender(<AppointmentFormModal isOpen onClose={onClose} onSubmit={onSubmit} {...next} />)
  return { ...rendered, update, onSubmit }
}

async function waitForOptionsLoaded() {
  await waitFor(() => {
    expect(screen.getByLabelText('Doctor *')).not.toBeDisabled()
  })
}

function getCostInput() {
  const container = screen.getByText('Costo ($)').parentElement
  if (!container) throw new Error('No cost container found')
  return within(container).getByRole('spinbutton') as HTMLInputElement
}

function getItemCheckbox(description: string) {
  const row = screen.getByText(description).closest('label')
  if (!row) throw new Error(`No row found for "${description}"`)
  return within(row).getByRole('checkbox')
}

const ITEM_2500 = 'Corona 2500'
const ITEM_1300 = 'Perno 1300'

/** Hint under the cost field: renders only while the items' total is above zero. */
const itemsHint = (total: string) =>
  screen.queryByText(i18n.t('appointments.form.costFromItemsHint', { total }))

/** Ids of the items linked (SCHEDULED) to each appointment id, read live by the mock. */
let linkedItemIds: Record<string, string[]> = {}

const ITEMS = {
  'item-2500': { description: ITEM_2500, price: '2500' },
  'item-1300': { description: ITEM_1300, price: '1300' },
} as const

async function openEdit(appointment: Appointment) {
  const modal = renderModal({ appointment })
  await waitForOptionsLoaded()
  await waitFor(() => expect(screen.getByText(ITEM_1300)).toBeInTheDocument())
  return modal
}

describe('AppointmentFormModal — a deliberate clear of the cost field (#698)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    linkedItemIds = {}
    getDoctorsMock.mockResolvedValue([mockDoctor])
    getPatientsMock.mockResolvedValue([mockPatientRecord])
    getAppointmentByIdMock.mockImplementation(() => Promise.resolve(makeAppointment()))
    getAppointmentBudgetItemsMock.mockImplementation((id: string) =>
      Promise.resolve(
        (linkedItemIds[id] ?? []).map((itemId) =>
          makeAssociatedItem({
            id: itemId,
            description: ITEMS[itemId as keyof typeof ITEMS].description,
            unitPrice: ITEMS[itemId as keyof typeof ITEMS].price,
            totalPrice: ITEMS[itemId as keyof typeof ITEMS].price,
            status: 'SCHEDULED',
            roles: ['SCHEDULED'],
          })
        )
      )
    )
    listBudgetsByPatientMock.mockImplementation(() =>
      Promise.resolve({
        data: [
          makeBudget({
            items: (Object.keys(ITEMS) as (keyof typeof ITEMS)[]).map((id) =>
              makeBudgetItem({
                id,
                description: ITEMS[id].description,
                unitPrice: ITEMS[id].price,
                totalPrice: ITEMS[id].price,
                // A linked item is SCHEDULED (the link is what keeps it listed).
                status: Object.values(linkedItemIds).some((ids) => ids.includes(id)) ? 'SCHEDULED' : 'PENDING',
              })
            ),
          }),
        ],
        total: 1,
      })
    )
  })

  it('1. a deliberate clear survives the next toggle: the field stays empty after ticking an item', async () => {
    await openEdit(makeAppointment({ cost: 2500 }))
    expect(getCostInput().value).toBe('2500')

    fireEvent.change(getCostInput(), { target: { value: '' } })
    expect(getCostInput().value).toBe('')

    fireEvent.click(getItemCheckbox(ITEM_1300))
    // The tick landed and the 1300 total is on the table, so "still empty" is the gate.
    await waitFor(() => expect(getItemCheckbox(ITEM_1300)).toBeChecked())
    await waitFor(() => expect(itemsHint('USD 1,300.00')).toBeInTheDocument())
    expect(getCostInput().value).toBe('')
  })

  it('2. VACUITY: the same tick prefills 1300 when no clear happened', async () => {
    await openEdit(makeAppointment({ cost: null }))
    expect(getCostInput().value).toBe('')

    fireEvent.click(getItemCheckbox(ITEM_1300))
    await waitFor(() => expect(getCostInput().value).toBe('1300'))
  })

  it('3. the detection reads the gesture, not the emptiness: a cold open with cost null still prefills', async () => {
    await openEdit(makeAppointment({ cost: null }))
    // Emptiness here comes from the identity reset, not from the operator.
    expect(getCostInput().value).toBe('')

    fireEvent.click(getItemCheckbox(ITEM_2500))
    await waitFor(() => expect(getCostInput().value).toBe('2500'))
  })

  it('4. the prefill\'s own writes are not clears: a second toggle updates 2500 to 3800', async () => {
    await openEdit(makeAppointment({ cost: null }))

    fireEvent.click(getItemCheckbox(ITEM_2500))
    await waitFor(() => expect(getCostInput().value).toBe('2500'))

    fireEvent.click(getItemCheckbox(ITEM_1300))
    await waitFor(() => expect(getCostInput().value).toBe('3800'))
  })

  it('5. the block is per modal session: close, reopen the same appointment, tick -> prefills', async () => {
    const appointment = makeAppointment({ cost: 2500 })
    const { update } = await openEdit(appointment)

    fireEvent.change(getCostInput(), { target: { value: '' } })
    fireEvent.click(getItemCheckbox(ITEM_1300))
    await waitFor(() => expect(itemsHint('USD 1,300.00')).toBeInTheDocument())
    expect(getCostInput().value).toBe('')

    update({ isOpen: false, appointment })
    await waitFor(() => expect(screen.queryByText('Costo ($)')).not.toBeInTheDocument())

    // Reopen with a costless record so the field is empty from the reset alone.
    const reopened = makeAppointment({ cost: null })
    update({ isOpen: true, appointment: reopened })
    await waitForOptionsLoaded()
    await waitFor(() => expect(screen.getByText(ITEM_1300)).toBeInTheDocument())
    expect(getCostInput().value).toBe('')

    fireEvent.click(getItemCheckbox(ITEM_1300))
    await waitFor(() => expect(getCostInput().value).toBe('1300'))
  })

  it('6. #621 path A: arming on appointment X does not leak into appointment Y with a pre-associated item', async () => {
    const x = makeAppointment({ id: 'apt-x', cost: null })
    const y = makeAppointment({ id: 'apt-y', patientId: 'patient-2', cost: null })
    const { update } = await openEdit(x)

    // Arm the prefill on X.
    fireEvent.click(getItemCheckbox(ITEM_1300))
    await waitFor(() => expect(getCostInput().value).toBe('1300'))

    // A different patient, so the selection is re-seeded from Y's own links.
    // Y already carries the 2500 item (a plan made from a budget).
    linkedItemIds = { 'apt-y': ['item-2500'] }
    update({ appointment: y })
    // Y's linked item (2500) is on the table, so an empty field is the gate.
    await waitFor(() => expect(itemsHint('USD 2,500.00')).toBeInTheDocument())
    await waitFor(() => expect(getItemCheckbox(ITEM_2500)).toBeChecked())
    expect(getCostInput().value).toBe('')

    // Y is not dead: a real tick on Y still prefills (2500 linked + 1300 ticked).
    fireEvent.click(getItemCheckbox(ITEM_1300))
    await waitFor(() => expect(getCostInput().value).toBe('3800'))
  })

  // #621 path B (the `!isOpen` disarm) has no test of its own on purpose: every
  // reopen re-runs the identity reset, so deleting the assignments in the
  // `!isOpen` branch alone leaves a close-and-reopen test green. A test that
  // cannot be seen to fail is not shipped; test 6 covers the observable site.
})
