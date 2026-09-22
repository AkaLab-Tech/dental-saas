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
