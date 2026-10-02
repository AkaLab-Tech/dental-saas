import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import i18n from 'i18next'
import '@/i18n'
import { LabworkCard } from './LabworkCard'
import type { Labwork } from '@/lib/labwork-api'
import { downloadLabworkPdf } from '@/lib/pdf-api'
import { Permission } from '@dental/shared'

beforeAll(async () => {
  await i18n.changeLanguage('es')
})

// ============================================================================
// Mocks
// ============================================================================

const canMock = vi.fn()

vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => ({
    can: (perm: unknown) => canMock(perm),
    canAny: () => false,
    canAll: () => false,
  }),
}))

vi.mock('@/stores/auth.store', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({ user: { tenant: { currency: 'USD' } } }),
}))

vi.mock('@/lib/pdf-api', () => ({
  downloadLabworkPdf: vi.fn(),
}))

// ============================================================================
// Helpers
// ============================================================================

function makeLabwork(overrides: Partial<Labwork> = {}): Labwork {
  return {
    id: 'labwork-1',
    tenantId: 'tenant-1',
    patientId: 'patient-1',
    appointmentId: null,
    priceIncludedInAppointment: false,
    lab: 'Lab Dental Central',
    phoneNumber: null,
    date: '2026-01-15T00:00:00Z',
    note: null,
    price: 100,
    isPaid: false,
    isDelivered: false,
    status: 'PENDING',
    doctorIds: [],
    doctors: [],
    isActive: true,
    deletedAt: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    patient: null,
    ...overrides,
  }
}

function renderCard(labwork: Labwork) {
  const onEdit = vi.fn()
  const onDelete = vi.fn()
  const onStatusChange = vi.fn()
  const utils = render(
    <MemoryRouter>
      <LabworkCard labwork={labwork} onEdit={onEdit} onDelete={onDelete} onStatusChange={onStatusChange} />
    </MemoryRouter>
  )
  return { onEdit, onDelete, onStatusChange, ...utils }
}

describe('LabworkCard — lab phone', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    canMock.mockReturnValue(true)
  })

  it('renders a tel: link with the phone number when phoneNumber is present', () => {
    renderCard(makeLabwork({ phoneNumber: '+598 99 123 456' }))

    const link = screen.getByRole('link', { name: '+598 99 123 456' })
    expect(link).toHaveAttribute('href', 'tel:+598 99 123 456')
  })

  it('does not render a tel: link when phoneNumber is null', () => {
    // Unlinked fixture: a patient-linked priced labwork now renders a
    // "view payments" <Link> (#470), which this "no links at all" assertion
    // would otherwise trip over. The assertion itself is unchanged.
    renderCard(makeLabwork({ phoneNumber: null, patientId: null }))

    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('stops click propagation on the phone link so it does not bubble to ancestor click handlers', () => {
    const parentClick = vi.fn()
    render(
      // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events
      <MemoryRouter>
        <div onClick={parentClick}>
          <LabworkCard
            labwork={makeLabwork({ phoneNumber: '+598 99 123 456' })}
            onEdit={vi.fn()}
            onDelete={vi.fn()}
          />
        </div>
      </MemoryRouter>
    )

    fireEvent.click(screen.getByRole('link', { name: '+598 99 123 456' }))

    expect(parentClick).not.toHaveBeenCalled()
  })
})

