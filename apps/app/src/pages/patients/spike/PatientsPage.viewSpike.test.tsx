/**
 * SPIKE #213 smoke coverage — proves the `?view=` gate on PatientsPage does
 * NOT break the app. This is deliberately light: one render-smoke case per
 * view branch (cards/table/hybrid), no sort-logic/column/breakpoint coverage.
 * The throwaway PatientsTableView/PatientsHybridView POCs will be discarded
 * once #214 implements the option the product lead picks.
 *
 * Regression safety for the default (no `?view=`) path lives in
 * PatientsPage.test.tsx — that file must stay green and unmodified.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import type { Patient } from '@/lib/patient-api'

// Mock the store — same shape as PatientsPage.test.tsx
const mockPatientsState = {
  patients: [] as Patient[],
  stats: null,
  isLoading: false,
  error: null as string | null,
  searchQuery: '',
  showInactive: false,
}

vi.mock('@/stores/patients.store', () => ({
  usePatientsStore: () => ({
    patients: mockPatientsState.patients,
    stats: mockPatientsState.stats,
    isLoading: mockPatientsState.isLoading,
    error: mockPatientsState.error,
    searchQuery: mockPatientsState.searchQuery,
    showInactive: mockPatientsState.showInactive,
    fetchPatients: vi.fn(),
    fetchStats: vi.fn(),
    addPatient: vi.fn(),
    editPatient: vi.fn(),
    removePatient: vi.fn(),
    restoreDeletedPatient: vi.fn(),
    setSearchQuery: vi.fn(),
    setShowInactive: vi.fn(),
    clearError: vi.fn(),
  }),
}))

vi.mock('@/components/patients/PatientCard', () => ({
  PatientCard: ({ patient }: { patient: Patient }) => (
    <div data-testid={`patient-card-${patient.id}`}>{patient.firstName} {patient.lastName}</div>
  ),
}))

vi.mock('@/components/patients/PatientFormModal', () => ({
  PatientFormModal: () => null,
}))

vi.mock('@/components/ui/ConfirmDialog', () => ({
  ConfirmDialog: () => null,
}))

// The spike table/hybrid POCs call useTranslation() directly (no i18n init
// is loaded by the test setup). Mock react-i18next as a stable passthrough,
// mirroring PatientLabworksSection.test.tsx's convention.
const mockT = (key: string) => key
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockT, i18n: { language: 'es' } }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}))

import { PatientsPage } from '../PatientsPage'

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <PatientsPage />
    </MemoryRouter>
  )
}

const activePatient: Patient = {
  id: '1',
  tenantId: 'tenant1',
  firstName: 'Juan',
  lastName: 'Pérez',
  email: 'juan@example.com',
  phone: '+1234567890',
  dob: '1990-01-01',
  gender: 'male',
  address: null,
  notes: null,
  teeth: null,
  showPrimaryTeeth: false,
  isActive: true,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
}

const inactivePatient: Patient = {
  ...activePatient,
  id: '2',
  firstName: 'Carlos',
  lastName: 'López',
  isActive: false,
}

describe('PatientsPage — SPIKE #213 ?view= gate (smoke only)', () => {
  it('no ?view= param renders the production card grid (unchanged default)', () => {
    mockPatientsState.patients = [activePatient]
    renderAt('/patients')

    expect(screen.getByTestId('patient-card-1')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('?view=cards renders the production card grid explicitly', () => {
    mockPatientsState.patients = [activePatient]
    renderAt('/patients?view=cards')

    expect(screen.getByTestId('patient-card-1')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('?view=table renders the table POC without throwing', () => {
    mockPatientsState.patients = [activePatient, inactivePatient]
    renderAt('/patients?view=table')

    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.queryByTestId('patient-card-1')).not.toBeInTheDocument()
    // Column headers come through the mocked t() passthrough as raw keys
    expect(screen.getByText('patients.list.name')).toBeInTheDocument()
    expect(screen.getByText('patients.list.contact')).toBeInTheDocument()
    // Row content renders for both active and inactive patients
    expect(screen.getByText('Juan Pérez')).toBeInTheDocument()
    expect(screen.getByText('Carlos López')).toBeInTheDocument()
    // Inactive row shows the restore action, not edit/delete
    expect(screen.getByText('common.restore')).toBeInTheDocument()
  })

  it('?view=hybrid renders the hybrid POC without throwing', () => {
    mockPatientsState.patients = [activePatient]
    renderAt('/patients?view=hybrid')

    // Hybrid renders both a desktop table and a mobile list in the DOM
    // (visibility is CSS-only; jsdom does not compute layout)
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.queryByTestId('patient-card-1')).not.toBeInTheDocument()
    const nameOccurrences = screen.getAllByText('Juan Pérez')
    expect(nameOccurrences.length).toBeGreaterThanOrEqual(2) // desktop row + mobile row
  })
})
