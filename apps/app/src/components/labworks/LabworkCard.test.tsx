import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import i18n from 'i18next'
import '@/i18n'
import { LabworkCard } from './LabworkCard'
import type { Labwork } from '@/lib/labwork-api'

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
