/**
 * SPIKE #213 smoke coverage — proves the `?view=` gate on DoctorsPage does
 * NOT break the app. This is deliberately light: one render-smoke case per
 * view branch (cards/table/hybrid), no sort-logic/column/breakpoint coverage.
 * The throwaway DoctorsTableView/DoctorsHybridView POCs will be discarded
 * once #214 implements the option the product lead picks.
 *
 * Regression safety for the default (no `?view=`) path lives in
 * DoctorsPage.test.tsx — that file must stay green and unmodified.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import type { Doctor } from '@/lib/doctor-api'

const mockDoctorsState = {
  doctors: [] as Doctor[],
  stats: null,
  isLoading: false,
  error: null as string | null,
  searchQuery: '',
  showInactive: false,
}

vi.mock('@/stores/doctors.store', () => ({
  useDoctorsStore: () => ({
    doctors: mockDoctorsState.doctors,
    stats: mockDoctorsState.stats,
    isLoading: mockDoctorsState.isLoading,
    error: mockDoctorsState.error,
    searchQuery: mockDoctorsState.searchQuery,
    showInactive: mockDoctorsState.showInactive,
    fetchDoctors: vi.fn(),
    fetchStats: vi.fn(),
    addDoctor: vi.fn(),
    editDoctor: vi.fn(),
    removeDoctor: vi.fn(),
    restoreDeletedDoctor: vi.fn(),
    setSearchQuery: vi.fn(),
    setShowInactive: vi.fn(),
    clearError: vi.fn(),
  }),
}))

vi.mock('@/components/doctors/DoctorCard', () => ({
  DoctorCard: ({ doctor }: { doctor: Doctor }) => (
    <div data-testid={`doctor-card-${doctor.id}`}>Dr. {doctor.firstName} {doctor.lastName}</div>
  ),
}))

vi.mock('@/components/doctors/DoctorFormModal', () => ({
  DoctorFormModal: () => null,
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

import { DoctorsPage } from '../DoctorsPage'

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <DoctorsPage />
    </MemoryRouter>
  )
}

const activeDoctor: Doctor = {
  id: '1',
  tenantId: 'tenant1',
  firstName: 'Juan',
  lastName: 'Pérez',
  email: 'juan@example.com',
  phone: '+1234567890',
  specialty: 'Ortodoncia',
  licenseNumber: 'LIC123',
  workingDays: ['MON', 'WED'],
  workingHours: null,
  consultingRoom: null,
  avatar: null,
  bio: null,
  hourlyRate: null,
  isActive: true,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
}

const inactiveDoctor: Doctor = {
  ...activeDoctor,
  id: '2',
  firstName: 'Carlos',
  lastName: 'López',
  isActive: false,
}

describe('DoctorsPage — SPIKE #213 ?view= gate (smoke only)', () => {
  it('no ?view= param renders the production card grid (unchanged default)', () => {
    mockDoctorsState.doctors = [activeDoctor]
    renderAt('/doctors')

    expect(screen.getByTestId('doctor-card-1')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('?view=cards renders the production card grid explicitly', () => {
    mockDoctorsState.doctors = [activeDoctor]
    renderAt('/doctors?view=cards')

    expect(screen.getByTestId('doctor-card-1')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('?view=table renders the table POC without throwing', () => {
    mockDoctorsState.doctors = [activeDoctor, inactiveDoctor]
    renderAt('/doctors?view=table')

    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.queryByTestId('doctor-card-1')).not.toBeInTheDocument()
    expect(screen.getByText('doctors.list.name')).toBeInTheDocument()
    expect(screen.getByText('doctors.list.workingDays')).toBeInTheDocument()
    expect(screen.getByText('Dr. Juan Pérez')).toBeInTheDocument()
    expect(screen.getByText('Dr. Carlos López')).toBeInTheDocument()
    // Inactive row shows the restore action, not edit/delete
    expect(screen.getByText('common.restore')).toBeInTheDocument()
  })

  it('?view=hybrid renders the hybrid POC without throwing', () => {
    mockDoctorsState.doctors = [activeDoctor]
    renderAt('/doctors?view=hybrid')

    // Hybrid renders both a desktop table and a mobile list in the DOM
    // (visibility is CSS-only; jsdom does not compute layout)
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.queryByTestId('doctor-card-1')).not.toBeInTheDocument()
    const nameOccurrences = screen.getAllByText('Dr. Juan Pérez')
    expect(nameOccurrences.length).toBeGreaterThanOrEqual(2) // desktop row + mobile row
  })
})