describe('LabworkCard — download order (PDF)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    canMock.mockReturnValue(true)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders the "Descargar orden" action when the user can view labworks', () => {
    renderCard(makeLabwork())

    expect(screen.getByRole('button', { name: 'Descargar orden' })).toBeInTheDocument()
  })

  it('does not render the download action when the user lacks LABWORKS_VIEW permission (other permissions unaffected)', () => {
    canMock.mockImplementation((perm: unknown) => perm !== Permission.LABWORKS_VIEW)

    renderCard(makeLabwork())

    expect(screen.queryByRole('button', { name: 'Descargar orden' })).not.toBeInTheDocument()
    // Sanity check: the mock only gates LABWORKS_VIEW — edit/delete remain visible.
    expect(screen.getByRole('button', { name: 'Editar' })).toBeInTheDocument()
  })

  it('calls downloadLabworkPdf with the labwork id when clicked', async () => {
    vi.mocked(downloadLabworkPdf).mockResolvedValue(undefined)
    renderCard(makeLabwork({ id: 'labwork-42' }))

    fireEvent.click(screen.getByRole('button', { name: 'Descargar orden' }))

    await waitFor(() => {
      expect(downloadLabworkPdf).toHaveBeenCalledWith('labwork-42')
    })
    expect(downloadLabworkPdf).toHaveBeenCalledTimes(1)
  })

  it('disables the button while the download is in flight and re-enables it after completion', async () => {
    let resolveDownload: () => void = () => {}
    vi.mocked(downloadLabworkPdf).mockReturnValue(
      new Promise((resolve) => {
        resolveDownload = () => resolve(undefined)
      })
    )
    renderCard(makeLabwork())

    const button = screen.getByRole('button', { name: 'Descargar orden' })
    fireEvent.click(button)

    await waitFor(() => {
      expect(button).toBeDisabled()
    })

    resolveDownload()

    await waitFor(() => {
      expect(button).not.toBeDisabled()
    })
  })

  it('does not throw and re-enables the button when the download rejects', async () => {
    vi.mocked(downloadLabworkPdf).mockRejectedValue(new Error('network error'))
    renderCard(makeLabwork())

    const button = screen.getByRole('button', { name: 'Descargar orden' })
    fireEvent.click(button)

    await waitFor(() => {
      expect(button).not.toBeDisabled()
    })
    expect(downloadLabworkPdf).toHaveBeenCalledTimes(1)
  })
})

// Task #240: the price row shows the shared PaidStatusBadge only when the
// labwork is NOT covered by an appointment's price — otherwise it shows the
// "included in appointment" chip instead, never both. Labworks have no
// paidAmount field, so the badge is binary here (paid/pending only).
describe('LabworkCard — price row and paid status badge (#240)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    canMock.mockReturnValue(true)
  })

  it('shows the "Pagado" badge next to the price when isPaid is true and priceIncludedInAppointment is false', () => {
    renderCard(makeLabwork({ price: 100, isPaid: true, priceIncludedInAppointment: false }))

    expect(screen.getByText('USD 100.00')).toBeInTheDocument()
    // The default fixture is patient-linked and priced, so FIFO payment
    // allocation owns isPaid (#470) and no paid toggle renders. The count is
    // therefore the price-row badge alone.
    expect(screen.getAllByText('Pagado')).toHaveLength(1)
  })

  // Excludes the lifecycle status <select>'s "PENDING" <option> from the
  // "Pendiente" text match: task #243-B added that select with all four
  // status options always present in the DOM regardless of the selected
  // value, which would otherwise inflate this count by one and mask what
  // the #240 assertion is actually about (the payment badge/toggle pair).
  const notOption = (content: string, element: Element | null) =>
    content === 'Pendiente' && element?.tagName.toLowerCase() !== 'option'

  it('shows the "Pendiente" badge next to the price when isPaid is false and priceIncludedInAppointment is false', () => {
    renderCard(makeLabwork({ price: 100, isPaid: false, priceIncludedInAppointment: false }))

    expect(screen.getByText('USD 100.00')).toBeInTheDocument()
    // FIFO-managed card (#470): no paid toggle renders, so the single
    // "Pendiente" occurrence is the price-row badge, and it is not the paid label.
    expect(screen.getAllByText(notOption)).toHaveLength(1)
    expect(screen.queryByText('Pagado')).not.toBeInTheDocument()
  })

  it('shows the "included in appointment" chip and NOT the paid status badge when priceIncludedInAppointment is true', () => {
    renderCard(makeLabwork({ price: 100, isPaid: false, priceIncludedInAppointment: true }))

    expect(screen.getByText('Incluido en consulta')).toBeInTheDocument()
    // FIFO-managed card (#470): no paid toggle renders, so with the badge
    // replaced by the chip there must be exactly zero "Pendiente" occurrences.
    expect(screen.queryAllByText(notOption)).toHaveLength(0)
  })

  it('shows the "included in appointment" chip (not the paid badge) even when isPaid is true', () => {
    renderCard(makeLabwork({ price: 100, isPaid: true, priceIncludedInAppointment: true }))

    expect(screen.getByText('Incluido en consulta')).toBeInTheDocument()
    // FIFO-managed card (#470): no paid toggle renders, so the price-row badge
    // being absent means exactly zero "Pagado" occurrences.
    expect(screen.queryAllByText('Pagado')).toHaveLength(0)
  })

  // Unlinked labwork: not FIFO-managed, so the manual paid toggle renders
  // alongside the price-row badge and each label appears twice.
  it('keeps badge and manual toggle together on an unlinked labwork ("Pagado" x2)', () => {
    renderCard(makeLabwork({ patientId: null, price: 100, isPaid: true, priceIncludedInAppointment: false }))

    expect(screen.getAllByText('Pagado')).toHaveLength(2)
  })

  it('keeps badge and manual toggle together on an unlinked labwork ("Pendiente" x2)', () => {
    renderCard(makeLabwork({ patientId: null, price: 100, isPaid: false, priceIncludedInAppointment: false }))

    expect(screen.getAllByText(notOption)).toHaveLength(2)
  })
})

