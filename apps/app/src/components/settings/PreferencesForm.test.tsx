import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  beforeAll,
  type Mock,
  type MockInstance,
} from 'vitest'
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
const DUPLICATE_MESSAGE = 'Ya existe un tipo de cita con ese nombre'

function getRows() {
  return screen.queryAllByPlaceholderText(TYPE_PLACEHOLDER).map((typeInput) => {
    const row = typeInput.closest('div')
    if (!row) throw new Error('No row container found for a type-duration entry')
    // The duplicate-type message (if any) is a sibling of `row`, not a
    // descendant — both live inside a shared per-entry wrapper div.
    const container = row.parentElement
    if (!container) throw new Error('No wrapper container found for a type-duration entry')
    return {
      typeInput: typeInput as HTMLInputElement,
      durationSelect: within(row).getByRole('combobox', { name: DURATION_LABEL }) as HTMLSelectElement,
      row,
      container,
    }
  })
}

// Task #222: changing the language from Settings -> Preferences and having it
// persist had no test — the two pre-existing language assertions (in the
// #239 block below) only ever saw the untouched 'es' default. These tests
// drive the real <select> instead.
//
// The hazard that kept this coverage out of the file is i18n's singleton:
// handleChange calls `i18n.changeLanguage`, which would flip the shared
// instance the rest of this file relies on being Spanish. Two guards, both
// structural rather than best-effort:
//   1. `i18n.changeLanguage` is spied (no-op) for every test here, so the
//      contract is asserted without the instance actually switching.
//   2. A scoped afterEach restores both the spy and the language, so a
//      FAILING test in this block cannot poison the ones that follow.
// This block is declared first on purpose: the Spanish-string assertions of
// the #239 block run after it, so a leak would surface as their failure.
describe('PreferencesForm — language preference (task #222)', () => {
  const LANGUAGE_LABEL = 'Idioma'

  let changeLanguageSpy: MockInstance<typeof i18n.changeLanguage>
  let languageBeforeTest: string

  beforeEach(() => {
    vi.clearAllMocks()
    ;(useSettingsStore as unknown as Mock).mockReturnValue({
      updateSettings: mockUpdateSettings,
      isSaving: false,
    })
    languageBeforeTest = i18n.language
    changeLanguageSpy = vi.spyOn(i18n, 'changeLanguage').mockResolvedValue(undefined as never)
  })

  afterEach(async () => {
    changeLanguageSpy.mockRestore()
    if (i18n.language !== languageBeforeTest) {
      await i18n.changeLanguage(languageBeforeTest)
    }
    expect(i18n.language).toBe(languageBeforeTest)
  })

  function getLanguageSelect() {
    return screen.getByLabelText(LANGUAGE_LABEL) as HTMLSelectElement
  }

  it('offers exactly the three shipped languages, including Arabic', () => {
    render(<PreferencesForm settings={mockSettings} canEdit={true} />)

    const options = Array.from(getLanguageSelect().options)
    expect(options.map((o) => o.value)).toEqual(['es', 'en', 'ar'])
    expect(options.map((o) => o.textContent)).toEqual(['Español', 'English', 'العربية'])
  })

  it('preselects the saved language and submits the newly chosen one to updateSettings', () => {
    render(<PreferencesForm settings={mockSettings} canEdit={true} />)

    expect(getLanguageSelect().value).toBe('es')

    fireEvent.change(getLanguageSelect(), { target: { value: 'en' } })
    expect(getLanguageSelect().value).toBe('en')

    fireEvent.click(screen.getByRole('button', { name: SAVE_LABEL }))

    expect(mockUpdateSettings).toHaveBeenCalledTimes(1)
    const payload = mockUpdateSettings.mock.calls[0][0]
    expect(payload.language).toBe('en')
    // The rest of the preferences ship unchanged alongside it.
    expect(payload.dateFormat).toBe('DD/MM/YYYY')
    expect(payload.defaultAppointmentDuration).toBe(30)
  })

  it("persists 'ar' — the value the old pt/ar enum mismatch made unsaveable (#221)", () => {
    render(<PreferencesForm settings={mockSettings} canEdit={true} />)

    fireEvent.change(getLanguageSelect(), { target: { value: 'ar' } })
    fireEvent.click(screen.getByRole('button', { name: SAVE_LABEL }))

    expect(mockUpdateSettings).toHaveBeenCalledTimes(1)
    expect(mockUpdateSettings.mock.calls[0][0].language).toBe('ar')
  })

  it('applies the choice to i18n immediately, on change rather than on submit', () => {
    render(<PreferencesForm settings={mockSettings} canEdit={true} />)

    fireEvent.change(getLanguageSelect(), { target: { value: 'ar' } })

    expect(changeLanguageSpy).toHaveBeenCalledTimes(1)
    expect(changeLanguageSpy).toHaveBeenCalledWith('ar')
    // Not deferred to the save: the UI switches as soon as the select changes.
    expect(mockUpdateSettings).not.toHaveBeenCalled()
  })

  it('changing another field never touches i18n', () => {
    render(<PreferencesForm settings={mockSettings} canEdit={true} />)

    fireEvent.change(screen.getByLabelText('Formato de Fecha'), {
      target: { value: 'YYYY-MM-DD' },
    })

    expect(changeLanguageSpy).not.toHaveBeenCalled()
  })

  it('disables the language select in read-only mode (canEdit=false)', () => {
    render(<PreferencesForm settings={mockSettings} canEdit={false} />)

    expect(getLanguageSelect()).toBeDisabled()
    expect(getLanguageSelect().value).toBe('es')
    expect(changeLanguageSpy).not.toHaveBeenCalled()
  })
})

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

  // Review-fix cycle 1 (PR #393): the row editor could build a payload the
  // API rejects with 400 — blank rows and duplicate types — which, because
  // PUT /api/settings is all-or-nothing, silently discarded the user's
  // unrelated preference edits in the same submit too.
  describe('blank rows and duplicate-type validation (review fix)', () => {
    it('drops a blank/whitespace-only row from the payload without blocking submit', () => {
      render(<PreferencesForm settings={mockSettings} canEdit={true} />)

      fireEvent.click(screen.getByRole('button', { name: ADD_LABEL }))
      const newRow = getRows()[2]
      fireEvent.change(newRow.typeInput, { target: { value: '   ' } })

      fireEvent.click(screen.getByRole('button', { name: SAVE_LABEL }))

      expect(mockUpdateSettings).toHaveBeenCalledTimes(1)
      const payload = mockUpdateSettings.mock.calls[0][0]
      expect(payload.appointmentTypeDurations).toEqual([
        { type: 'Limpieza', duration: 30 },
        { type: 'Extraccion', duration: 60 },
      ])
      // The rest of the preferences payload still ships.
      expect(payload.language).toBe('es')
      expect(payload.defaultAppointmentDuration).toBe(30)
    })

    it('blocks submit entirely when two rows share a type, and shows the duplicate message on both', () => {
      render(<PreferencesForm settings={mockSettings} canEdit={true} />)

      const [firstRow] = getRows()
      fireEvent.click(screen.getByRole('button', { name: ADD_LABEL }))
      const newRow = getRows()[2]
      fireEvent.change(newRow.typeInput, { target: { value: 'Limpieza' } })

      fireEvent.click(screen.getByRole('button', { name: SAVE_LABEL }))

      expect(mockUpdateSettings).not.toHaveBeenCalled()
      expect(within(firstRow.container).getByText(DUPLICATE_MESSAGE)).toBeInTheDocument()
      expect(within(getRows()[2].container).getByText(DUPLICATE_MESSAGE)).toBeInTheDocument()
      // The untouched middle row is not flagged.
      expect(within(getRows()[1].container).queryByText(DUPLICATE_MESSAGE)).not.toBeInTheDocument()
    })

    it('detects duplicates case-insensitively and ignoring surrounding whitespace', () => {
      render(<PreferencesForm settings={mockSettings} canEdit={true} />)

      const [firstRow] = getRows()
      fireEvent.click(screen.getByRole('button', { name: ADD_LABEL }))
      const newRow = getRows()[2]
      fireEvent.change(newRow.typeInput, { target: { value: '  limpieza  ' } })

      fireEvent.click(screen.getByRole('button', { name: SAVE_LABEL }))

      expect(mockUpdateSettings).not.toHaveBeenCalled()
      expect(within(firstRow.container).getByText(DUPLICATE_MESSAGE)).toBeInTheDocument()
      expect(within(getRows()[2].container).getByText(DUPLICATE_MESSAGE)).toBeInTheDocument()
    })

    it('clears the duplicate highlight as soon as the offending row is fixed, and the next submit succeeds', () => {
      render(<PreferencesForm settings={mockSettings} canEdit={true} />)

      fireEvent.click(screen.getByRole('button', { name: ADD_LABEL }))
      let newRow = getRows()[2]
      fireEvent.change(newRow.typeInput, { target: { value: 'Limpieza' } })
      fireEvent.click(screen.getByRole('button', { name: SAVE_LABEL }))

      expect(mockUpdateSettings).not.toHaveBeenCalled()
      expect(within(getRows()[0].container).getByText(DUPLICATE_MESSAGE)).toBeInTheDocument()

      // Fix the offending row's type — the highlight must disappear on this
      // edit alone, before any resubmit.
      newRow = getRows()[2]
      fireEvent.change(newRow.typeInput, { target: { value: 'Ortodoncia' } })

      expect(within(getRows()[0].container).queryByText(DUPLICATE_MESSAGE)).not.toBeInTheDocument()
      expect(within(getRows()[2].container).queryByText(DUPLICATE_MESSAGE)).not.toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: SAVE_LABEL }))

      expect(mockUpdateSettings).toHaveBeenCalledTimes(1)
      const payload = mockUpdateSettings.mock.calls[0][0]
      expect(payload.appointmentTypeDurations).toEqual([
        { type: 'Limpieza', duration: 30 },
        { type: 'Extraccion', duration: 60 },
        { type: 'Ortodoncia', duration: 30 },
      ])
    })

    it('trims surrounding whitespace off kept rows in the submitted payload', () => {
      render(<PreferencesForm settings={mockSettings} canEdit={true} />)

      const [firstRow] = getRows()
      fireEvent.change(firstRow.typeInput, { target: { value: '  Limpieza dental  ' } })

      fireEvent.click(screen.getByRole('button', { name: SAVE_LABEL }))

      expect(mockUpdateSettings).toHaveBeenCalledTimes(1)
      const payload = mockUpdateSettings.mock.calls[0][0]
      expect(payload.appointmentTypeDurations).toEqual([
        { type: 'Limpieza dental', duration: 30 },
        { type: 'Extraccion', duration: 60 },
      ])
    })

    it('does not lose unrelated in-form edits when a duplicate blocks the submit — they ship on the next successful submit', () => {
      render(<PreferencesForm settings={mockSettings} canEdit={true} />)

      // Unrelated edits: date format, appointment buffer, and a notification
      // pref. (Deliberately not the language select — changing it mutates
      // the shared i18n singleton across the whole test file via
      // handleChange's `i18n.changeLanguage`, which would leak into other
      // tests/assertions here. The language path is covered instead by the
      // task #222 block at the top of this file, which spies on
      // `i18n.changeLanguage` and restores the language in an afterEach so
      // no switch escapes those tests.)
      fireEvent.change(screen.getByLabelText('Formato de Fecha'), { target: { value: 'YYYY-MM-DD' } })
      fireEvent.change(screen.getByLabelText('Tiempo entre citas (minutos)'), {
        target: { value: '15' },
      })
      fireEvent.click(screen.getByRole('checkbox', { name: /Recibir notificaciones por email/i }))

      // Introduce a duplicate so submit is blocked.
      fireEvent.click(screen.getByRole('button', { name: ADD_LABEL }))
      const newRow = getRows()[2]
      fireEvent.change(newRow.typeInput, { target: { value: 'Extraccion' } })

      fireEvent.click(screen.getByRole('button', { name: SAVE_LABEL }))
      expect(mockUpdateSettings).not.toHaveBeenCalled()

      // The unrelated edits are still reflected in the form, not reverted.
      expect((screen.getByLabelText('Formato de Fecha') as HTMLSelectElement).value).toBe('YYYY-MM-DD')
      expect((screen.getByLabelText('Tiempo entre citas (minutos)') as HTMLInputElement).value).toBe('15')
      expect(screen.getByRole('checkbox', { name: /Recibir notificaciones por email/i })).not.toBeChecked()

      // Fix the duplicate and resubmit: the unrelated edits ship this time.
      fireEvent.change(newRow.typeInput, { target: { value: 'Blanqueamiento' } })
      fireEvent.click(screen.getByRole('button', { name: SAVE_LABEL }))

      expect(mockUpdateSettings).toHaveBeenCalledTimes(1)
      const payload = mockUpdateSettings.mock.calls[0][0]
      expect(payload.dateFormat).toBe('YYYY-MM-DD')
      expect(payload.appointmentBuffer).toBe(15)
      expect(payload.emailNotifications).toBe(false)
      expect(payload.appointmentTypeDurations).toEqual([
        { type: 'Limpieza', duration: 30 },
        { type: 'Extraccion', duration: 60 },
        { type: 'Blanqueamiento', duration: 30 },
      ])
    })
  })
})
