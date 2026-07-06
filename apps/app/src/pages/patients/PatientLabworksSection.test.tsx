import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { PatientLabworksSection } from './PatientLabworksSection'
import { formatLabworkDate } from '@/lib/labwork-api'
import type { Labwork } from '@/lib/labwork-api'

// ============================================================================
// Mocks
// ============================================================================

const mockGetLabworks = vi.fn()

// Mock only the network seam (getLabworks). formatLabworkDate and
// getLabworkStatusBadge are pure formatting functions — keep the real
// implementations so the tests pin down actual rendered output instead of a
// re-implementation that could drift from production behavior.
vi.mock('@/lib/labwork-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/labwork-api')>('@/lib/labwork-api')
  return {
    ...actual,
    getLabworks: (...args: unknown[]) => mockGetLabworks(...args),
  }
})

vi.mock('@/stores/auth.store', () => ({
  useAuthStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ user: { tenant: { currency: 'USD' } } }),
}))

// `t` must be a stable reference across renders — the component's fetch
// callback depends on it (useCallback([patientId, t])). Real react-i18next
// keeps `t` stable within a language; an inline arrow here would recreate on
// every render and trigger a refetch loop.
const mockT = (key: string) => key
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: mockT,
    i18n: { language: 'es' },
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}))

vi.mock('@/i18n', () => ({
  default: { language: 'es' },
}))

// ============================================================================
// Test Data
// ============================================================================

function makeLabwork(overrides: Partial<Labwork> = {}): Labwork {
  return {
    id: 'lw1',
    tenantId: 't1',
    patientId: 'p1',
    appointmentId: null,
    priceIncludedInAppointment: false,
    lab: 'Lab Dental Sur',
    phoneNumber: null,
    date: '2026-03-15T00:00:00.000Z',
    note: null,
    price: 1500,
    isPaid: false,
    isDelivered: false,
    doctorIds: [],
    isActive: true,
    deletedAt: null,
    createdAt: '2026-03-01T00:00:00.000Z',
    updatedAt: '2026-03-01T00:00:00.000Z',
    patient: null,
    ...overrides,
  }
}

const labworkPending = makeLabwork({
  id: 'lw1',
  lab: 'Lab Dental Sur',
  date: '2026-03-15T00:00:00.000Z',
  price: 1500,
  isPaid: false,
  isDelivered: false,
})

const labworkCompleted = makeLabwork({
  id: 'lw2',
  lab: 'Protesis Norte',
  date: '2026-03-20T00:00:00.000Z',
  price: 3200,
  isPaid: true,
  isDelivered: true,
})

// ============================================================================
// Helpers
// ============================================================================

const defaultProps = {
  patientId: 'p1',
}

function renderSection(props = {}) {
  return render(<PatientLabworksSection {...defaultProps} {...props} />)
}

// ============================================================================
// Tests
// ============================================================================

describe('PatientLabworksSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetLabworks.mockResolvedValue({
      success: true,
      data: [labworkPending, labworkCompleted],
      pagination: { total: 2, limit: 100, offset: 0 },
    })
  })

  // --------------------------------------------------------------------------
  // List rendering
  // --------------------------------------------------------------------------

  describe('list rendering', () => {
    it('renders a row per labwork with lab name, date, price and status badge', async () => {
      renderSection()

      await waitFor(() => {
        expect(screen.getByText('Lab Dental Sur')).toBeInTheDocument()
      })
      expect(screen.getByText('Protesis Norte')).toBeInTheDocument()

      // Dates formatted via the real formatLabworkDate — compute expected
      // values with the same function rather than hardcoding a day-of-month
      // literal, since Date-to-locale-string is timezone-sensitive.
      expect(screen.getByText(formatLabworkDate(labworkPending.date))).toBeInTheDocument()
      expect(screen.getByText(formatLabworkDate(labworkCompleted.date))).toBeInTheDocument()

      // Prices formatted via the real formatCurrency (USD, code display)
      expect(screen.getByText('USD 1,500.00')).toBeInTheDocument()
      expect(screen.getByText('USD 3,200.00')).toBeInTheDocument()

      // Status badges from the real getLabworkStatusBadge
      expect(screen.getByText('Pendiente')).toBeInTheDocument()
      expect(screen.getByText('Completado')).toBeInTheDocument()
    })

    it('shows the section title', async () => {
      renderSection()

      await waitFor(() => {
        expect(mockGetLabworks).toHaveBeenCalled()
      })
      expect(screen.getByText('patients.labworksSection.title')).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Empty state
  // --------------------------------------------------------------------------

  describe('empty state', () => {
    it('shows the localized empty message when there are no labworks', async () => {
      mockGetLabworks.mockResolvedValue({
        success: true,
        data: [],
        pagination: { total: 0, limit: 100, offset: 0 },
      })

      renderSection()

      await waitFor(() => {
        expect(screen.getByText('patients.labworksSection.empty')).toBeInTheDocument()
      })
      expect(screen.queryByText('Lab Dental Sur')).not.toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Error state
  // --------------------------------------------------------------------------

  describe('error state', () => {
    it('shows the error message when the fetch rejects', async () => {
      mockGetLabworks.mockRejectedValue(new Error('Network error'))

      renderSection()

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent('Network error')
      })
    })

    it('falls back to the localized error message for non-Error rejections', async () => {
      mockGetLabworks.mockRejectedValue('boom')

      renderSection()

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent('patients.labworksSection.error')
      })
    })
  })

  // --------------------------------------------------------------------------
  // Patient-scoped fetch
  // --------------------------------------------------------------------------

  describe('fetch params', () => {
    it('calls getLabworks scoped to the given patientId with a limit of 100', async () => {
      renderSection({ patientId: 'patient-42' })

      await waitFor(() => {
        expect(mockGetLabworks).toHaveBeenCalledWith({ patientId: 'patient-42', limit: 100 })
      })
    })
  })

  // --------------------------------------------------------------------------
  // Refresh behavior
  // --------------------------------------------------------------------------

  describe('refresh behavior', () => {
    it('refetches when refreshKey changes', async () => {
      const { rerender } = renderSection({ refreshKey: 0 })

      await waitFor(() => {
        expect(mockGetLabworks).toHaveBeenCalledTimes(1)
      })

      rerender(<PatientLabworksSection {...defaultProps} refreshKey={1} />)

      await waitFor(() => {
        expect(mockGetLabworks).toHaveBeenCalledTimes(2)
      })
    })
  })
})