// Task #242: doctor name(s) row, rendered between the appointment-linked
// info and the price row.
describe('LabworkCard — assigned doctors (#242)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    canMock.mockReturnValue(true)
  })

  it('shows the "Sin doctor asignado" placeholder when no doctor is assigned', () => {
    renderCard(makeLabwork({ doctors: [] }))

    expect(screen.getByText('Sin doctor asignado')).toBeInTheDocument()
  })

  it('shows a single doctor name when one doctor is assigned', () => {
    renderCard(
      makeLabwork({
        doctors: [{ id: 'doc-1', firstName: 'Jane', lastName: 'Smith', isActive: true }],
      })
    )

    expect(screen.getByText('Jane Smith')).toBeInTheDocument()
    expect(screen.queryByText('Sin doctor asignado')).not.toBeInTheDocument()
  })

  it('shows a comma-joined list of names when multiple doctors are assigned', () => {
    renderCard(
      makeLabwork({
        doctors: [
          { id: 'doc-1', firstName: 'Jane', lastName: 'Smith', isActive: true },
          { id: 'doc-2', firstName: 'Bob', lastName: 'Lee', isActive: false },
        ],
      })
    )

    expect(screen.getByText('Jane Smith, Bob Lee')).toBeInTheDocument()
  })
})

// Task #243-B: the delivered-toggle button was replaced by a compact status
// <select>, gated by the same can(LABWORKS_UPDATE) / isDeleted rule as the
// rest of the card's mutating controls.
describe('LabworkCard — lifecycle status select (#243-B)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    canMock.mockReturnValue(true)
  })

  it('renders the select pre-set to the labwork\'s current status', () => {
    renderCard(makeLabwork({ status: 'SENT', deletedAt: null }))

    expect(screen.getByRole('combobox')).toHaveValue('SENT')
  })

  it('calls onStatusChange with the labwork and the newly selected status', () => {
    const { onStatusChange } = renderCard(makeLabwork({ id: 'labwork-9', status: 'PENDING' }))

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'RECEIVED' } })

    expect(onStatusChange).toHaveBeenCalledTimes(1)
    expect(onStatusChange).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'labwork-9' }),
      'RECEIVED'
    )
  })

  it('disables the select for a deleted (soft-deleted) record even when the user can update labworks', () => {
    canMock.mockReturnValue(true)
    renderCard(makeLabwork({ deletedAt: '2026-02-01T00:00:00Z' }))

    expect(screen.getByRole('combobox')).toBeDisabled()
  })

  it('disables the select for a user without LABWORKS_UPDATE even on a non-deleted record', () => {
    canMock.mockImplementation((perm: unknown) => perm !== Permission.LABWORKS_UPDATE)
    renderCard(makeLabwork({ deletedAt: null }))

    expect(screen.getByRole('combobox')).toBeDisabled()
  })

  it('enables the select for a non-deleted record when the user has LABWORKS_UPDATE', () => {
    canMock.mockReturnValue(true)
    renderCard(makeLabwork({ deletedAt: null }))

    expect(screen.getByRole('combobox')).not.toBeDisabled()
  })
})

