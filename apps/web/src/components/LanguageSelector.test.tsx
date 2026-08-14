// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { LanguageSelector } from './LanguageSelector'

// Mirrors apps/app's components/ui/LanguageSelector.test.tsx mocking style,
// trimmed to the dropdown-only variant this component ships.
const mockChangeLanguage = vi.fn()
let mockLanguage = 'es'
let mockResolvedLanguage: string | undefined = 'es'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: {
      get language() {
        return mockLanguage
      },
      get resolvedLanguage() {
        return mockResolvedLanguage
      },
      changeLanguage: mockChangeLanguage,
    },
  }),
  // LanguageSelector imports `languages` from ../i18n, whose module-level
  // side effect calls i18n.use(initReactI18next); the mock module needs to
  // export a stub plugin so that .use() call does not throw.
  initReactI18next: { type: '3rdParty', init: vi.fn() },
}))

describe('LanguageSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLanguage = 'es'
    mockResolvedLanguage = 'es'
  })

  // apps/web has no vitest `test.globals`, so @testing-library/react's
  // automatic afterEach(cleanup) (which hooks into a global afterEach) never
  // registers; unmount explicitly or renders leak across tests in this file.
  afterEach(() => {
    cleanup()
  })

  it('renders a select with all three languages', () => {
    render(<LanguageSelector />)

    const select = screen.getByRole('combobox', { name: 'Language' })
    expect(select).toBeInTheDocument()
    expect(screen.getByText('Español')).toBeInTheDocument()
    expect(screen.getByText('English')).toBeInTheDocument()
    expect(screen.getByText('العربية')).toBeInTheDocument()
  })

  it('calls i18n.changeLanguage with the selected code', () => {
    render(<LanguageSelector />)

    const select = screen.getByRole('combobox', { name: 'Language' })
    fireEvent.change(select, { target: { value: 'en' } })

    expect(mockChangeLanguage).toHaveBeenCalledWith('en')
    expect(mockChangeLanguage).toHaveBeenCalledTimes(1)
  })

  it('reflects resolvedLanguage as the selected value', () => {
    mockLanguage = 'es'
    mockResolvedLanguage = 'ar'
    render(<LanguageSelector />)

    const select = screen.getByRole('combobox', { name: 'Language' }) as HTMLSelectElement
    expect(select.value).toBe('ar')
  })

  // Regression guard for the implementer's fix: i18n.language can retain a
  // region suffix ('en-US') even though only base codes are supported. Before
  // the fix the selector read i18n.language directly and would either show
  // nothing selected or fall back to the browser's default <option>.
  it('shows "en" (not "en-US") when resolvedLanguage is the stripped base code', () => {
    mockLanguage = 'en-US'
    mockResolvedLanguage = 'en'
    render(<LanguageSelector />)

    const select = screen.getByRole('combobox', { name: 'Language' }) as HTMLSelectElement
    expect(select.value).toBe('en')
  })

  it('falls back to i18n.language when resolvedLanguage is not yet set', () => {
    mockLanguage = 'ar'
    mockResolvedLanguage = undefined
    render(<LanguageSelector />)

    const select = screen.getByRole('combobox', { name: 'Language' }) as HTMLSelectElement
    expect(select.value).toBe('ar')
  })
})
