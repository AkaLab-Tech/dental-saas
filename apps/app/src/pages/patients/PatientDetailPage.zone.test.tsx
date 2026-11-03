import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Mock } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router'
import { Permission } from '@dental/shared'
import PatientDetailPage from './PatientDetailPage'
import { getPatientById } from '@/lib/patient-api'
import { usePermissions } from '@/hooks/usePermissions'
import { getAccountStatement } from '@/lib/payment-api'
import type { Patient } from '@/lib/patient-api'

// Task #655, call site 3. Same seams as PatientDetailPage.test.tsx. Zone and
// clock are pinned: 2026-05-12T01:00Z is 11 May 22:00 in Montevideo, the day
// before the birthday, so the header shows 41. The dob is the sole source of
// 41/42 in the fixture.

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

// The network seam for the account statement the page now owns (task #526).
// Mocked at the module boundary so PatientDetailPage does its own fetch,
// state and render; the default (set in the top-level beforeEach) is a
// settled, zeroed statement so unrelated suites never hit a real request.
vi.mock('@/lib/payment-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/payment-api')>('@/lib/payment-api')
  return {
    ...actual,
    getAccountStatement: vi.fn(),
  }
})

// createAppointment/updateAppointment are the network seam AppointmentFormModal's
// onSubmit hits — mocked so the refresh-wiring tests below can drive that path
// without a real fetch. Everything else (formatting/status helpers) stays real.
vi.mock('@/lib/appointment-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/appointment-api')>('@/lib/appointment-api')
  return {
    ...actual,
    createAppointment: vi.fn(),
    updateAppointment: vi.fn(),
  }
})

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
  PatientAppointmentsSection: ({
    patientId,
    onPaymentsChange,
    onNewAppointment,
  }: {
    patientId: string
    onPaymentsChange: () => void
    onNewAppointment: () => void
  }) => (
    <div data-testid="appointments-section">
      appointments-section:{patientId}
      <button type="button" onClick={onPaymentsChange}>
        trigger-appointments-payments-change
      </button>
      <button type="button" onClick={onNewAppointment}>
        trigger-new-appointment
      </button>
    </div>
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
  PaymentSection: ({
    patientId,
    statement,
    onPaymentsChange,
  }: {
    patientId: string
    statement: { advancesCredit: number } | null
    onPaymentsChange: () => void
  }) => (
    <div data-testid="payments-section" data-statement-credit={statement ? statement.advancesCredit : 'null'}>
      payments-section:{patientId}
      <button type="button" onClick={onPaymentsChange}>
        trigger-payments-change
      </button>
    </div>
  ),
}))

// refreshKey is rendered alongside patientId (rather than asserted via a
// separate spy) so the refresh-wiring tests below can pin the exact prop
// value PatientDetailPage passes down after each mutation path fires.
vi.mock('@/components/payments/PaymentMovementsSection', () => ({
  PaymentMovementsSection: ({
    patientId,
    refreshKey,
  }: {
    patientId: string
    refreshKey: number
  }) => (
    <div data-testid="movements-section">
      movements-section:{patientId}:{refreshKey}
    </div>
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
  AppointmentFormModal: ({
    isOpen,
    onSubmit,
  }: {
    isOpen: boolean
    onSubmit: (data: unknown) => void
  }) =>
    isOpen ? (
      <div data-testid="appointment-form-modal" role="dialog">
        <button type="button" onClick={() => onSubmit({})}>
          submit-appointment-form
        </button>
      </div>
    ) : null,
}))

// `t` must keep a stable identity across renders (the real react-i18next hook
// memoizes it) — several callbacks/effects in the component now list `t` in
// their dependency arrays, so a fresh function per render here would cause an
// infinite effect loop (regression guard for task #324).
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


const patient: Patient = {
  id: 'p1',
  tenantId: 't1',
  firstName: 'Juan',
  lastName: 'Perez',
  email: 'juan@example.com',
  phone: '+1000000000',
  dob: '1984-05-12T00:00:00.000Z',
  gender: 'male',
  coverageType: 'PARTICULAR',
  convenioName: null,
  address: 'Calle Principal 123',
  notes: null,
  teeth: null,
  showPrimaryTeeth: false,
  isActive: true,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
}

beforeEach(() => {
  ;(getAccountStatement as unknown as Mock).mockResolvedValue({
    appointmentsDebt: 0,
    advancesCredit: 0,
    remainingBudgetProjection: 0,
    totalBilled: 0,
    totalPaid: 0,
    advancesTotal: 0,
  })
  ;(usePermissions as unknown as Mock).mockReturnValue({
    can: (p: Permission) => p === Permission.PAYMENTS_VIEW,
    canAny: () => true,
    canAll: () => true,
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('PatientDetailPage header age (#655)', () => {
  it('shows 41 and never 42 the evening before the birthday', async () => {
    ;(getPatientById as unknown as Mock).mockResolvedValue(patient)
    vi.stubEnv('TZ', 'America/Montevideo')
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('America/Montevideo')
    // Only Date is faked so waitFor and promises keep running.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-05-12T01:00:00Z'))

    render(
      <MemoryRouter initialEntries={['/patients/p1']}>
        <Routes>
          <Route path="/patients/:id" element={<PatientDetailPage />} />
        </Routes>
      </MemoryRouter>
    )
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Juan Perez' })).toBeInTheDocument()
    })

    expect(screen.getAllByText('41 años')).toHaveLength(1)
    expect(screen.queryAllByText(/42/)).toHaveLength(0)
  })
})
