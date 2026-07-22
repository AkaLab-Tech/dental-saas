import { describe, it, expect, vi, beforeEach, beforeAll, type Mock } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import i18n from 'i18next'
import '@/i18n'
import { BusinessHoursForm } from './BusinessHoursForm'
import { useSettingsStore } from '@/stores/settings.store'
import type { TenantSettings } from '@/lib/settings-api'

// BusinessHoursForm now renders every weekday name/abbreviation and section
// header through t() (task #331). Initialize the real i18n instance
// (Spanish, the app default) so assertions exercise the actual translated
// output rather than raw keys or jsdom's default `en` locale detection —
// mirrors the pattern used by LabworksPage.test.tsx / DoctorsPage.test.tsx
// (#325/#326) and SettingsPage.test.tsx (#331).
beforeAll(async () => {
  await i18n.changeLanguage('es')
})

vi.mock('@/stores/settings.store', () => ({
  useSettingsStore: vi.fn(),
}))

const mockUpdateSettings = vi.fn()

const mockSettings: TenantSettings = {
  id: 'settings-1',
  language: 'es',
  dateFormat: 'DD/MM/YYYY',
  timeFormat: '24h',
  defaultAppointmentDuration: 30,
  appointmentBuffer: 0,
  businessHours: { mon: { start: '09:00', end: '18:00' } },
  workingDays: [1, 2, 3, 4, 5],
  emailNotifications: true,
  smsNotifications: false,
  appointmentReminders: true,
  reminderHoursBefore: 24,
  autoLockMinutes: 0,
  updatedAt: '2025-01-15T00:00:00Z',
}

describe('BusinessHoursForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(useSettingsStore as unknown as Mock).mockReturnValue({
      updateSettings: mockUpdateSettings,
      isSaving: false,
    })
  })

  it('renders the working-days section header and hint via t()', () => {
    render(<BusinessHoursForm settings={mockSettings} canEdit={true} />)

    expect(screen.getByText('Días Laborables')).toBeInTheDocument()
    expect(screen.getByText('Selecciona los días en que la clínica está abierta')).toBeInTheDocument()
  })

  it('renders the opening-hours section header and hint via t()', () => {
    render(<BusinessHoursForm settings={mockSettings} canEdit={true} />)

    expect(screen.getByText('Horarios de Atención')).toBeInTheDocument()
    expect(screen.getByText('Define el horario de apertura y cierre para cada día')).toBeInTheDocument()
  })

  it('renders the long weekday name for each working day via settings.days.<key>', () => {
    render(<BusinessHoursForm settings={mockSettings} canEdit={true} />)

    // workingDays = [1..5] -> Lunes..Viernes; the long label is duplicated
    // (a "hidden sm:inline" span in the toggle button + a "w-24" span in the
    // per-day hours row), so assert there is at least one of each.
    expect(screen.getAllByText('Lunes').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Martes').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Miércoles').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Jueves').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Viernes').length).toBeGreaterThan(0)
  })

  it('renders the short weekday abbreviation for each working day via settings.days.<key>Short', () => {
    render(<BusinessHoursForm settings={mockSettings} canEdit={true} />)

    expect(screen.getByText('Lun')).toBeInTheDocument()
    expect(screen.getByText('Mar')).toBeInTheDocument()
    expect(screen.getByText('Mié')).toBeInTheDocument()
    expect(screen.getByText('Jue')).toBeInTheDocument()
    expect(screen.getByText('Vie')).toBeInTheDocument()
  })

  it('renders the not-working-days abbreviation too (Dom, Sáb are toggle-only, not in the hours list)', () => {
    render(<BusinessHoursForm settings={mockSettings} canEdit={true} />)

    expect(screen.getByText('Dom')).toBeInTheDocument()
    expect(screen.getByText('Sáb')).toBeInTheDocument()
  })

  it('shows the read-only notice via settings.businessHours.readOnlyNotice when canEdit is false', () => {
    render(<BusinessHoursForm settings={mockSettings} canEdit={false} />)

    expect(
      screen.getByText('Solo el propietario o administradores pueden editar los horarios')
    ).toBeInTheDocument()
  })

  it('does not show the read-only notice when canEdit is true', () => {
    render(<BusinessHoursForm settings={mockSettings} canEdit={true} />)

    expect(
      screen.queryByText('Solo el propietario o administradores pueden editar los horarios')
    ).not.toBeInTheDocument()
  })

  it('shows the no-working-days message via settings.businessHours.noWorkingDays when workingDays is empty', () => {
    const noWorkingDaysSettings = { ...mockSettings, workingDays: [] }
    render(<BusinessHoursForm settings={noWorkingDaysSettings} canEdit={true} />)

    expect(screen.getByText('No hay días laborables seleccionados')).toBeInTheDocument()
  })

  it('renders the time-separator ("a") between the start/end time inputs via settings.businessHours.timeSeparator', () => {
    render(<BusinessHoursForm settings={mockSettings} canEdit={true} />)

    expect(screen.getAllByText('a').length).toBe(5)
  })

  it('renders the save-changes button via settings.saveChanges', () => {
    render(<BusinessHoursForm settings={mockSettings} canEdit={true} />)

    expect(screen.getByRole('button', { name: 'Guardar Cambios' })).toBeInTheDocument()
  })

  it('resolves weekday names to English when the locale is en', async () => {
    await act(async () => {
      await i18n.changeLanguage('en')
    })

    render(<BusinessHoursForm settings={mockSettings} canEdit={true} />)

    expect(screen.getAllByText('Monday').length).toBeGreaterThan(0)
    expect(screen.getByText('Working Days')).toBeInTheDocument()
    expect(screen.getByText('Business Hours')).toBeInTheDocument()

    await act(async () => {
      await i18n.changeLanguage('es')
    })
  })

  it('shows a loading spinner instead of the form when settings is null', () => {
    render(<BusinessHoursForm settings={null} canEdit={true} />)

    const spinner = document.querySelector('.animate-spin')
    expect(spinner).toBeInTheDocument()
    expect(screen.queryByText('Días Laborables')).not.toBeInTheDocument()
  })
})
