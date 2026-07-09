import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Mock } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router'
import { Permission } from '@dental/shared'
import PatientDetailPage from './PatientDetailPage'
import { getPatientById } from '@/lib/patient-api'
import { usePermissions } from '@/hooks/usePermissions'
import type { Patient } from '@/lib/patient-api'

// ============================================================================
// Mocks
// ============================================================================

// Keep calculateAge / getPatientInitials real (pure formatting helpers), only
// stub the network seam (getPatientById) plus the mutating calls the tooth
// modal and primary-teeth toggle would otherwise hit.
vi.mock('@/lib/patient-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/patient-api')>('@/lib/patient-api')
  return {
    ...actual,
    getPatientById: vi.fn(),
    updateToothData: vi.fn(),
    deleteToothData: vi.fn(),
    updateShowPrimaryTeeth: vi.fn(),
  }
})

vi.mock('@/lib/pdf-api', () => ({
  downloadPatientHistoryPdf: vi.fn(),
}))

vi.mock('@/hooks/usePermissions')

// The odontogram is a heavy third-party SVG library unrelated to the tab
// shell being tested here — stub it to a lightweight marker so tests can
// assert on its presence/absence without rendering the real chart.
vi.mock('react-odontogram', () => ({
  Odontogram: () => <div data-testid="odontogram-chart" />,
}))

vi.mock('@/assets/odontogram.css', () => ({}))

// Child sections rendered inside tab panels — stub each to a minimal marker
// carrying the patientId prop, so assertions target the tab shell (which
// panel is visible) rather than each section's internals (covered by their
// own test files).
vi.mock('./PatientAppointmentsSection', () => ({
  PatientAppointmentsSection: ({ patientId }: { patientId: string }) => (
    <div data-testid="appointments-section">appointments-section:{patientId}</div>
  ),
}))

vi.mock('./PatientLabworksSection', () => ({
  PatientLabworksSection: ({ patientId }: { patientId: string }) => (
    <div data-testid="labworks-section">labworks-section:{patientId}</div>
  ),
}))

vi.mock('@/components/budgets/BudgetsSection', () => ({
  BudgetsSection: ({ patientId }: { patientId: string }) => (
    <div data-testid="budgets-section">budgets-section:{patientId}</div>
  ),
}))

vi.mock('@/components/payments/PaymentSection', () => ({
  PaymentSection: ({ patientId }: { patientId: string }) => (
    <div data-testid="payments-section">payments-section:{patientId}</div>
  ),
}))

vi.mock('@/components/ui/ImageUpload', () => ({
  ImageUpload: ({ entityId }: { entityId: string }) => (
    <div data-testid="image-upload">image-upload:{entityId}</div>
  ),
}))

vi.mock('@/components/ui/ImageGallery', () => ({
  ImageGallery: ({ entityId }: { entityId: string }) => (
    <div data-testid="image-gallery">image-gallery:{entityId}</div>
  ),
}))

vi.mock('@/components/appointments/AppointmentFormModal', () => ({
  AppointmentFormModal: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="appointment-form-modal" role="dialog" /> : null,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'es' },
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}))

vi.mock('@/i18n', () => ({
  default: { language: 'es' },
}))

// ============================================================================
// Test data
// ============================================================================

function makePatient(overrides: Partial<Patient> = {}): Patient {
  return {
    id: 'p1',
    tenantId: 't1',
    firstName: 'Juan',
    lastName: 'Pérez',
    email: 'juan@example.com',
    phone: '+1234567890',
    dob: '1990-01-01',
    gender: 'male',
    address: 'Calle Principal 123',
    notes: null,
    teeth: null,
    showPrimaryTeeth: false,
    isActive: true,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

function mockPermissions(canViewPayments: boolean) {
  ;(usePermissions as unknown as Mock).mockReturnValue({
    can: (permission: Permission) => canViewPayments && permission === Permission.PAYMENTS_VIEW,
    canAny: () => canViewPayments,
    canAll: () => canViewPayments,
  })
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/patients/p1']}>
      <Routes>
        <Route path="/patients/:id" element={<PatientDetailPage />} />
      </Routes>
    </MemoryRouter>
  )
}

async function renderLoadedPage() {
  const utils = renderPage()
  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Juan Pérez' })).toBeInTheDocument()
  })
  return utils
}

