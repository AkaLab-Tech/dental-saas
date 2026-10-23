import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import i18n from 'i18next'
import '@/i18n'
import { AppointmentCard } from './AppointmentCard'
import type { Appointment } from '@/lib/appointment-api'

beforeAll(async () => {
  await i18n.changeLanguage('es')
})

// ============================================================================
// Mocks
// ============================================================================

vi.mock('@/stores/auth.store', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({ user: { tenant: { currency: 'USD' } } }),
}))

vi.mock('@/lib/pdf-api', () => ({
  downloadAppointmentPdf: vi.fn(),
}))

// ============================================================================
// Fixtures
// ============================================================================

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

function renderCard(appointment: Appointment) {
  const onEdit = vi.fn()
  const onDelete = vi.fn()
  const onRestore = vi.fn()
  const onComplete = vi.fn()
  const utils = render(
    <AppointmentCard
      appointment={appointment}
      onEdit={onEdit}
      onDelete={onDelete}
      onRestore={onRestore}
      onComplete={onComplete}
    />
  )
  return { onEdit, onDelete, onRestore, onComplete, ...utils }
}

// Regression coverage for task #323 (i18n migration): the actions-menu
// trigger's aria-label used to be a hardcoded Spanish literal ("Más
// opciones"); it is now wired through t('appointments.moreOptions'). This
// pins down that the real es locale resource still resolves to that exact
// string, and that the button remains queryable/functional by that name.
describe('AppointmentCard — actions menu trigger label (i18n)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the actions-menu trigger with the translated "Más opciones" aria-label', () => {
    renderCard(makeAppointment())

    expect(screen.getByRole('button', { name: 'Más opciones' })).toBeInTheDocument()
  })

  it('opens the actions menu (revealing "Editar") when the translated-label trigger is clicked', () => {
    renderCard(makeAppointment())

    expect(screen.queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Más opciones' }))

    expect(screen.getByRole('button', { name: 'Editar' })).toBeInTheDocument()
  })
})

// Task #240: the cost row now renders the shared PaidStatusBadge instead of
// a hard-coded "(Pagado)"/"(Pendiente)" Spanish suffix. AppointmentCard never
// passes paidAmount, so it is binary (paid/pending only — never partial).
describe('AppointmentCard — cost row and paid status badge (#240)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not render a cost row when cost is null', () => {
    renderCard(makeAppointment({ cost: null }))

    expect(screen.queryByText('Pagado')).not.toBeInTheDocument()
    expect(screen.queryByText('Pendiente')).not.toBeInTheDocument()
  })

  it('shows the formatted cost and the "Pagado" badge when isPaid is true', () => {
    renderCard(makeAppointment({ cost: 100, isPaid: true }))

    expect(screen.getByText('USD 100.00')).toBeInTheDocument()
    expect(screen.getByText('Pagado')).toBeInTheDocument()
    expect(screen.queryByText('Pendiente')).not.toBeInTheDocument()
  })

  it('shows the formatted cost and the "Pendiente" badge when isPaid is false', () => {
    renderCard(makeAppointment({ cost: 100, isPaid: false }))

    expect(screen.getByText('USD 100.00')).toBeInTheDocument()
    expect(screen.getByText('Pendiente')).toBeInTheDocument()
    expect(screen.queryByText('Pagado')).not.toBeInTheDocument()
  })

  it('never shows the "Parcial" badge — AppointmentCard does not pass paidAmount', () => {
    renderCard(makeAppointment({ cost: 100, isPaid: false }))

    expect(screen.queryByText('Parcial')).not.toBeInTheDocument()
  })

  it('no longer renders the old hard-coded parenthesised paid/pending suffix', () => {
    renderCard(makeAppointment({ cost: 100, isPaid: true }))

    expect(screen.queryByText('(Pagado)')).not.toBeInTheDocument()
    expect(screen.queryByText('(Pendiente)')).not.toBeInTheDocument()
  })
})