// Task #470: FIFO payment allocation owns `isPaid` for patient-linked billable
// labworks, so the manual paid toggle is replaced by a pointer to the patient's
// payments. The REAL predicate runs here (@/lib/labwork-api is not mocked); each
// predicate input is flipped on its own so a predicate that ignores any one of
// them fails at least one case below.
describe('LabworkCard — paid control owned by payments (#470)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    canMock.mockReturnValue(true)
  })

  const helperText = /pagos del paciente/i
  const queryToggle = () => screen.queryByRole('button', { name: /^(Pagado|Pendiente)$/ })

  it('linked + priced: no paid toggle, helper text and a link to the patient page are shown', () => {
    renderCard(makeLabwork({ patientId: 'patient-7', price: 100 }))

    expect(queryToggle()).not.toBeInTheDocument()
    expect(screen.getByText(i18n.t('labworks.paidManagedByPayments'), { exact: false })).toBeInTheDocument()
    const link = screen.getByRole('link', { name: i18n.t('labworks.viewPatientPayments') })
    expect(link).toHaveAttribute('href', '/patients/patient-7')
  })

  it('unlinked + priced (patientId flipped): the toggle stays, no helper, no link', () => {
    renderCard(makeLabwork({ patientId: null, price: 100 }))

    expect(queryToggle()).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.queryByText(i18n.t('labworks.paidManagedByPayments'), { exact: false })).not.toBeInTheDocument()
  })

  it('linked + zero price (price flipped): the toggle stays, no helper, no link', () => {
    renderCard(makeLabwork({ patientId: 'patient-1', price: 0 }))

    expect(queryToggle()).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.queryByText(i18n.t('labworks.paidManagedByPayments'), { exact: false })).not.toBeInTheDocument()
  })

  it('linked + zero price + priceIncludedInAppointment (flag flipped): managed, no toggle, link shown', () => {
    renderCard(
      makeLabwork({ patientId: 'patient-1', price: 0, appointmentId: 'appt-1', priceIncludedInAppointment: true })
    )

    expect(queryToggle()).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: i18n.t('labworks.viewPatientPayments') })).toHaveAttribute(
      'href',
      '/patients/patient-1'
    )
  })

  it('helper copy resolves to real text in es (not the raw key)', () => {
    expect(i18n.t('labworks.paidManagedByPayments')).not.toBe('labworks.paidManagedByPayments')
    expect(i18n.t('labworks.viewPatientPayments')).not.toBe('labworks.viewPatientPayments')
    expect(i18n.t('labworks.paidManagedByPayments')).toMatch(helperText)
  })

  describe('unlinked fixture: the toggle behaves exactly as before', () => {
    function renderUnlinked(overrides: Partial<Labwork> = {}) {
      const onTogglePaid = vi.fn()
      const labwork = makeLabwork({ patientId: null, price: 100, ...overrides })
      render(
        <MemoryRouter>
          <LabworkCard labwork={labwork} onEdit={vi.fn()} onDelete={vi.fn()} onTogglePaid={onTogglePaid} />
        </MemoryRouter>
      )
      return { onTogglePaid, labwork }
    }

    it('calls onTogglePaid with the labwork when clicked', () => {
      const { onTogglePaid, labwork } = renderUnlinked()

      fireEvent.click(screen.getByRole('button', { name: 'Pendiente' }))

      expect(onTogglePaid).toHaveBeenCalledTimes(1)
      expect(onTogglePaid).toHaveBeenCalledWith(labwork)
    })

    it('is green and labelled "Pagado" when isPaid is true', () => {
      renderUnlinked({ isPaid: true })

      const button = screen.getByRole('button', { name: 'Pagado' })
      expect(button.className).toContain('bg-green-100')
      expect(button.className).toContain('text-green-700')
    })

    it('is gray and labelled "Pendiente" when isPaid is false', () => {
      renderUnlinked({ isPaid: false })

      const button = screen.getByRole('button', { name: 'Pendiente' })
      expect(button.className).toContain('bg-gray-100')
      expect(button.className).toContain('text-gray-600')
    })

    it('is disabled for a user without LABWORKS_UPDATE', () => {
      canMock.mockImplementation((perm: unknown) => perm !== Permission.LABWORKS_UPDATE)
      renderUnlinked()

      expect(screen.getByRole('button', { name: 'Pendiente' })).toBeDisabled()
    })

    it('is disabled for a soft-deleted labwork even when the user can update', () => {
      renderUnlinked({ deletedAt: '2026-02-01T00:00:00Z' })

      expect(screen.getByRole('button', { name: 'Pendiente' })).toBeDisabled()
    })

    it('is enabled for a live labwork when the user has LABWORKS_UPDATE', () => {
      renderUnlinked()

      expect(screen.getByRole('button', { name: 'Pendiente' })).toBeEnabled()
    })
  })
})
