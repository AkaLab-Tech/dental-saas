import { describe, it, expect, vi, beforeEach, beforeAll, type Mock } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import i18n from 'i18next'
import '@/i18n'
import { PreferencesForm } from './PreferencesForm'
import { useSettingsStore } from '@/stores/settings.store'
import type { TenantSettings } from '@/lib/settings-api'

// Task #239: PreferencesForm gained a per-appointment-type duration editor
// (add / edit / remove rows of { type, duration }), submitted alongside the
// rest of the preferences form. No test file existed for this component
// before this task. Initialize the real i18n instance (Spanish, the app
// default), mirroring BusinessHoursForm.test.tsx / SettingsPage.test.tsx, so
// assertions exercise the actual translated output.
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
  appointmentTypeDurations: [
    { type: 'Limpieza', duration: 30 },
    { type: 'Extraccion', duration: 60 },
  ],
  businessHours: { '1': { start: '09:00', end: '18:00' } },
  workingDays: [1, 2, 3, 4, 5],
  emailNotifications: true,
  smsNotifications: false,
  appointmentReminders: true,
  reminderHoursBefore: 24,
  autoLockMinutes: 0,
  updatedAt: '2025-01-15T00:00:00Z',
}

const TYPE_PLACEHOLDER = 'Ej: Limpieza'
const ADD_LABEL = 'Agregar tipo'
const REMOVE_LABEL = 'Eliminar'
const DURATION_LABEL = 'Duración'
const SAVE_LABEL = 'Guardar Cambios'

function getRows() {
  return screen.queryAllByPlaceholderText(TYPE_PLACEHOLDER).map((typeInput) => {
    const row = typeInput.closest('div')
    if (!row) throw new Error('No row container found for a type-duration entry')
    return {
      typeInput: typeInput as HTMLInputElement,
      durationSelect: within(row).getByRole('combobox', { name: DURATION_LABEL }) as HTMLSelectElement,
      row,
    }
  })
}

describe('PreferencesForm — appointment type durations (task #239)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(useSettingsStore as unknown as Mock).mockReturnValue({
      updateSettings: mockUpdateSettings,
      isSaving: false,
    })
  })

  it('renders one row per configured type, prefilled with its type and duration', () => {
    render(<PreferencesForm settings={mockSettings} canEdit={true} />)

    const rows = getRows()
    expect(rows).toHaveLength(2)
    expect(rows[0].typeInput.value).toBe('Limpieza')
    expect(rows[0].durationSelect.value).toBe('30')
    expect(rows[1].typeInput.value).toBe('Extraccion')
    expect(rows[1].durationSelect.value).toBe('60')
  })

  it('adds a new blank row (30 min default) when "Agregar tipo" is clicked', () => {
    render(<PreferencesForm settings={mockSettings} canEdit={true} />)

    fireEvent.click(screen.getByRole('button', { name: ADD_LABEL }))

    const rows = getRows()
    expect(rows).toHaveLength(3)
    expect(rows[2].typeInput.value).toBe('')
    expect(rows[2].durationSelect.value).toBe('30')
  })

  it('edits a row\'s type text and duration selection', () => {
    render(<PreferencesForm settings={mockSettings} canEdit={true} />)

    const [firstRow] = getRows()
    fireEvent.change(firstRow.typeInput, { target: { value: 'Blanqueamiento' } })
    fireEvent.change(firstRow.durationSelect, { target: { value: '45' } })

    const rowsAfter = getRows()
    expect(rowsAfter[0].typeInput.value).toBe('Blanqueamiento')
    expect(rowsAfter[0].durationSelect.value).toBe('45')
    // The second row is untouched.
    expect(rowsAfter[1].typeInput.value).toBe('Extraccion')
    expect(rowsAfter[1].durationSelect.value).toBe('60')
  })

  it('removes a row when its trash button is clicked', () => {
    render(<PreferencesForm settings={mockSettings} canEdit={true} />)

    const [firstRow] = getRows()
    fireEvent.click(within(firstRow.row).getByRole('button', { name: REMOVE_LABEL }))

    const rowsAfter = getRows()
    expect(rowsAfter).toHaveLength(1)
    expect(rowsAfter[0].typeInput.value).toBe('Extraccion')
  })

  it('submits the edited appointmentTypeDurations (add + edit + remove) as part of the "Save changes" payload', () => {
    render(<PreferencesForm settings={mockSettings} canEdit={true} />)

    // Edit the first row, remove the second, and add a brand-new third row.
    const [firstRow, secondRow] = getRows()
    fireEvent.change(firstRow.typeInput, { target: { value: 'Limpieza profunda' } })
    fireEvent.change(firstRow.durationSelect, { target: { value: '60' } })
    fireEvent.click(within(secondRow.row).getByRole('button', { name: REMOVE_LABEL }))

    fireEvent.click(screen.getByRole('button', { name: ADD_LABEL }))
    const newRow = getRows()[1]
    fireEvent.change(newRow.typeInput, { target: { value: 'Ortodoncia' } })
    fireEvent.change(newRow.durationSelect, { target: { value: '90' } })

    fireEvent.click(screen.getByRole('button', { name: SAVE_LABEL }))

    expect(mockUpdateSettings).toHaveBeenCalledTimes(1)
    const payload = mockUpdateSettings.mock.calls[0][0]
    expect(payload.appointmentTypeDurations).toEqual([
      { type: 'Limpieza profunda', duration: 60 },
      { type: 'Ortodoncia', duration: 90 },
    ])
    // Ships alongside the rest of the preferences payload, not in isolation.
    expect(payload.language).toBe('es')
    expect(payload.defaultAppointmentDuration).toBe(30)
  })

  it('submits an empty appointmentTypeDurations array when every row has been removed', () => {
    render(<PreferencesForm settings={mockSettings} canEdit={true} />)

    // Re-query after each removal instead of iterating a stale snapshot:
    // the rows are keyed by array index, so removing one reshuffles which
    // DOM node backs each remaining row.
    while (getRows().length > 0) {
      const [row] = getRows()
      fireEvent.click(within(row.row).getByRole('button', { name: REMOVE_LABEL }))
    }
    expect(getRows()).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: SAVE_LABEL }))

    expect(mockUpdateSettings).toHaveBeenCalledTimes(1)
    expect(mockUpdateSettings.mock.calls[0][0].appointmentTypeDurations).toEqual([])
  })

  describe('read-only mode (canEdit=false)', () => {
    it('disables every type input and duration select', () => {
      render(<PreferencesForm settings={mockSettings} canEdit={false} />)

      for (const row of getRows()) {
        expect(row.typeInput).toBeDisabled()
        expect(row.durationSelect).toBeDisabled()
      }
    })

    it('hides the "Agregar tipo" button and the per-row remove buttons', () => {
      render(<PreferencesForm settings={mockSettings} canEdit={false} />)

      expect(screen.queryByRole('button', { name: ADD_LABEL })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: REMOVE_LABEL })).not.toBeInTheDocument()
    })

    it('does not render the "Save changes" submit button', () => {
      render(<PreferencesForm settings={mockSettings} canEdit={false} />)

      expect(screen.queryByRole('button', { name: SAVE_LABEL })).not.toBeInTheDocument()
    })
  })

  it('shows a loading spinner instead of the form when settings is null', () => {
    render(<PreferencesForm settings={null} canEdit={true} />)

    const spinner = document.querySelector('.animate-spin')
    expect(spinner).toBeInTheDocument()
    expect(screen.queryByPlaceholderText(TYPE_PLACEHOLDER)).not.toBeInTheDocument()
  })
})
