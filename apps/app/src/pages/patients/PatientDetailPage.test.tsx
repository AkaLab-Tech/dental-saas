import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Mock } from 'vitest'
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router'
import { Permission, ToothStatus, type TeethData } from '@dental/shared'
import PatientDetailPage from './PatientDetailPage'
import { getPatientById, deleteToothData } from '@/lib/patient-api'
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

const sampleTeeth: TeethData = {
  '11': { status: ToothStatus.CARIES, note: 'Necesita relleno' },
  '21': { status: ToothStatus.CROWN, note: '' },
  '36': { status: ToothStatus.IMPLANT, note: '' },
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
    it('renders all six tabs when the user has PAYMENTS_VIEW', async () => {
      await renderLoadedPage()

      const tabs = screen.getByRole('navigation', { name: 'Tabs' })
      expect(tabs).toBeInTheDocument()

      expect(screen.getByRole('button', { name: /patients\.tabs\.patient/ })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /patients\.tabs\.appointments/ })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /patients\.tabs\.budgets/ })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /patients\.tabs\.labworks/ })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /patients\.tabs\.payments/ })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /patients\.tabs\.images/ })).toBeInTheDocument()
    })

    it('renders the tab buttons in order: Patient, Appointments, Budgets, Labworks, Payments, Images', async () => {
      await renderLoadedPage()

      const tabs = screen.getByRole('navigation', { name: 'Tabs' })
      const labels = Array.from(tabs.querySelectorAll('button')).map((button) =>
        button.textContent?.trim()
      )
      expect(labels).toEqual([
        'patients.tabs.patient',
        'patients.tabs.appointments',
        'patients.tabs.budgets',
        'patients.tabs.labworks',
        'patients.tabs.payments',
        'patients.tabs.images',
      ])
    })

    it('defaults to the Patient tab active with contact info and the odontogram visible', async () => {
      await renderLoadedPage()

      const patientTabButton = screen.getByRole('button', { name: /patients\.tabs\.patient/ })
      expect(patientTabButton).toHaveAttribute('aria-selected', 'true')

      expect(isHidden(screen.getByText('juan@example.com'))).toBe(false)
      expect(isHidden(screen.getByTestId('odontogram-chart'))).toBe(false)
      expect(isHidden(screen.getByTestId('appointments-section'))).toBe(true)
      expect(isHidden(screen.getByTestId('labworks-section'))).toBe(true)
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

      // Patient tab panel (contact info + odontogram) is now hidden
      expect(isHidden(screen.getByText('juan@example.com'))).toBe(true)
      expect(isHidden(screen.getByTestId('odontogram-chart'))).toBe(true)
      expect(isHidden(screen.getByTestId('budgets-section'))).toBe(true)
      expect(isHidden(screen.getByTestId('labworks-section'))).toBe(true)
      expect(isHidden(screen.getByTestId('payments-section'))).toBe(true)
      expect(isHidden(screen.getByTestId('image-upload'))).toBe(true)
    })

    it('shows budgets content and hides others when clicking the Budgets tab', async () => {
      await renderLoadedPage()

      fireEvent.click(screen.getByRole('button', { name: /patients\.tabs\.budgets/ }))

      expect(isHidden(screen.getByTestId('budgets-section'))).toBe(false)
      expect(screen.getByTestId('budgets-section')).toHaveTextContent('budgets-section:p1')
      expect(isHidden(screen.getByTestId('odontogram-chart'))).toBe(true)
      expect(isHidden(screen.getByTestId('appointments-section'))).toBe(true)
      expect(isHidden(screen.getByTestId('labworks-section'))).toBe(true)
      expect(isHidden(screen.getByTestId('payments-section'))).toBe(true)
      expect(isHidden(screen.getByTestId('image-upload'))).toBe(true)
    })

    it('shows labworks content and hides others when clicking the Laboratorio tab', async () => {
      await renderLoadedPage()

      fireEvent.click(screen.getByRole('button', { name: /patients\.tabs\.labworks/ }))

      expect(screen.getByRole('button', { name: /patients\.tabs\.labworks/ })).toHaveAttribute(
        'aria-selected',
        'true'
      )
      expect(isHidden(screen.getByTestId('labworks-section'))).toBe(false)
      expect(screen.getByTestId('labworks-section')).toHaveTextContent('labworks-section:p1')
      expect(isHidden(screen.getByTestId('odontogram-chart'))).toBe(true)
      expect(isHidden(screen.getByTestId('appointments-section'))).toBe(true)
      expect(isHidden(screen.getByTestId('budgets-section'))).toBe(true)
      expect(isHidden(screen.getByTestId('payments-section'))).toBe(true)
      expect(isHidden(screen.getByTestId('image-upload'))).toBe(true)
    })

    it('shows payments content and hides others when clicking the Payments tab', async () => {
      await renderLoadedPage()

      fireEvent.click(screen.getByRole('button', { name: /patients\.tabs\.payments/ }))

      expect(isHidden(screen.getByTestId('payments-section'))).toBe(false)
      expect(screen.getByTestId('payments-section')).toHaveTextContent('payments-section:p1')
      expect(isHidden(screen.getByTestId('odontogram-chart'))).toBe(true)
      expect(isHidden(screen.getByTestId('appointments-section'))).toBe(true)
      expect(isHidden(screen.getByTestId('budgets-section'))).toBe(true)
      expect(isHidden(screen.getByTestId('labworks-section'))).toBe(true)
      expect(isHidden(screen.getByTestId('image-upload'))).toBe(true)
    })

    it('shows images content (upload + gallery) and hides others when clicking the Images tab', async () => {
      await renderLoadedPage()

      fireEvent.click(screen.getByRole('button', { name: /patients\.tabs\.images/ }))

      expect(isHidden(screen.getByTestId('image-upload'))).toBe(false)
      expect(isHidden(screen.getByTestId('image-gallery'))).toBe(false)
      expect(screen.getByTestId('image-upload')).toHaveTextContent('image-upload:p1')
      expect(screen.getByTestId('image-gallery')).toHaveTextContent('image-gallery:p1')
      expect(isHidden(screen.getByTestId('odontogram-chart'))).toBe(true)
      expect(isHidden(screen.getByTestId('appointments-section'))).toBe(true)
      expect(isHidden(screen.getByTestId('budgets-section'))).toBe(true)
      expect(isHidden(screen.getByTestId('labworks-section'))).toBe(true)
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

  describe('odontogram lives inside the Patient tab', () => {
    it('is present and visible under the Patient tab (not unconditionally rendered)', async () => {
      await renderLoadedPage()
      const odontogram = screen.getByTestId('odontogram-chart')
      expect(odontogram).toBeInTheDocument()
      expect(isHidden(odontogram)).toBe(false)
    })

    it('is hidden after switching away to the Appointments tab', async () => {
      await renderLoadedPage()

      fireEvent.click(screen.getByRole('button', { name: /patients\.tabs\.appointments/ }))

      // The appointments panel is now visible; the odontogram (inside the
      // Patient tab panel) must be hidden along with the rest of that panel.
      const odontogram = screen.getByTestId('odontogram-chart')
      expect(odontogram).toBeInTheDocument()
      expect(isHidden(odontogram)).toBe(true)
    })

    it('is hidden after switching away to the Images tab', async () => {
      await renderLoadedPage()

      fireEvent.click(screen.getByRole('button', { name: /patients\.tabs\.images/ }))

      const odontogram = screen.getByTestId('odontogram-chart')
      expect(odontogram).toBeInTheDocument()
      expect(isHidden(odontogram)).toBe(true)
    })

    it('is visible again after switching back to the Patient tab', async () => {
      await renderLoadedPage()

      fireEvent.click(screen.getByRole('button', { name: /patients\.tabs\.appointments/ }))
      expect(isHidden(screen.getByTestId('odontogram-chart'))).toBe(true)

      fireEvent.click(screen.getByRole('button', { name: /patients\.tabs\.patient/ }))
      expect(isHidden(screen.getByTestId('odontogram-chart'))).toBe(false)
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

    it('renders exactly five tab buttons when the Payments tab is gated out', async () => {
      mockPermissions(false)
      await renderLoadedPage()

      const tabs = screen.getByRole('navigation', { name: 'Tabs' })
      const buttons = tabs.querySelectorAll('button')
      expect(buttons).toHaveLength(5)
    })

    it('still renders the Laboratorio tab button when Payments is gated out', async () => {
      mockPermissions(false)
      await renderLoadedPage()

      expect(screen.getByRole('button', { name: /patients\.tabs\.labworks/ })).toBeInTheDocument()
    })
  })
})

describe('PatientDetailPage — odontogram 1/3/1 layout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPermissions(true)
  })

  // Locates the left-rail legend heading, the odontogram chart marker, and
  // the right-rail registered-teeth heading, in that order — the three
  // regions the 1/3/1 grid is built from.
  function getRegions() {
    const legendHeading = screen.getByRole('heading', { name: 'patients.statusLegend', level: 3 })
    const odontogram = screen.getByTestId('odontogram-chart')
    const registeredHeading = screen.getByRole('heading', { name: /patients\.registeredTeeth/ })
    return { legendHeading, odontogram, registeredHeading }
  }

  it('renders all three regions: the legend, the odontogram chart, and the registered-teeth list', async () => {
    ;(getPatientById as unknown as Mock).mockResolvedValue(makePatient({ teeth: sampleTeeth }))
    await renderLoadedPage()

    const { legendHeading, odontogram, registeredHeading } = getRegions()
    expect(legendHeading).toBeInTheDocument()
    expect(odontogram).toBeInTheDocument()
    expect(registeredHeading).toBeInTheDocument()
    expect(registeredHeading.textContent).toContain('(3)')
  })

  it('renders the three regions in source order: legend, then odontogram, then registered-teeth list', async () => {
    ;(getPatientById as unknown as Mock).mockResolvedValue(makePatient({ teeth: sampleTeeth }))
    await renderLoadedPage()

    const { legendHeading, odontogram, registeredHeading } = getRegions()

    // DOCUMENT_POSITION_FOLLOWING (4): the argument node comes after the
    // node compareDocumentPosition was called on, in document order.
    expect(legendHeading.compareDocumentPosition(odontogram) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(
      odontogram.compareDocumentPosition(registeredHeading) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  it('gives the center odontogram column the wide xl:col-span-3 span and both side rails the narrow xl:col-span-1 span', async () => {
    ;(getPatientById as unknown as Mock).mockResolvedValue(makePatient({ teeth: sampleTeeth }))
    await renderLoadedPage()

    const { legendHeading, odontogram, registeredHeading } = getRegions()

    const legendColumn = legendHeading.closest('.xl\\:col-span-1')
    const centerColumn = odontogram.closest('.xl\\:col-span-3')
    const registeredColumn = registeredHeading.closest('.xl\\:col-span-1')

    expect(legendColumn).not.toBeNull()
    expect(centerColumn).not.toBeNull()
    expect(registeredColumn).not.toBeNull()
    // The narrow rails are distinct elements from the wide center column.
    expect(legendColumn).not.toBe(centerColumn)
    expect(registeredColumn).not.toBe(centerColumn)

    // All three columns share the same 1/3/1 grid parent.
    const grid = centerColumn?.parentElement
    expect(grid).toHaveClass('grid', 'xl:grid-cols-5')
    expect(grid).toContainElement(legendColumn as HTMLElement)
    expect(grid).toContainElement(registeredColumn as HTMLElement)
  })

  it('renders all eight condition keys in the left-rail legend', async () => {
    ;(getPatientById as unknown as Mock).mockResolvedValue(makePatient({ teeth: sampleTeeth }))
    await renderLoadedPage()

    const { legendHeading } = getRegions()
    const legendColumn = legendHeading.closest('.xl\\:col-span-1') as HTMLElement
    const legend = within(legendColumn)

    expect(legend.getByText('patients.status.caries')).toBeInTheDocument()
    expect(legend.getByText('patients.status.filled')).toBeInTheDocument()
    expect(legend.getByText('patients.status.crown')).toBeInTheDocument()
    expect(legend.getByText('patients.status.root_canal')).toBeInTheDocument()
    expect(legend.getByText('patients.missingExtracted')).toBeInTheDocument()
    expect(legend.getByText('patients.status.implant')).toBeInTheDocument()
    expect(legend.getByText('patients.status.bridge')).toBeInTheDocument()
    expect(legend.getByText('patients.withNotes')).toBeInTheDocument()
  })

  it('reflects the number of registered teeth in the right-rail count heading', async () => {
    ;(getPatientById as unknown as Mock).mockResolvedValue(
      makePatient({ teeth: { '11': { status: ToothStatus.CARIES, note: '' } } })
    )
    await renderLoadedPage()

    const registeredHeading = screen.getByRole('heading', { name: /patients\.registeredTeeth/ })
    expect(registeredHeading.textContent).toContain('(1)')
    expect(registeredHeading.textContent).not.toContain('(3)')
  })

  it('does not render the registered-teeth rail when the patient has no registered teeth', async () => {
    ;(getPatientById as unknown as Mock).mockResolvedValue(makePatient({ teeth: null }))
    await renderLoadedPage()

    expect(screen.queryByRole('heading', { name: /patients\.registeredTeeth/ })).not.toBeInTheDocument()
    // The other two regions are unaffected by the absence of registered teeth.
    expect(screen.getByRole('heading', { name: 'patients.statusLegend', level: 3 })).toBeInTheDocument()
    expect(screen.getByTestId('odontogram-chart')).toBeInTheDocument()
  })

  it('still opens the tooth details modal (click-to-edit) when a registered-tooth chip is clicked', async () => {
    ;(getPatientById as unknown as Mock).mockResolvedValue(makePatient({ teeth: sampleTeeth }))
    await renderLoadedPage()

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /#11/ }))

    const dialog = screen.getByRole('dialog')
    expect(dialog).toBeInTheDocument()
    expect(within(dialog).getByRole('heading', { name: 'patients.tooth #11' })).toBeInTheDocument()
  })

  it('still wires the hover-to-delete chip button to deleteToothData', async () => {
    ;(getPatientById as unknown as Mock).mockResolvedValue(makePatient({ teeth: sampleTeeth }))
    ;(deleteToothData as unknown as Mock).mockResolvedValue(
      makePatient({
        teeth: { '21': sampleTeeth['21'], '36': sampleTeeth['36'] },
      })
    )
    await renderLoadedPage()

    const chip = screen.getByRole('button', { name: /#11/ }).closest('.group') as HTMLElement
    fireEvent.click(within(chip).getByTitle('common.delete'))

    await waitFor(() => {
      expect(deleteToothData).toHaveBeenCalledWith('p1', '11')
    })

    // Once the delete resolves, the deleted tooth's chip is gone and the
    // count heading reflects the two remaining teeth.
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /#11/ })).not.toBeInTheDocument()
    })
    expect(screen.getByRole('heading', { name: /patients\.registeredTeeth/ }).textContent).toContain('(2)')
  })
})