// The tab panels are kept permanently mounted and toggled via a Tailwind
// `hidden` utility class on their wrapper div (rather than being
// mounted/unmounted). jsdom does not load the Tailwind stylesheet in tests,
// so `toBeVisible()` can't see the effect of that class — instead walk up
// the DOM for the nearest ancestor carrying the literal `hidden` class,
// which in this component is used exclusively by the five tab-panel
// wrappers (verified: no other element in the tree uses that class name).
function isHidden(element: Element): boolean {
  return element.closest('.hidden') !== null
}

// ============================================================================
// Tests
// ============================================================================

describe('PatientDetailPage — tabs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(getPatientById as unknown as Mock).mockResolvedValue(makePatient())
    mockPermissions(true)
  })

  describe('tab rendering (with PAYMENTS_VIEW)', () => {
    it('renders all five tabs when the user has PAYMENTS_VIEW', async () => {
      await renderLoadedPage()

      const tabs = screen.getByRole('navigation', { name: 'Tabs' })
      expect(tabs).toBeInTheDocument()

      expect(screen.getByRole('button', { name: /patients\.tabs\.patient/ })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /patients\.tabs\.appointments/ })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /patients\.tabs\.budgets/ })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /patients\.tabs\.payments/ })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /patients\.tabs\.images/ })).toBeInTheDocument()
    })

    it('defaults to the Patient tab active with contact info visible', async () => {
      await renderLoadedPage()

      const patientTabButton = screen.getByRole('button', { name: /patients\.tabs\.patient/ })
      expect(patientTabButton).toHaveAttribute('aria-selected', 'true')

      expect(isHidden(screen.getByText('juan@example.com'))).toBe(false)
      expect(isHidden(screen.getByTestId('appointments-section'))).toBe(true)
    })
  })

  describe('switching tabs shows/hides panel content', () => {
    it('shows appointments content and hides others when clicking the Appointments tab', async () => {
      await renderLoadedPage()

      fireEvent.click(screen.getByRole('button', { name: /patients\.tabs\.appointments/ }))

      expect(screen.getByRole('button', { name: /patients\.tabs\.appointments/ })).toHaveAttribute(
        'aria-selected',
        'true'
      )
      expect(isHidden(screen.getByTestId('appointments-section'))).toBe(false)
      expect(screen.getByTestId('appointments-section')).toHaveTextContent('appointments-section:p1')

      // Patient tab panel (contact info) is now hidden
      expect(isHidden(screen.getByText('juan@example.com'))).toBe(true)
      expect(isHidden(screen.getByTestId('budgets-section'))).toBe(true)
      expect(isHidden(screen.getByTestId('payments-section'))).toBe(true)
      expect(isHidden(screen.getByTestId('image-upload'))).toBe(true)
    })

    it('shows budgets content and hides others when clicking the Budgets tab', async () => {
      await renderLoadedPage()

      fireEvent.click(screen.getByRole('button', { name: /patients\.tabs\.budgets/ }))

      expect(isHidden(screen.getByTestId('budgets-section'))).toBe(false)
      expect(screen.getByTestId('budgets-section')).toHaveTextContent('budgets-section:p1')
      expect(isHidden(screen.getByTestId('appointments-section'))).toBe(true)
      expect(isHidden(screen.getByTestId('payments-section'))).toBe(true)
      expect(isHidden(screen.getByTestId('image-upload'))).toBe(true)
    })

    it('shows payments content and hides others when clicking the Payments tab', async () => {
      await renderLoadedPage()

      fireEvent.click(screen.getByRole('button', { name: /patients\.tabs\.payments/ }))

      expect(isHidden(screen.getByTestId('payments-section'))).toBe(false)
      expect(screen.getByTestId('payments-section')).toHaveTextContent('payments-section:p1')
      expect(isHidden(screen.getByTestId('appointments-section'))).toBe(true)
      expect(isHidden(screen.getByTestId('budgets-section'))).toBe(true)
      expect(isHidden(screen.getByTestId('image-upload'))).toBe(true)
    })

    it('shows images content (upload + gallery) and hides others when clicking the Images tab', async () => {
      await renderLoadedPage()

      fireEvent.click(screen.getByRole('button', { name: /patients\.tabs\.images/ }))

      expect(isHidden(screen.getByTestId('image-upload'))).toBe(false)
      expect(isHidden(screen.getByTestId('image-gallery'))).toBe(false)
      expect(screen.getByTestId('image-upload')).toHaveTextContent('image-upload:p1')
      expect(screen.getByTestId('image-gallery')).toHaveTextContent('image-gallery:p1')
      expect(isHidden(screen.getByTestId('appointments-section'))).toBe(true)
      expect(isHidden(screen.getByTestId('budgets-section'))).toBe(true)
      expect(isHidden(screen.getByTestId('payments-section'))).toBe(true)
    })

    it('keeps sections mounted (not removed from the DOM) when switching away from their tab', async () => {
      await renderLoadedPage()

      fireEvent.click(screen.getByRole('button', { name: /patients\.tabs\.appointments/ }))
      expect(screen.getByTestId('appointments-section')).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: /patients\.tabs\.budgets/ }))
      // Appointments section is still in the DOM (mounted), just hidden —
      // refresh-key wiring on hidden sections must survive tab switches.
      expect(screen.getByTestId('appointments-section')).toBeInTheDocument()
      expect(isHidden(screen.getByTestId('appointments-section'))).toBe(true)
    })
  })

  describe('odontogram stays outside the tab system', () => {
    it('is present and not inside any hidden tab panel on the Patient tab', async () => {
      await renderLoadedPage()
      const odontogram = screen.getAllByTestId('odontogram-chart')[0]
      expect(odontogram).toBeInTheDocument()
      expect(isHidden(odontogram)).toBe(false)
    })

    it('remains present and unaffected by the `hidden` toggling after switching to the Appointments tab', async () => {
      await renderLoadedPage()

      fireEvent.click(screen.getByRole('button', { name: /patients\.tabs\.appointments/ }))

      // The appointments panel itself is now visible, but the odontogram is
      // unrelated to that toggle — it lives outside the tab panel tree.
      const odontogram = screen.getAllByTestId('odontogram-chart')[0]
      expect(odontogram).toBeInTheDocument()
      expect(isHidden(odontogram)).toBe(false)
    })

    it('remains present and unaffected by the `hidden` toggling after switching to the Images tab', async () => {
      await renderLoadedPage()

      fireEvent.click(screen.getByRole('button', { name: /patients\.tabs\.images/ }))

      const odontogram = screen.getAllByTestId('odontogram-chart')[0]
      expect(odontogram).toBeInTheDocument()
      expect(isHidden(odontogram)).toBe(false)
    })
  })

  describe('Payments tab permission gating', () => {
    it('does not render the Payments tab button when the user lacks PAYMENTS_VIEW', async () => {
      mockPermissions(false)
      await renderLoadedPage()

      expect(screen.queryByRole('button', { name: /patients\.tabs\.payments/ })).not.toBeInTheDocument()
      expect(screen.queryByTestId('payments-section')).not.toBeInTheDocument()
    })

    it('renders the Payments tab button when the user has PAYMENTS_VIEW', async () => {
      mockPermissions(true)
      await renderLoadedPage()

      expect(screen.getByRole('button', { name: /patients\.tabs\.payments/ })).toBeInTheDocument()
    })

    it('renders exactly four tab buttons when the Payments tab is gated out', async () => {
      mockPermissions(false)
      await renderLoadedPage()

      const tabs = screen.getByRole('navigation', { name: 'Tabs' })
      const buttons = tabs.querySelectorAll('button')
      expect(buttons).toHaveLength(4)
    })
  })
})
