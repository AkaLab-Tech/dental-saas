import type { ComponentProps } from 'react'
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import i18n from 'i18next'
import '@/i18n'
import { AppointmentCompleteModal } from './AppointmentCompleteModal'
import type { AppointmentBudgetItemSummary } from '@/lib/appointment-api'

beforeAll(async () => {
  await i18n.changeLanguage('es')
})

// ============================================================================
// Mocks
// ============================================================================

const getAppointmentBudgetItemsMock = vi.fn()
const completeAppointmentMock = vi.fn()

vi.mock('@/lib/appointment-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/appointment-api')>('@/lib/appointment-api')
  return {
    ...actual,
    getAppointmentBudgetItems: (...args: unknown[]) => getAppointmentBudgetItemsMock(...args),
  }
})

vi.mock('@/stores/appointments.store', () => ({
  useAppointmentsStore: (selector: (s: { completeAppointment: typeof completeAppointmentMock }) => unknown) =>
    selector({ completeAppointment: completeAppointmentMock }),
}))

vi.mock('@/stores/auth.store', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) => selector({ user: { tenant: { currency: 'USD' } } }),
}))

// ============================================================================
// Fixtures
// ============================================================================

function makeItem(overrides: Partial<AppointmentBudgetItemSummary> = {}): AppointmentBudgetItemSummary {
  return {
    id: 'item-1',
    budgetId: 'budget-1',
    description: 'Limpieza dental',
    toothNumber: null,
    quantity: 1,
    unitPrice: '80',
    totalPrice: '80',
    plannedAppointmentType: null,
    status: 'SCHEDULED',
    notes: null,
    order: 0,
    roles: ['SCHEDULED'],
    ...overrides,
  }
}

// A promise-with-external-resolve, used to model a `getAppointmentBudgetItems()`
// request that is still in flight while a test asserts the loading state.
function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const TITLE = 'Completar cita'
const NO_ITEMS_MSG = 'Esta cita no tiene ítems de presupuesto asociados.'
const ALREADY_EXECUTED_BADGE = 'Ya ejecutado'
const LOADING_MSG = 'Cargando ítems de presupuesto...'
const CONFIRM_BTN = 'Marcar completada'

function renderModal(props: Partial<ComponentProps<typeof AppointmentCompleteModal>> = {}) {
  const onClose = vi.fn()
  const onCompleted = vi.fn()
  const utils = render(
    <AppointmentCompleteModal
      isOpen
      appointmentId="apt-1"
      onClose={onClose}
      onCompleted={onCompleted}
      {...props}
    />
  )
  return { onClose, onCompleted, ...utils }
}

// The scheduled-item checkbox is wrapped in a <label>; scope the query to
// that row so it can't be confused with the notes field or another item.
function getScheduledItemCheckbox(description: string) {
  const row = screen.getByText(description).closest('label')
  if (!row) throw new Error(`No scheduled row found for "${description}"`)
  return within(row).getByRole('checkbox')
}

// Already-executed items render as a plain <div> row (not a <label>, since
// they are not interactive).
function getExecutedItemRow(description: string) {
  const row = screen.getByText(description).closest('div')
  if (!row) throw new Error(`No executed row found for "${description}"`)
  return row
}

