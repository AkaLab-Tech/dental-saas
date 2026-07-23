import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { PatientDebtsPage } from './PatientDebtsPage'
import type { Debtor } from '@/lib/payment-api'

// ============================================================================
// Mocks
// ============================================================================

const mockGetDebtors = vi.fn()

// Mock only the network seam (getDebtors) — keep the real Debtor type.
vi.mock('@/lib/payment-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/payment-api')>('@/lib/payment-api')
  return {
    ...actual,
    getDebtors: (...args: unknown[]) => mockGetDebtors(...args),
  }
})

vi.mock('@/stores/auth.store', () => ({
  useAuthStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ user: { tenant: { currency: 'USD' } } }),
}))

const mockT = (key: string) => key
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: mockT,
    i18n: { language: 'es' },
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}))

// ============================================================================
// Test Data
// ============================================================================

function makeDebtor(overrides: Partial<Debtor> = {}): Debtor {
  return {
    patientId: 'p1',
    name: 'Jane Doe',
    totalDebt: 500,
    totalPaid: 100,
    outstanding: 400,
    ...overrides,
  }
}

function renderPage() {
  return render(
    <MemoryRouter>
      <PatientDebtsPage />
    </MemoryRouter>
  )
}

// ============================================================================
// Tests
// ============================================================================

describe('PatientDebtsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('list rendering', () => {
    it('renders a row per debtor with name and formatted totals (USD, code display)', async () => {
      mockGetDebtors.mockResolvedValue([
        makeDebtor({ patientId: 'p1', name: 'Jane Doe', totalDebt: 500, totalPaid: 100, outstanding: 400 }),
        makeDebtor({ patientId: 'p2', name: 'John Smith', totalDebt: 200, totalPaid: 200, outstanding: 0 }),
      ])

      renderPage()

      await waitFor(() => {
        expect(screen.getByText('Jane Doe')).toBeInTheDocument()
      })
      expect(screen.getByText('John Smith')).toBeInTheDocument()

      // Debtor 1: debt=500, paid=100, outstanding=400 — each value unique in this fixture
      expect(screen.getByText('USD 500.00')).toBeInTheDocument()
      expect(screen.getByText('USD 100.00')).toBeInTheDocument()
      expect(screen.getByText('USD 400.00')).toBeInTheDocument()
    })

    it('links each debtor row to their patient detail page', async () => {
      mockGetDebtors.mockResolvedValue([makeDebtor({ patientId: 'patient-42', name: 'Jane Doe' })])

      renderPage()

      await waitFor(() => {
        expect(screen.getByText('Jane Doe')).toBeInTheDocument()
      })
      expect(screen.getByRole('link', { name: 'Jane Doe' })).toHaveAttribute('href', '/patients/patient-42')
    })
  })

  describe('empty state', () => {
    it('shows the localized empty message when there are no debtors', async () => {
      mockGetDebtors.mockResolvedValue([])

      renderPage()

      await waitFor(() => {
        expect(screen.getByText('payments.debtors.empty')).toBeInTheDocument()
      })
      expect(screen.queryByText('Jane Doe')).not.toBeInTheDocument()
    })
  })

  describe('error state', () => {
    it('shows the error message when the fetch rejects', async () => {
      mockGetDebtors.mockRejectedValue(new Error('Network error'))

      renderPage()

      await waitFor(() => {
        expect(screen.getByText('Network error')).toBeInTheDocument()
      })
    })

    it('falls back to a generic error message for non-Error rejections', async () => {
      mockGetDebtors.mockRejectedValue('boom')

      renderPage()

      await waitFor(() => {
        expect(screen.getByText('Error loading debtors')).toBeInTheDocument()
      })
    })
  })
})
