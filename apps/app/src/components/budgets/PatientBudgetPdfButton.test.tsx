/**
 * The control is a split button since #541: the PRIMARY action downloads the
 * patient's whole treatment plan as one document (`downloadPatientBudgetsPdf`,
 * keyed by patientId), and the chevron opens a menu of the individual budgets
 * (`downloadBudgetPdf`, keyed by budget id). Before #541 the primary action
 * downloaded a single budget and the menu only existed with more than one
 * budget; the tests below were rewritten, not relaxed, for that inversion.
 *
 * The ownership tests are the load-bearing ones. The budgets store is global,
 * so its list can still be the PREVIOUS patient's (#539) — and the whole-plan
 * request is addressed by patientId, so a control rendered one render too
 * early exports a different patient's treatment and prices.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import i18n from 'i18next'
import '@/i18n'
import { PatientBudgetPdfButton } from './PatientBudgetPdfButton'
import { useBudgetsStore } from '@/stores/budgets.store'
import type { Budget } from '@/lib/budget-api'
import { Permission } from '@dental/shared'

beforeAll(async () => {
  await i18n.changeLanguage('es')
})

const canMock = vi.fn()
const downloadBudgetPdfMock = vi.fn()
const downloadPatientBudgetsPdfMock = vi.fn()

vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => ({
    can: (perm: Permission) => canMock(perm),
    canAny: () => false,
    canAll: () => false,
  }),
}))

vi.mock('@/stores/auth.store', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({ user: { tenant: { currency: 'USD' } } }),
}))

vi.mock('@/lib/pdf-api', () => ({
  downloadBudgetPdf: (budgetId: string) => downloadBudgetPdfMock(budgetId),
  downloadPatientBudgetsPdf: (patientId: string) => downloadPatientBudgetsPdfMock(patientId),
}))

// Every field that identifies a budget differs, so a picker that always
// returns the first (or last) item is detectable.
function makeBudget(overrides: Partial<Budget> = {}): Budget {
  return {
    id: 'budget-1',
    tenantId: 'tenant-1',
    patientId: 'patient-A',
    createdById: 'user-1',
    status: 'APPROVED',
    notes: null,
    validUntil: '2026-12-31T00:00:00Z',
    totalAmount: '250.50',
    money: { total: 100, billed: 50, covered: 30, remaining: 20, notBilled: 50 },
    publicToken: null,
    publicTokenExpiresAt: null,
    isActive: true,
    createdAt: '2026-03-15T12:00:00Z',
    updatedAt: '2026-03-15T12:00:00Z',
    items: [],
    ...overrides,
  }
}

const newest = makeBudget({
  id: 'budget-newest',
  totalAmount: '999.00',
  status: 'DRAFT',
  createdAt: '2026-08-20T12:00:00Z',
})
const middle = makeBudget({
  id: 'budget-middle',
  totalAmount: '420.75',
  status: 'PARTIAL',
  createdAt: '2026-06-10T12:00:00Z',
})
const oldest = makeBudget({
  id: 'budget-oldest',
  totalAmount: '150.00',
  status: 'COMPLETED',
  createdAt: '2026-01-05T12:00:00Z',
})

function seed(budgets: Budget[], patientId: string | null = 'patient-A', loading = false) {
  useBudgetsStore.setState({ budgets, currentPatientId: patientId, loading })
}

function renderButton(patientId = 'patient-A', onError = vi.fn()) {
  render(<PatientBudgetPdfButton patientId={patientId} onError={onError} />)
  return onError
}

const planButton = () => screen.getByRole('button', { name: /Exportar plan de tratamiento/ })
const chevron = () => screen.getByRole('button', { name: /Elige qué presupuesto exportar/ })

/** Clicks every control on screen; used where nothing at all may be exported. */
function clickEverything() {
  for (const button of screen.queryAllByRole('button')) {
    try {
      fireEvent.click(button)
    } catch {
      // a control with nothing to export may throw; the assertions still apply
    }
  }
}