describe('AppointmentCompleteModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getAppointmentBudgetItemsMock.mockResolvedValue([])
    completeAppointmentMock.mockResolvedValue({ id: 'apt-1', status: 'COMPLETED' })
  })

  it('does not render when isOpen is false', () => {
    renderModal({ isOpen: false })
    expect(screen.queryByText(TITLE)).not.toBeInTheDocument()
  })

  describe('default state', () => {
    it('renders SCHEDULED items with their checkboxes checked by default (opt-out, not opt-in)', async () => {
      getAppointmentBudgetItemsMock.mockResolvedValue([
        makeItem({ id: 'item-1', description: 'Limpieza dental', roles: ['SCHEDULED'] }),
        makeItem({ id: 'item-2', description: 'Extracción de muela', roles: ['SCHEDULED'] }),
      ])

      renderModal()

      await waitFor(() => expect(screen.getByText('Limpieza dental')).toBeInTheDocument())
      expect(getScheduledItemCheckbox('Limpieza dental')).toBeChecked()
      expect(getScheduledItemCheckbox('Extracción de muela')).toBeChecked()
    })
  })

  describe('confirm payload', () => {
    it('excludes an item the doctor unticks, keeping the other default-checked one', async () => {
      getAppointmentBudgetItemsMock.mockResolvedValue([
        makeItem({ id: 'item-1', description: 'Limpieza dental', roles: ['SCHEDULED'] }),
        makeItem({ id: 'item-2', description: 'Extracción de muela', roles: ['SCHEDULED'] }),
      ])

      renderModal()
      await waitFor(() => expect(screen.getByText('Limpieza dental')).toBeInTheDocument())

      fireEvent.click(getScheduledItemCheckbox('Limpieza dental'))
      expect(getScheduledItemCheckbox('Limpieza dental')).not.toBeChecked()
      expect(getScheduledItemCheckbox('Extracción de muela')).toBeChecked()

      fireEvent.click(screen.getByRole('button', { name: CONFIRM_BTN }))

      await waitFor(() => expect(completeAppointmentMock).toHaveBeenCalled())
      expect(completeAppointmentMock).toHaveBeenCalledWith('apt-1', undefined, ['item-2'])
    })

    it('sends all default-checked item ids when nothing is toggled off', async () => {
      getAppointmentBudgetItemsMock.mockResolvedValue([
        makeItem({ id: 'item-1', description: 'Limpieza dental', roles: ['SCHEDULED'] }),
      ])

      renderModal()
      await waitFor(() => expect(screen.getByText('Limpieza dental')).toBeInTheDocument())

      fireEvent.click(screen.getByRole('button', { name: CONFIRM_BTN }))

      await waitFor(() => expect(completeAppointmentMock).toHaveBeenCalled())
      expect(completeAppointmentMock).toHaveBeenCalledWith('apt-1', undefined, ['item-1'])
    })

    it('passes typed notes through to completeAppointment', async () => {
      getAppointmentBudgetItemsMock.mockResolvedValue([])

      renderModal()
      await waitFor(() => expect(screen.getByText(NO_ITEMS_MSG)).toBeInTheDocument())

      // The notes <textarea> has no htmlFor/id pairing with its <label>, so it
      // is queried by role — it is the only textbox in this modal.
      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Paciente toleró bien el procedimiento' } })
      fireEvent.click(screen.getByRole('button', { name: CONFIRM_BTN }))

      await waitFor(() => expect(completeAppointmentMock).toHaveBeenCalled())
      expect(completeAppointmentMock).toHaveBeenCalledWith(
        'apt-1',
        'Paciente toleró bien el procedimiento',
        []
      )
    })
  })

  describe('already-executed items', () => {
    it('renders them disabled and read-only with the already-executed badge, separate from toggleable items', async () => {
      getAppointmentBudgetItemsMock.mockResolvedValue([
        makeItem({ id: 'item-1', description: 'Limpieza dental', roles: ['SCHEDULED'] }),
        makeItem({ id: 'item-2', description: 'Corona dental', status: 'EXECUTED', roles: ['SCHEDULED', 'EXECUTED'] }),
      ])

      renderModal()
      await waitFor(() => expect(screen.getByText('Corona dental')).toBeInTheDocument())

      // Still-scheduled item stays a live, default-checked toggle.
      expect(getScheduledItemCheckbox('Limpieza dental')).toBeChecked()

      // Already-executed item: disabled, pre-checked, badged, and not among
      // the toggleable rows (querying it as a scheduled checkbox must fail).
      const executedRow = getExecutedItemRow('Corona dental')
      const executedCheckbox = within(executedRow).getByRole('checkbox')
      expect(executedCheckbox).toBeDisabled()
      expect(executedCheckbox).toBeChecked()
      expect(within(executedRow).getByText(ALREADY_EXECUTED_BADGE)).toBeInTheDocument()
      expect(() => getScheduledItemCheckbox('Corona dental')).toThrow()

      // Clicking the disabled checkbox must not toggle it into the payload;
      // the still-scheduled item stays in it as its default-checked state.
      fireEvent.click(executedCheckbox)
      fireEvent.click(screen.getByRole('button', { name: CONFIRM_BTN }))

      await waitFor(() => expect(completeAppointmentMock).toHaveBeenCalled())
      expect(completeAppointmentMock).toHaveBeenCalledWith('apt-1', undefined, ['item-1'])
    })
  })

  describe('no associated items', () => {
    it('shows the no-items hint and still allows a notes-only completion', async () => {
      getAppointmentBudgetItemsMock.mockResolvedValue([])

      const { onCompleted } = renderModal()
      await waitFor(() => expect(screen.getByText(NO_ITEMS_MSG)).toBeInTheDocument())

      fireEvent.click(screen.getByRole('button', { name: CONFIRM_BTN }))

      await waitFor(() => expect(completeAppointmentMock).toHaveBeenCalledWith('apt-1', undefined, []))
      await waitFor(() => expect(onCompleted).toHaveBeenCalled())
    })
  })

  describe('loading state', () => {
    it('shows a loading indicator while budget items are being fetched', async () => {
      const deferred = createDeferred<AppointmentBudgetItemSummary[]>()
      getAppointmentBudgetItemsMock.mockReturnValue(deferred.promise)

      renderModal()

      expect(screen.getByText(LOADING_MSG)).toBeInTheDocument()

      deferred.resolve([makeItem({ id: 'item-1', description: 'Limpieza dental', roles: ['SCHEDULED'] })])

      await waitFor(() => expect(screen.getByText('Limpieza dental')).toBeInTheDocument())
      expect(screen.queryByText(LOADING_MSG)).not.toBeInTheDocument()
    })
  })

  describe('error handling', () => {
    it('surfaces an error when fetching budget items fails', async () => {
      getAppointmentBudgetItemsMock.mockRejectedValue(new Error('Network error'))

      renderModal()

      await waitFor(() => expect(screen.getByText('Network error')).toBeInTheDocument())
    })

    it('surfaces an error when completeAppointment fails and does not close the modal', async () => {
      getAppointmentBudgetItemsMock.mockResolvedValue([])
      completeAppointmentMock.mockRejectedValue(new Error('Confirm failed'))

      const { onClose, onCompleted } = renderModal()
      await waitFor(() => expect(screen.getByText(NO_ITEMS_MSG)).toBeInTheDocument())

      fireEvent.click(screen.getByRole('button', { name: CONFIRM_BTN }))

      await waitFor(() => expect(screen.getByText('Confirm failed')).toBeInTheDocument())
      expect(onClose).not.toHaveBeenCalled()
      expect(onCompleted).not.toHaveBeenCalled()
      // The modal itself is still on screen.
      expect(screen.getByText(TITLE)).toBeInTheDocument()
    })
  })
})
