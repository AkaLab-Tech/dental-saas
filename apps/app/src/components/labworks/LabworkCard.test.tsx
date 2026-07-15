import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
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
    doctorIds: [],
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
  const utils = render(
    <LabworkCard labwork={labwork} onEdit={onEdit} onDelete={onDelete} />
  )
  return { onEdit, onDelete, ...utils }
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
    renderCard(makeLabwork({ phoneNumber: null }))

    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('stops click propagation on the phone link so it does not bubble to ancestor click handlers', () => {
    const parentClick = vi.fn()
    render(
      // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events
      <div onClick={parentClick}>
        <LabworkCard
          labwork={makeLabwork({ phoneNumber: '+598 99 123 456' })}
          onEdit={vi.fn()}
          onDelete={vi.fn()}
        />
      </div>
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