// ============================================================================
// Task #619: the agenda shows what a visit bills by executed budget items
// ============================================================================
//
// Before this task the card rendered `appointment.cost` and nothing else, so a
// visit whose charge comes from executed budget items — the ordinary case for
// budgeted treatment — showed no amount at all in the day's agenda.
//
// The figures come from the server (`budgetItems`, the same aggregate
// `getAppointmentsByPatient` feeds the patient record with). The card formats
// them and derives nothing: it reads `budgetItems.cost` and `budgetItems.count`
// only, never sums an item list, never touches paidAmount/outstanding.
//
// The money region is one wrapper, `data-testid="appointment-amount"`, so
// "shows no amount" can be asserted as a chosen form rather than as the absence
// of a particular number.
//
// The fixture — 2 executed items totalling 4000 on a costless visit — is the
// same one the server half asserts in
// apps/api/src/routes/appointments-agenda-executed-items-amount.test.ts.
describe('AppointmentCard — the amount of a visit billed by executed budget items (#619)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const executedItems = { count: 2, cost: 4000, paidAmount: 0, outstanding: 4000 }

  // --------------------------------------------------------------------------
  // Guard 1 — a visit billing by executed items shows that amount
  // --------------------------------------------------------------------------

  it('guard 1: a costless visit with 2 executed items of 4000 shows the executed-items line', () => {
    renderCard(makeAppointment({ cost: null, budgetItems: executedItems }))

    expect(
      screen.getByText('Ítems de presupuesto ejecutados en esta cita: 2 · USD 4,000.00')
    ).toBeInTheDocument()
  })

  it('guard 1: that visit renders a money region at all (it used to render none)', () => {
    renderCard(makeAppointment({ cost: null, budgetItems: executedItems }))

    expect(screen.getByTestId('appointment-amount')).toBeInTheDocument()
  })

  // --------------------------------------------------------------------------
  // Guard 2 — a typed cost still shows that amount, unchanged
  // --------------------------------------------------------------------------

  it('guard 2: a visit billing by a typed cost of 100 still shows that cost and its badge', () => {
    renderCard(makeAppointment({ cost: 100, isPaid: false }))

    expect(screen.getByText('USD 100.00')).toBeInTheDocument()
    expect(screen.getByText('Pendiente')).toBeInTheDocument()
  })

  it('guard 2: a visit billing by a typed cost shows no executed-items line', () => {
    renderCard(makeAppointment({ cost: 100, isPaid: false }))

    expect(
      screen.queryByText(/Ítems de presupuesto ejecutados en esta cita/)
    ).not.toBeInTheDocument()
  })

  // --------------------------------------------------------------------------
  // Guard 3 — a visit with neither renders no money region
  // --------------------------------------------------------------------------

  it('guard 3: a visit with neither a cost nor executed items renders no money region', () => {
    renderCard(makeAppointment({ cost: null, budgetItems: undefined }))

    expect(screen.queryByTestId('appointment-amount')).not.toBeInTheDocument()
  })

  // --------------------------------------------------------------------------
  // Guard 4 (client half) — the agenda card's own figure for the fixture
  // --------------------------------------------------------------------------
  //
  // Stated as this card's own literal. The patient record's own literal for the
  // same fixture is asserted independently in
  // apps/app/src/pages/patients/PatientAppointmentsSection.test.tsx ("#619: the
  // patient record's own figure…"), and the two server reads that feed them in
  // the API test named above. Nothing here is asserted equal to another
  // surface's output, so both being wrong together cannot satisfy the guard.

  it('guard 4: for the 2-items/4000 fixture the agenda card states 2 items and USD 4,000.00', () => {
    renderCard(makeAppointment({ cost: null, budgetItems: executedItems }))

    expect(
      screen.getByText('Ítems de presupuesto ejecutados en esta cita: 2 · USD 4,000.00')
    ).toBeInTheDocument()
  })

  // --------------------------------------------------------------------------
  // Guard 5 — the card does no arithmetic
  // --------------------------------------------------------------------------

  it('guard 5: with a cost that disagrees with the count, the card shows the cost, not count × anything', () => {
    // 3 items whose aggregate cost the server reports as 100. A card that
    // derived the total from the items would show 300, or a per-item price.
    renderCard(
      makeAppointment({
        cost: null,
        budgetItems: { count: 3, cost: 100, paidAmount: 0, outstanding: 0 },
      })
    )

    expect(
      screen.getByText('Ítems de presupuesto ejecutados en esta cita: 3 · USD 100.00')
    ).toBeInTheDocument()
    expect(screen.queryByText(/USD 300\.00/)).not.toBeInTheDocument()
    expect(screen.queryByText(/USD 33\.33/)).not.toBeInTheDocument()
  })

  it('guard 5: paidAmount and outstanding that contradict the cost do not move the figure shown', () => {
    // paidAmount + outstanding = 1000, nowhere near the 4000 cost. The card
    // must still show 4000: it reads `cost`, and never adds the split up.
    renderCard(
      makeAppointment({
        cost: null,
        budgetItems: { count: 2, cost: 4000, paidAmount: 999, outstanding: 1 },
      })
    )

    expect(
      screen.getByText('Ítems de presupuesto ejecutados en esta cita: 2 · USD 4,000.00')
    ).toBeInTheDocument()
    expect(screen.queryByText(/USD 1,000\.00/)).not.toBeInTheDocument()
  })

  it('guard 5: the card shows no covered/outstanding split — it reads neither field', () => {
    renderCard(
      makeAppointment({
        cost: null,
        budgetItems: { count: 2, cost: 4000, paidAmount: 999, outstanding: 1 },
      })
    )

    expect(screen.queryByText(/Cubierto/)).not.toBeInTheDocument()
    expect(screen.queryByText(/USD 999\.00/)).not.toBeInTheDocument()
  })

  // --------------------------------------------------------------------------
  // Both authorities at once: the server decides, the card shows what it sent
  // --------------------------------------------------------------------------
  //
  // A cost of 0 is not an authority (#590 supersedes only above zero), so the
  // server may legitimately send a zero cost alongside executed items. The card
  // renders both blocks rather than choosing between them.
  it('a zero cost sent alongside executed items shows both the 0 and the items figure', () => {
    renderCard(makeAppointment({ cost: 0, budgetItems: executedItems }))

    expect(screen.getByText('USD 0.00')).toBeInTheDocument()
    expect(
      screen.getByText('Ítems de presupuesto ejecutados en esta cita: 2 · USD 4,000.00')
    ).toBeInTheDocument()
  })
})
