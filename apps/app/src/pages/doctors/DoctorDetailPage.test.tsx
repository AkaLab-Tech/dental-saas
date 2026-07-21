import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import type { Mock } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router'
import i18n from 'i18next'
import '@/i18n'
import DoctorDetailPage from './DoctorDetailPage'
import { getDoctorById, updateDoctor, type Doctor } from '@/lib/doctor-api'

// DoctorDetailPage now renders every user-facing string (schedule labels,
// contact-info interpolations, error fallbacks, day names, active/inactive
// badge) through t(). Initialize the real i18n instance (Spanish, the app
// default) so assertions exercise the actual translated/interpolated
// output rather than raw keys — mirrors the pattern already used by
// DoctorFormModal.test.tsx and DoctorsPage.test.tsx for the same reason
// (task #325). No test file previously existed for this page.
beforeAll(async () => {
  await i18n.changeLanguage('es')
})

vi.mock('@/lib/doctor-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/doctor-api')>('@/lib/doctor-api')
  return {
    ...actual,
    getDoctorById: vi.fn(),
    updateDoctor: vi.fn(),
  }
})

vi.mock('@/lib/appointment-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/appointment-api')>('@/lib/appointment-api')
  return {
    ...actual,
    updateAppointment: vi.fn(),
    getAppointmentApiErrorMessage: vi.fn(() => 'appointment error'),
  }
})

// The edit-doctor modal is covered by its own test file (DoctorFormModal.test.tsx)
// — stub it here to a minimal marker so assertions target the detail page's own
// wiring (which doctor prop it forwards, that onSubmit reaches updateDoctor).
vi.mock('@/components/doctors/DoctorFormModal', () => ({
  DoctorFormModal: ({ isOpen, doctor, onSubmit }: any) =>
    isOpen ? (
      <div data-testid="doctor-form-modal" role="dialog">
        <span>{doctor ? `edit:${doctor.id}` : 'create'}</span>
        <button onClick={() => onSubmit({ firstName: 'Updated' })}>save</button>
      </div>
    ) : null,
}))

// Unrelated to this migration — stub to a lightweight marker.
vi.mock('@/components/appointments/AppointmentFormModal', () => ({
  AppointmentFormModal: ({ isOpen }: any) =>
    isOpen ? <div data-testid="appointment-form-modal" role="dialog" /> : null,
}))

// The appointments section does its own data fetching/rendering (and has its
// own test coverage) — stub it so this page's test focuses on the header,
// contact-info, schedule, and bio sections that #325 migrated.
vi.mock('./DoctorAppointmentsSection', () => ({
  DoctorAppointmentsSection: ({ doctorId }: { doctorId: string }) => (
    <div data-testid="appointments-section">appointments-section:{doctorId}</div>
  ),
}))

function makeDoctor(overrides: Partial<Doctor> = {}): Doctor {
  return {
    id: 'd1',
    tenantId: 't1',
    firstName: 'Juan',
    lastName: 'González',
    email: 'juan@example.com',
    phone: '+1234567890',
    specialty: 'Ortodoncia',
    licenseNumber: 'LIC123',
    workingDays: ['MON', 'WED'],
    workingHours: { start: '09:00', end: '17:00' },
    consultingRoom: 'Room 101',
    avatar: null,
    bio: 'Experienced orthodontist',
    hourlyRate: 100,
    isActive: true,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/doctors/d1']}>
      <Routes>
        <Route path="/doctors/:id" element={<DoctorDetailPage />} />
      </Routes>
    </MemoryRouter>
  )
}

async function renderLoadedPage(overrides: Partial<Doctor> = {}) {
  ;(getDoctorById as unknown as Mock).mockResolvedValue(makeDoctor(overrides))
  const utils = renderPage()
  await waitFor(() => {
    expect(screen.getByRole('heading', { name: /Dr\. Juan González/ })).toBeInTheDocument()
  })
  return utils
}