describe('PatientBudgetPdfButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    canMock.mockReturnValue(true)
    downloadBudgetPdfMock.mockResolvedValue(undefined)
    downloadPatientBudgetsPdfMock.mockResolvedValue(undefined)
    seed([])
  })

  it('with one budget, the primary button downloads the whole plan for this patient, not that budget', async () => {
    seed([middle])
    renderButton()
    fireEvent.click(planButton())
    await waitFor(() => expect(downloadPatientBudgetsPdfMock).toHaveBeenCalledWith('patient-A'))
    expect(downloadPatientBudgetsPdfMock).toHaveBeenCalledTimes(1)
    // the pre-#541 behaviour: this must NOT be a single-budget download
    expect(downloadBudgetPdfMock).not.toHaveBeenCalled()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('with one budget, the menu is still offered and lists that single budget', () => {
    // Pre-#541 the menu only existed with more than one budget.
    seed([middle])
    renderButton()
    fireEvent.click(chevron())
    const items = within(screen.getByRole('menu')).getAllByRole('menuitem')
    expect(items).toHaveLength(1)
    expect(downloadPatientBudgetsPdfMock).not.toHaveBeenCalled()
    expect(downloadBudgetPdfMock).not.toHaveBeenCalled()
  })

  it('with two budgets, clicking the chevron downloads nothing and opens a menu with one row per budget', () => {
    seed([newest, oldest])
    renderButton()
    fireEvent.click(chevron())
    expect(downloadBudgetPdfMock).not.toHaveBeenCalled()
    expect(downloadPatientBudgetsPdfMock).not.toHaveBeenCalled()
    const items = within(screen.getByRole('menu')).getAllByRole('menuitem')
    expect(items).toHaveLength(2)
  })

  it('with two budgets, the primary button still downloads the whole plan in one call', async () => {
    seed([newest, oldest])
    renderButton()
    fireEvent.click(planButton())
    await waitFor(() => expect(downloadPatientBudgetsPdfMock).toHaveBeenCalledWith('patient-A'))
    expect(downloadPatientBudgetsPdfMock).toHaveBeenCalledTimes(1)
    expect(downloadBudgetPdfMock).not.toHaveBeenCalled()
  })

  it('with two budgets, the user picks: the second row downloads the second budget id', async () => {
    seed([newest, oldest])
    renderButton()
    fireEvent.click(chevron())
    const items = screen.getAllByRole('menuitem')
    fireEvent.click(items[1])
    await waitFor(() => expect(downloadBudgetPdfMock).toHaveBeenCalledWith('budget-oldest'))
    expect(downloadBudgetPdfMock).toHaveBeenCalledTimes(1)
    expect(downloadBudgetPdfMock).not.toHaveBeenCalledWith('budget-newest')
    expect(downloadPatientBudgetsPdfMock).not.toHaveBeenCalled()
    // the menu closes after choosing
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('with three budgets, each row downloads its own id', async () => {
    seed([newest, middle, oldest])
    renderButton()
    fireEvent.click(chevron())
    fireEvent.click(screen.getAllByRole('menuitem')[1])
    await waitFor(() => expect(downloadBudgetPdfMock).toHaveBeenCalledTimes(1))
    expect(downloadBudgetPdfMock).toHaveBeenLastCalledWith('budget-middle')
    fireEvent.click(chevron())
    fireEvent.click(screen.getAllByRole('menuitem')[0])
    await waitFor(() => expect(downloadBudgetPdfMock).toHaveBeenCalledTimes(2))
    expect(downloadBudgetPdfMock).toHaveBeenLastCalledWith('budget-newest')
    expect(downloadPatientBudgetsPdfMock).not.toHaveBeenCalled()
  })

  it('each menu row shows its own total, creation date and status, under a header naming them individual budgets', () => {
    seed([newest, oldest])
    renderButton()
    fireEvent.click(chevron())
    expect(screen.getByRole('menu')).toHaveTextContent('Presupuestos individuales')
    const [first, second] = screen.getAllByRole('menuitem')
    expect(first).toHaveTextContent('USD 999.00')
    expect(first).toHaveTextContent(/Creado el 20.*ago.*2026/)
    expect(first).toHaveTextContent('Borrador')
    expect(second).toHaveTextContent('USD 150.00')
    expect(second).toHaveTextContent(/Creado el 5.*ene.*2026/)
    expect(second).toHaveTextContent('Completado')
  })

  it('with no budgets, renders nothing and exports nothing', () => {
    seed([])
    renderButton()
    clickEverything()
    expect(downloadBudgetPdfMock).not.toHaveBeenCalled()
    expect(downloadPatientBudgetsPdfMock).not.toHaveBeenCalled()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('without BUDGETS_VIEW, renders nothing even when budgets exist', () => {
    canMock.mockImplementation((p) => p !== Permission.BUDGETS_VIEW)
    seed([newest, oldest])
    renderButton()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(downloadBudgetPdfMock).not.toHaveBeenCalled()
    expect(downloadPatientBudgetsPdfMock).not.toHaveBeenCalled()
  })

  it('asks for BUDGETS_VIEW specifically', () => {
    seed([middle])
    renderButton()
    expect(canMock).toHaveBeenCalledWith(Permission.BUDGETS_VIEW)
  })

  it("does not leak another patient's budgets onto this record", () => {
    // Isolates the per-budget owner filter: the store claims its list is for
    // patient B, but every row in it belongs to patient A.
    seed([newest, oldest], 'patient-B')
    renderButton('patient-B')
    clickEverything()
    expect(downloadBudgetPdfMock).not.toHaveBeenCalled()
    expect(downloadPatientBudgetsPdfMock).not.toHaveBeenCalled()
    expect(screen.queryAllByRole('menuitem')).toEqual([])
    expect(screen.queryAllByRole('button')).toEqual([])
  })

  it("does not export the previous patient's budget after the new patient's fetch failed", () => {
    // Post-catch state of fetchBudgetsByPatient: currentPatientId already
    // advanced to B, loading=false, but budgets still holds patient A's list.
    const stale = makeBudget({ id: 'budget-stale-A', patientId: 'patient-A' })
    useBudgetsStore.setState({
      budgets: [stale],
      currentPatientId: 'patient-B',
      loading: false,
      error: 'Error al cargar los presupuestos',
    })
    renderButton('patient-B')
    clickEverything()
    expect(downloadBudgetPdfMock).not.toHaveBeenCalled()
    expect(downloadBudgetPdfMock).not.toHaveBeenCalledWith('budget-stale-A')
    expect(downloadPatientBudgetsPdfMock).not.toHaveBeenCalled()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('renders nothing while the list for this patient is still loading', () => {
    seed([newest], 'patient-A', true)
    renderButton('patient-A')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(downloadPatientBudgetsPdfMock).not.toHaveBeenCalled()
  })

  it('offers no whole-plan export while a refetch for this patient is in flight', () => {
    // Isolates the `!loading` half of the ownership guard: the list already
    // belongs to this patient, so the per-budget owner filter cannot help.
    // The control appearing is the only signal the operator gets that what is
    // on screen is this patient's current list, and the whole-plan PDF is
    // built server-side from whatever exists at that instant.
    useBudgetsStore.setState({
      budgets: [makeBudget({ id: 'budget-B-1', patientId: 'patient-B' })],
      currentPatientId: 'patient-B',
      loading: true,
      error: null,
    })
    renderButton('patient-B')
    clickEverything()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(downloadPatientBudgetsPdfMock).not.toHaveBeenCalled()
    expect(downloadBudgetPdfMock).not.toHaveBeenCalled()
  })

  it('offers no whole-plan export while the store says its list was fetched for another patient', () => {
    // Isolates the `currentPatientId === patientId` half: these budgets DO
    // belong to the rendered patient (so the owner filter passes), but the
    // list on screen was loaded for someone else, so it is not known to be
    // this patient's complete list. The whole-plan request is addressed by
    // patientId alone, so exporting from here would hand over a document the
    // operator never saw listed.
    useBudgetsStore.setState({
      budgets: [makeBudget({ id: 'budget-B-1', patientId: 'patient-B' })],
      currentPatientId: 'patient-A',
      loading: false,
      error: null,
    })
    renderButton('patient-B')
    clickEverything()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(downloadPatientBudgetsPdfMock).not.toHaveBeenCalled()
    expect(downloadBudgetPdfMock).not.toHaveBeenCalled()
  })

  it("offers nothing in the intermediate render where the store still holds the previous patient's list", () => {
    // The render between navigating to patient B and B's list arriving:
    // currentPatientId is already B, loading is true, budgets are still A's.
    // Both halves of the guard and the owner filter all reject this one; it is
    // here because it is the state #539 actually produced.
    useBudgetsStore.setState({
      budgets: [makeBudget({ id: 'budget-A-1', patientId: 'patient-A' })],
      currentPatientId: 'patient-B',
      loading: true,
      error: null,
    })
    renderButton('patient-B')
    clickEverything()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(downloadPatientBudgetsPdfMock).not.toHaveBeenCalled()
    expect(downloadBudgetPdfMock).not.toHaveBeenCalled()
  })

  it('never addresses the whole-plan export to any id but the rendered patient', async () => {
    // The button's argument is the prop, never the store's currentPatientId.
    seed([makeBudget({ id: 'budget-C-1', patientId: 'patient-C' })], 'patient-C')
    renderButton('patient-C')
    fireEvent.click(planButton())
    await waitFor(() => expect(downloadPatientBudgetsPdfMock).toHaveBeenCalledTimes(1))
    expect(downloadPatientBudgetsPdfMock).toHaveBeenCalledWith('patient-C')
    expect(downloadPatientBudgetsPdfMock).not.toHaveBeenCalledWith('patient-A')
  })

  it('reports a failed whole-plan download through onError with the translated message', async () => {
    downloadPatientBudgetsPdfMock.mockRejectedValue(new Error('boom'))
    seed([middle])
    const onError = renderButton()
    fireEvent.click(planButton())
    await waitFor(() =>
      expect(onError).toHaveBeenCalledWith('Error al descargar el plan de tratamiento')
    )
  })

  it('reports a failed single-budget download through onError with its own message', async () => {
    downloadBudgetPdfMock.mockRejectedValue(new Error('boom'))
    seed([middle])
    const onError = renderButton()
    fireEvent.click(chevron())
    fireEvent.click(screen.getAllByRole('menuitem')[0])
    await waitFor(() => expect(onError).toHaveBeenCalledWith('Error al descargar el presupuesto'))
  })
})