describe('DoctorDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('loading state', () => {
    it('shows a spinner while the doctor is being fetched', () => {
      ;(getDoctorById as unknown as Mock).mockReturnValue(new Promise(() => {}))
      renderPage()

      expect(document.querySelector('.animate-spin')).toBeInTheDocument()
    })
  })

  describe('error state (fetch failure, no doctor loaded)', () => {
    it('shows the raw Error message plus the translated back-link and "Error" heading when the fetch rejects with an Error', async () => {
      ;(getDoctorById as unknown as Mock).mockRejectedValue(new Error('Doctor not found'))
      renderPage()

      await waitFor(() => {
        expect(screen.getByText('Doctor not found')).toBeInTheDocument()
      })
      expect(screen.getByText('Volver a doctores')).toBeInTheDocument()
      expect(screen.getByText('Error')).toBeInTheDocument()
    })

    it('falls back to the translated doctors.detail.loadError key when the fetch rejects with a non-Error value', async () => {
      ;(getDoctorById as unknown as Mock).mockRejectedValue('network exploded')
      renderPage()

      await waitFor(() => {
        expect(screen.getByText('Error al cargar el doctor')).toBeInTheDocument()
      })
    })
  })

  describe('doctor header', () => {
    it('renders the translated breadcrumb label and the active badge', async () => {
      await renderLoadedPage({ isActive: true })

      expect(screen.getByText('Doctores')).toBeInTheDocument()
      expect(screen.getByText('Activo')).toBeInTheDocument()
      expect(screen.queryByText('Inactivo')).not.toBeInTheDocument()
    })

    it('renders the translated inactive badge for an inactive doctor', async () => {
      await renderLoadedPage({ isActive: false })

      expect(screen.getByText('Inactivo')).toBeInTheDocument()
      expect(screen.queryByText('Activo')).not.toBeInTheDocument()
    })
  })

  describe('contact & detail fields', () => {
    it('renders license, consulting room, and hourly rate with the translated interpolated strings', async () => {
      await renderLoadedPage()

      expect(screen.getByText('Matrícula: LIC123')).toBeInTheDocument()
      expect(screen.getByText('Consultorio: Room 101')).toBeInTheDocument()
      expect(screen.getByText('Tarifa: $100/hr')).toBeInTheDocument()
    })

    it('does not render the license/room/rate rows when those fields are absent', async () => {
      await renderLoadedPage({ licenseNumber: null, consultingRoom: null, hourlyRate: null })

      expect(screen.queryByText(/Matrícula:/)).not.toBeInTheDocument()
      expect(screen.queryByText(/Consultorio:/)).not.toBeInTheDocument()
      expect(screen.queryByText(/Tarifa:/)).not.toBeInTheDocument()
    })
  })

  describe('work schedule section', () => {
    it('renders the translated section header, working-days label, and a day pill with its translated tooltip/short letter', async () => {
      await renderLoadedPage({ workingDays: ['MON', 'WED'] })

      expect(screen.getByText('Horario de Trabajo')).toBeInTheDocument()
      expect(screen.getByText('Días de trabajo')).toBeInTheDocument()

      const monday = screen.getByTitle('Lunes')
      expect(monday).toHaveTextContent('L')
    })

    it('renders the translated schedule label and the working-hours range', async () => {
      await renderLoadedPage({ workingHours: { start: '09:00', end: '17:00' } })

      expect(screen.getByText('Horario')).toBeInTheDocument()
      expect(screen.getByText('09:00 — 17:00')).toBeInTheDocument()
    })

    it('does not render the schedule section when there are no working days or hours', async () => {
      await renderLoadedPage({ workingDays: [], workingHours: null })

      expect(screen.queryByText('Horario de Trabajo')).not.toBeInTheDocument()
    })
  })

  describe('bio section', () => {
    it('renders the translated bio section header and content', async () => {
      await renderLoadedPage({ bio: 'Experienced orthodontist' })

      expect(screen.getByText('Biografía')).toBeInTheDocument()
      expect(screen.getByText('Experienced orthodontist')).toBeInTheDocument()
    })

    it('does not render the bio section when bio is absent', async () => {
      await renderLoadedPage({ bio: null })

      expect(screen.queryByText('Biografía')).not.toBeInTheDocument()
    })
  })

  describe('edit flow', () => {
    it('opens the edit modal with the current doctor when clicking the translated Edit button', async () => {
      await renderLoadedPage()

      fireEvent.click(screen.getByRole('button', { name: 'Editar' }))

      expect(screen.getByTestId('doctor-form-modal')).toBeInTheDocument()
      expect(screen.getByText('edit:d1')).toBeInTheDocument()
    })

    it('surfaces the raw Error message when saving the edit rejects with an Error', async () => {
      await renderLoadedPage()
      ;(updateDoctor as unknown as Mock).mockRejectedValue(new Error('Update failed'))

      fireEvent.click(screen.getByRole('button', { name: 'Editar' }))
      fireEvent.click(screen.getByText('save'))

      await waitFor(() => {
        expect(screen.getByText('Update failed')).toBeInTheDocument()
      })
    })

    it('falls back to the translated doctors.detail.saveError key when saving rejects with a non-Error value', async () => {
      await renderLoadedPage()
      ;(updateDoctor as unknown as Mock).mockRejectedValue('save exploded')

      fireEvent.click(screen.getByRole('button', { name: 'Editar' }))
      fireEvent.click(screen.getByText('save'))

      await waitFor(() => {
        expect(screen.getByText('Error al guardar los cambios')).toBeInTheDocument()
      })
    })
  })
})
